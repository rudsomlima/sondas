'use client'

import { useEffect, useRef, useState } from 'react'
import { Battery, Info, Trash2, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react'
import { GMT3 } from '@/app/lib/types'
import { HEARTBEAT_MS, type PowerHistoryEntry, type PowerHistoryState } from '@/app/painel/hooks/usePowerStateHistory'
import type { RdzConfig } from '@/app/lib/rdzConfig'
import { parseSleepWindows } from '@/app/lib/sleepWindows'

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
  noData:        '#161b22', // quase a cor do painel (--surface #12161d) — recua visualmente em vez de competir com os dados reais
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
// Zoom no eixo X (horas do dia, compartilhado por todas as linhas)
// ──────────────────────────────────────────────────────────────
interface HourRange { start: number; end: number } // horas locais, 0–24

const FULL_RANGE: HourRange = { start: 0, end: 24 }
const MIN_SPAN_H = 5 / 60 // não deixa dar zoom além de ~5 minutos de janela

function clampRange(start: number, end: number): HourRange {
  let s = start, e = end
  if (e - s < MIN_SPAN_H) {
    const c = (s + e) / 2
    s = c - MIN_SPAN_H / 2
    e = c + MIN_SPAN_H / 2
  }
  if (s < 0) { e -= s; s = 0 }
  if (e > 24) { s -= (e - 24); e = 24 }
  return { start: Math.max(0, s), end: Math.min(24, e) }
}

// Escolhe um intervalo "redondo" (minutos) pras marcas do eixo X de acordo
// com o quanto a janela visível está zoomada, visando ~6 marcas na tela.
const TICK_CANDIDATES_MIN = [1, 2, 5, 10, 15, 30, 60, 120, 180, 360, 720, 1440]
function computeTicks(range: HourRange): { hour: number; label: string }[] {
  const spanMin = (range.end - range.start) * 60
  let stepMin = TICK_CANDIDATES_MIN[TICK_CANDIDATES_MIN.length - 1]
  for (const c of TICK_CANDIDATES_MIN) {
    if (spanMin / c <= 6) { stepMin = c; break }
  }
  const stepH = stepMin / 60
  const first = Math.ceil(range.start / stepH) * stepH
  const ticks: { hour: number; label: string }[] = []
  for (let h = first; h <= range.end + 1e-9; h += stepH) {
    const totalMin = Math.round(h * 60)
    const hh = Math.floor(totalMin / 60)
    const mm = totalMin % 60
    const label = stepMin < 60
      ? `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
      : `${hh}h`
    ticks.push({ hour: Math.min(h, 24), label })
  }
  return ticks
}

// ──────────────────────────────────────────────────────────────
// Componente
// ──────────────────────────────────────────────────────────────
export default function PowerTimeline({ history, config, mqttConnected, onDeleteDay }: PowerTimelineProps) {
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<{ seg: DaySegment; clientX: number; clientY: number } | null>(null)
  const [view, setView] = useState<HourRange>(FULL_RANGE)
  const dragRef = useRef<{ rect: DOMRect; startHour: number } | null>(null)
  const [dragHour, setDragHour] = useState<number | null>(null) // hora atual do arrasto (pra desenhar a seleção)

  const zoomed = view.start > 1e-6 || view.end < 24 - 1e-6

  const hourAt = (rect: DOMRect, clientX: number) => {
    const frac = (clientX - rect.left) / rect.width
    return Math.min(24, Math.max(0, frac * 24))
  }

  const zoomBy = (factor: number, centerHour?: number) => {
    setView(v => {
      const span = v.end - v.start
      const center = centerHour ?? (v.start + v.end) / 2
      const newSpan = Math.min(24, Math.max(MIN_SPAN_H, span * factor))
      return clampRange(center - newSpan / 2, center + newSpan / 2)
    })
  }

  const resetZoom = () => setView(FULL_RANGE)

  const handleBarMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const h = hourAt(rect, e.clientX)
    dragRef.current = { rect, startHour: h }
    setDragHour(h)
  }

  const handleBarWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    const center = hourAt(rect, e.clientX)
    zoomBy(e.deltaY > 0 ? 1.3 : 1 / 1.3, center)
  }

  // Arrasto pra selecionar um intervalo e dar zoom nele — segue o mouse pela
  // janela toda (não só a linha onde começou), já que todas as linhas usam a
  // mesma escala 0–24h.
  useEffect(() => {
    if (dragHour === null) return
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      setDragHour(hourAt(d.rect, e.clientX))
    }
    const onUp = (e: MouseEvent) => {
      const d = dragRef.current
      if (d) {
        const endHour = hourAt(d.rect, e.clientX)
        if (Math.abs(endHour - d.startHour) * 60 >= 3) { // arrasto mínimo de 3min pra não confundir com clique
          setView(clampRange(Math.min(d.startHour, endHour), Math.max(d.startHour, endHour)))
        }
      }
      dragRef.current = null
      setDragHour(null)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragHour !== null]) // eslint-disable-line react-hooks/exhaustive-deps

  const timelines = computeDailyTimelines(history, DAYS, config, mqttConnected)
  const hasConfig = !!(config && parseSleepWindows(config))
  const hasSomeObserved = timelines.some(t => t.hasData)

  const span = view.end - view.start
  const ticks = computeTicks(view)
  const pctOf = (h: number) => ((h - view.start) / span) * 100

  return (
    <div className="panel p-5 mb-6">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <Battery size={14} className="text-blue-400" />
          Deep Sleep / Power — últimos {DAYS} dias
        </h2>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => zoomBy(1 / 1.6)}
            title="Mais zoom"
            className="p-1 rounded border border-border text-gray-400 hover:text-white hover:border-border-strong transition-colors"
          >
            <ZoomIn size={12} />
          </button>
          <button
            onClick={() => zoomBy(1.6)}
            title="Menos zoom"
            className="p-1 rounded border border-border text-gray-400 hover:text-white hover:border-border-strong transition-colors"
          >
            <ZoomOut size={12} />
          </button>
          {zoomed && (
            <button
              onClick={resetZoom}
              title="Voltar pro dia inteiro"
              className="p-1 rounded border border-border text-gray-400 hover:text-white hover:border-border-strong transition-colors"
            >
              <RotateCcw size={12} />
            </button>
          )}
        </div>
      </div>
      <p className="text-[11px] text-faint mb-4 flex items-start gap-1.5">
        <Info size={11} className="flex-shrink-0 mt-0.5" />
        {hasConfig
          ? 'Cores vivas = observado via MQTT. Cores escuras = estimativa baseada nas janelas de recepção do firmware (inclui horas futuras de hoje). Arraste sobre o gráfico ou use a roda do mouse pra dar zoom.'
          : 'Registra períodos em que o app estava aberto com MQTT conectado. Carregue a configuração do receptor para estimar deep sleep nas lacunas. Arraste sobre o gráfico ou use a roda do mouse pra dar zoom.'}
      </p>

      {/* Eixo X (horas da janela visível) */}
      <div className="flex ml-[68px] mb-1 relative">
        <div className="flex-1 relative" style={{ height: 14 }}>
          {ticks.map(t => (
            <span
              key={t.hour}
              className="absolute text-[10px] text-faint -translate-x-1/2"
              style={{ left: `${pctOf(t.hour)}%` }}
            >
              {t.label}
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

          {/* Barra de timeline posicionada no tempo — arraste (zoom numa faixa),
              roda do mouse (zoom no cursor) ou duplo clique (reset) */}
          <div
            className="flex-1 relative rounded overflow-hidden select-none"
            style={{ height: 20, background: COLORS.noData, cursor: dragHour !== null ? 'ew-resize' : 'crosshair' }}
            onMouseDown={handleBarMouseDown}
            onWheel={handleBarWheel}
            onDoubleClick={resetZoom}
          >
            {tl.segments.map((seg, i) => {
              const segStartH = seg.startFrac * 24
              const segEndH   = segStartH + seg.durFrac * 24
              if (segEndH <= view.start || segStartH >= view.end) return null
              const left  = pctOf(Math.max(segStartH, view.start))
              const width = pctOf(Math.min(segEndH, view.end)) - left
              return (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    left:     `${left}%`,
                    width:    `${Math.max(width, 0.1)}%`,
                    height:   '100%',
                    background: COLORS[seg.state],
                  }}
                  onMouseEnter={e => setTooltip({ seg, clientX: e.clientX, clientY: e.clientY })}
                  onMouseMove={e  => setTooltip(t => t ? { ...t, clientX: e.clientX, clientY: e.clientY } : null)}
                  onMouseLeave={() => setTooltip(null)}
                />
              )
            })}
            {/* Linhas de grade */}
            {ticks.map(t => (
              <div
                key={t.hour}
                style={{
                  position: 'absolute',
                  left: `${pctOf(t.hour)}%`,
                  top: 0, bottom: 0, width: 1,
                  background: 'rgba(0,0,0,0.25)',
                }}
              />
            ))}
            {/* Seleção de arrasto em andamento */}
            {dragHour !== null && dragRef.current && (
              <div
                style={{
                  position: 'absolute',
                  left:  `${Math.min(pctOf(dragRef.current.startHour), pctOf(dragHour))}%`,
                  width: `${Math.abs(pctOf(dragHour) - pctOf(dragRef.current.startHour))}%`,
                  top: 0, bottom: 0,
                  background: 'rgba(255,255,255,0.18)',
                  border: '1px solid rgba(255,255,255,0.4)',
                }}
              />
            )}
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
