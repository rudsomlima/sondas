'use client'

import { useState } from 'react'
import { Battery, Info, Trash2 } from 'lucide-react'
import { GMT3 } from '@/app/lib/types'
import { HEARTBEAT_MS, type PowerHistoryEntry, type PowerHistoryState } from '@/app/painel/hooks/usePowerStateHistory'
import type { RdzConfig } from '@/app/lib/rdzConfig'

// Um estado só é "assumido" contínuo até aqui além de sua última observação
// (heartbeat ou transição). Além disso, tratamos como lacuna sem dado (ver
// fillGap) em vez de esticar a última cor conhecida — é o que evita, por
// exemplo, pintar um dia inteiro de "acordado" só porque a aba ficou fechada
// durante um ciclo de deep sleep e reabriu ainda com esse valor no histórico.
const MAX_ASSUME_MS = 3 * HEARTBEAT_MS

interface PowerTimelineProps {
  history: PowerHistoryEntry[]
  config: RdzConfig | null
  mqttConnected: boolean
  onDeleteDay: (dayKey: string) => void
}

const DAYS   = 7
const DAY_MS = 24 * 60 * 60 * 1000

// ──────────────────────────────────────────────────────────────
// Estados granulares
// ──────────────────────────────────────────────────────────────
type DetailState =
  | 'sleeping'       // deep sleep
  | 'eco'            // bateria crítica
  | 'listening'      // escuta estendida, WiFi normal
  | 'listen_wifips'  // escuta estendida, WiFi modem_sleep
  | 'listen_nowifi'  // escuta estendida, WiFi off
  | 'awake_nowifi'   // acordado sem WiFi
  | 'awake_wifips'   // acordado WiFi modem_sleep
  | 'awake_cpu80'    // acordado CPU 80 MHz
  | 'awake'          // potência total

function entryDetailState(e: PowerHistoryEntry): DetailState {
  const { state, cpuMhz, wifi } = e
  if (state === 'sleeping') return 'sleeping'
  if (state === 'eco') return 'eco'
  if (state === 'listening') {
    if (wifi === 'off') return 'listen_nowifi'
    if (wifi === 'modem_sleep') return 'listen_wifips'
    return 'listening'
  }
  if (wifi === 'off') return 'awake_nowifi'
  if (wifi === 'modem_sleep') return 'awake_wifips'
  if (cpuMhz === 80) return 'awake_cpu80'
  return 'awake'
}

const COLORS: Record<DetailState | 'awakePred' | 'sleepingPred' | 'noData', string> = {
  sleeping:      '#818cf8', // indigo-400
  eco:           '#ef4444', // red-500
  listening:     '#fbbf24', // amber-400
  listen_wifips: '#a78bfa', // violet-400
  listen_nowifi: '#fb7185', // rose-400
  awake_nowifi:  '#f97316', // orange-500
  awake_wifips:  '#22d3ee', // cyan-400
  awake_cpu80:   '#a3e635', // lime-400
  awake:         '#34d399', // emerald-400
  awakePred:     '#065f46', // emerald-900
  sleepingPred:  '#312e81', // indigo-900
  noData:        '#232a35',
}

const LABELS: Record<DetailState | 'awakePred' | 'sleepingPred' | 'noData', string> = {
  sleeping:      'Deep sleep',
  eco:           'Economia (bat. crítica)',
  listening:     'Escuta estendida',
  listen_wifips: 'Escuta ext. WiFi economia',
  listen_nowifi: 'Escuta ext. sem WiFi',
  awake_nowifi:  'Acordado sem WiFi',
  awake_wifips:  'Acordado WiFi economia',
  awake_cpu80:   'Acordado CPU 80 MHz',
  awake:         'Acordado (potência total)',
  awakePred:     'Acordado (previsto config)',
  sleepingPred:  'Dormindo (previsto config)',
  noData:        'Sem dados',
}

// ──────────────────────────────────────────────────────────────
// Dias (GMT-3)
// ──────────────────────────────────────────────────────────────
function localDayKey(utcMs: number): string {
  const local = new Date(utcMs + GMT3)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`
}

function localDayStartUtcMs(dayKey: string): number {
  const [y, m, d] = dayKey.split('-').map(Number)
  return Date.UTC(y, m - 1, d, 0, 0, 0) - GMT3
}

function lastNDayKeys(n: number): string[] {
  const todayKey = localDayKey(Date.now())
  const [ty, tm, td] = todayKey.split('-').map(Number)
  const pad = (v: number) => String(v).padStart(2, '0')
  const keys: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(ty, tm - 1, td - i, 0, 0, 0))
    keys.push(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`)
  }
  return keys
}

// ──────────────────────────────────────────────────────────────
// Janelas de recepção (previsão)
// ──────────────────────────────────────────────────────────────
interface SleepWindow { startMin: number; durMin: number }

function parseSleepWindows(config: RdzConfig): SleepWindow[] | null {
  if (parseInt(String(config['sleep.mode'] ?? '0'), 10) !== 1) return null
  const w1s = parseInt(String(config['sleep.w1start'] ?? '0'), 10)
  const w1d = parseInt(String(config['sleep.w1dur']   ?? '0'), 10)
  const w2s = parseInt(String(config['sleep.w2start'] ?? '0'), 10)
  const w2d = parseInt(String(config['sleep.w2dur']   ?? '0'), 10)
  const ext = parseInt(String(config['sleep.extend']  ?? '0'), 10)
  const ws: SleepWindow[] = []
  if (w1d > 0) ws.push({ startMin: w1s, durMin: w1d + ext })
  if (w2d > 0) ws.push({ startMin: w2s, durMin: w2d + ext })
  return ws.length > 0 ? ws : null
}

// ──────────────────────────────────────────────────────────────
// Segmentos posicionados no tempo (nova estrutura)
// ──────────────────────────────────────────────────────────────
type SegState = DetailState | 'awakePred' | 'sleepingPred' | 'noData'

interface DaySegment {
  startFrac: number  // 0.0–1.0 da meia-noite local
  durFrac:   number
  state:     SegState
  startMs:   number  // UTC ms (para tooltip)
  endMs:     number
}

interface DayTimeline {
  dateKey: string
  day:     string   // "DD/MM"
  segments: DaySegment[]
  hasData:  boolean
}

function computeDailyTimelines(
  history: PowerHistoryEntry[],
  days: number,
  config: RdzConfig | null,
  mqttConnected: boolean,
): DayTimeline[] {
  const dayKeys    = lastNDayKeys(days)
  const windows    = config ? parseSleepWindows(config) : null
  const now        = Date.now()
  const rangeStart = localDayStartUtcMs(dayKeys[0])

  // Intervalos MQTT — corrigido: inclui intervalos que TERMINAM dentro da
  // janela. Cada intervalo só é esticado até MAX_ASSUME_MS além do início;
  // o restante fica sem cobertura (tratado como lacuna por fillGap) em vez
  // de assumir que o estado persistiu por um período não observado.
  interface MqttIv { start: number; end: number; ds: DetailState }
  const mqttIvs: MqttIv[] = []
  if (history.length > 0) {
    const sorted = [...history].sort((a, b) => a.at - b.at)
    const lastEnd = mqttConnected ? now : sorted[sorted.length - 1].at
    for (let i = 0; i < sorted.length; i++) {
      const start = sorted[i].at
      const naturalEnd = i + 1 < sorted.length ? sorted[i + 1].at : lastEnd
      const end = Math.min(naturalEnd, start + MAX_ASSUME_MS)
      if (end > rangeStart && end > start) {
        mqttIvs.push({ start, end, ds: entryDetailState(sorted[i]) })
      }
    }
  }

  return dayKeys.map(dk => {
    const dayStart = localDayStartUtcMs(dk)
    const dayEnd   = dayStart + DAY_MS
    const [, m, d] = dk.split('-')
    const segments: DaySegment[] = []
    let hasData = false

    const pushSeg = (start: number, end: number, state: SegState) => {
      const s = Math.max(start, dayStart)
      const e = Math.min(end,   dayEnd)
      if (e <= s) return
      segments.push({
        startFrac: (s - dayStart) / DAY_MS,
        durFrac:   (e - s)        / DAY_MS,
        state,
        startMs: s,
        endMs:   e,
      })
    }

    const fillGap = (gapStart: number, gapEnd: number) => {
      if (gapEnd <= gapStart) return
      if (windows) {
        // Calcula interseções das janelas de recepção com o gap, ordenadas
        const wIvs: { start: number; end: number }[] = []
        for (const w of windows) {
          const wStart = dayStart + w.startMin * 60000
          const wEnd   = dayStart + (w.startMin + w.durMin) * 60000
          const s = Math.max(gapStart, wStart)
          const e = Math.min(gapEnd,   wEnd)
          if (e > s) wIvs.push({ start: s, end: e })
        }
        wIvs.sort((a, b) => a.start - b.start)
        let cursor = gapStart
        for (const wiv of wIvs) {
          if (wiv.start > cursor) pushSeg(cursor, wiv.start, 'sleepingPred')
          pushSeg(wiv.start, wiv.end, 'awakePred')
          cursor = wiv.end
        }
        if (cursor < gapEnd) pushSeg(cursor, gapEnd, 'sleepingPred')
      } else {
        pushSeg(gapStart, gapEnd, 'noData')
      }
    }

    const dayMqtt = mqttIvs
      .map(iv => ({ ...iv, start: Math.max(iv.start, dayStart), end: Math.min(iv.end, dayEnd) }))
      .filter(iv => iv.end > iv.start)
      .sort((a, b) => a.start - b.start)

    let cursor = dayStart
    for (const iv of dayMqtt) {
      if (iv.start > cursor) fillGap(cursor, iv.start)
      pushSeg(iv.start, iv.end, iv.ds)
      hasData = true
      cursor = Math.max(cursor, iv.end)
    }
    if (cursor < dayEnd) fillGap(cursor, dayEnd)

    return { dateKey: dk, day: `${d}/${m}`, segments, hasData }
  })
}

// ──────────────────────────────────────────────────────────────
// Utilitários de exibição
// ──────────────────────────────────────────────────────────────
function fmtTime(utcMs: number): string {
  const local = new Date(utcMs + GMT3)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '0min'
  const totalMin = Math.round(ms / 60000)
  const h   = Math.floor(totalMin / 60)
  const min = totalMin % 60
  if (h === 0) return `${min}min`
  return `${h}h${min > 0 ? ` ${min}min` : ''}`
}

const ALL_DETAIL_STATES: DetailState[] = [
  'awake','awake_cpu80','awake_wifips','awake_nowifi',
  'listen_nowifi','listen_wifips','listening',
  'eco','sleeping',
]

// ──────────────────────────────────────────────────────────────
// Componente
// ──────────────────────────────────────────────────────────────
export default function PowerTimeline({ history, config, mqttConnected, onDeleteDay }: PowerTimelineProps) {
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<{ seg: DaySegment; clientX: number; clientY: number } | null>(null)

  const timelines = computeDailyTimelines(history, DAYS, config, mqttConnected)
  const hasConfig = !!(config && parseSleepWindows(config))
  const hasSomeObserved = timelines.some(t => t.hasData)

  // Marcas do eixo X (0h 6h 12h 18h 24h)
  const xLabels = [0, 6, 12, 18, 24]

  return (
    <div className="panel p-5 mb-6">
      <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-1">
        <Battery size={14} className="text-blue-400" />
        Deep Sleep / Power — últimos {DAYS} dias
      </h2>
      <p className="text-[11px] text-faint mb-4 flex items-start gap-1.5">
        <Info size={11} className="flex-shrink-0 mt-0.5" />
        {hasConfig
          ? 'Cores vivas = observado via MQTT. Cores escuras = estimativa baseada nas janelas de recepção do firmware (inclui horas futuras de hoje).'
          : 'Registra períodos em que o app estava aberto com MQTT conectado. Carregue a configuração do receptor para estimar deep sleep nas lacunas.'}
      </p>

      {/* Eixo X (horas do dia) */}
      <div className="flex ml-[68px] mb-1 relative">
        <div className="flex-1 relative" style={{ height: 14 }}>
          {xLabels.map(h => (
            <span
              key={h}
              className="absolute text-[10px] text-faint -translate-x-1/2"
              style={{ left: `${(h / 24) * 100}%` }}
            >
              {h}h
            </span>
          ))}
        </div>
      </div>

      {/* Linhas de cada dia */}
      {timelines.map(tl => (
        <div key={tl.dateKey} className="flex items-center gap-2 mb-1.5">
          {/* Label + botão apagar */}
          <div className="flex items-center justify-end gap-1 flex-shrink-0" style={{ width: 64 }}>
            {confirmDelete === tl.dateKey ? (
              <>
                <button
                  onClick={() => { onDeleteDay(tl.dateKey); setConfirmDelete(null) }}
                  className="px-1.5 py-0.5 bg-red-600 text-[9px] text-white rounded"
                >ok</button>
                <button
                  onClick={() => setConfirmDelete(null)}
                  className="px-1.5 py-0.5 bg-surface border border-border text-[9px] text-gray-400 rounded"
                >×</button>
              </>
            ) : (
              <>
                <span className="text-[11px] mono text-faint">{tl.day}</span>
                <button
                  onClick={() => setConfirmDelete(tl.dateKey)}
                  title="Apagar dados deste dia"
                  className="text-gray-600 hover:text-red-400 transition-colors"
                >
                  <Trash2 size={10} />
                </button>
              </>
            )}
          </div>

          {/* Barra de timeline posicionada no tempo */}
          <div
            className="flex-1 relative rounded overflow-hidden"
            style={{ height: 20, background: COLORS.noData }}
          >
            {tl.segments.map((seg, i) => (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  left:     `${seg.startFrac * 100}%`,
                  width:    `${Math.max(seg.durFrac * 100, 0.15)}%`,
                  height:   '100%',
                  background: COLORS[seg.state],
                }}
                onMouseEnter={e => setTooltip({ seg, clientX: e.clientX, clientY: e.clientY })}
                onMouseMove={e  => setTooltip(t => t ? { ...t, clientX: e.clientX, clientY: e.clientY } : null)}
                onMouseLeave={() => setTooltip(null)}
              />
            ))}
            {/* Linhas de grade de 6h */}
            {[6, 12, 18].map(h => (
              <div
                key={h}
                style={{
                  position: 'absolute',
                  left: `${(h / 24) * 100}%`,
                  top: 0, bottom: 0, width: 1,
                  background: 'rgba(0,0,0,0.25)',
                }}
              />
            ))}
          </div>
        </div>
      ))}

      {/* Tooltip flutuante */}
      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none bg-surface border border-border rounded-md px-3 py-2 text-xs shadow-lg"
          style={{ left: tooltip.clientX + 12, top: tooltip.clientY - 40 }}
        >
          <p style={{ color: COLORS[tooltip.seg.state] }} className="font-medium">
            {LABELS[tooltip.seg.state]}
          </p>
          <p className="text-faint font-mono">
            {fmtTime(tooltip.seg.startMs)} – {fmtTime(tooltip.seg.endMs)}
            {' · '}{formatDuration(tooltip.seg.endMs - tooltip.seg.startMs)}
          </p>
        </div>
      )}

      {/* Legenda */}
      <div className="mt-3 space-y-2">
        {hasSomeObserved && (
          <div>
            <p className="text-[10px] text-faint uppercase tracking-wide mb-1">Observado via MQTT</p>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {ALL_DETAIL_STATES.map(s => (
                <div key={s} className="flex items-center gap-1.5 text-[10px] text-gray-300">
                  <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: COLORS[s] }} />
                  {LABELS[s]}
                </div>
              ))}
            </div>
          </div>
        )}
        {hasConfig && (
          <div>
            <p className="text-[10px] text-faint uppercase tracking-wide mb-1">Previsto / estimado</p>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {(['awakePred','sleepingPred'] as const).map(s => (
                <div key={s} className="flex items-center gap-1.5 text-[10px] text-gray-300">
                  <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: COLORS[s] }} />
                  {LABELS[s]}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
