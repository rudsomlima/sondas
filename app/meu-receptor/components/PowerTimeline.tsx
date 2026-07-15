'use client'

import { useState } from 'react'
import { Battery, Info, Trash2 } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { CHART } from '@/app/lib/tokens'
import { GMT3 } from '@/app/lib/types'
import type { PowerHistoryEntry, PowerHistoryState } from '@/app/painel/hooks/usePowerStateHistory'
import type { RdzConfig } from '@/app/lib/rdzConfig'

interface PowerTimelineProps {
  history: PowerHistoryEntry[]
  config: RdzConfig | null
  mqttConnected: boolean
  onDeleteDay: (dayKey: string) => void
}

const DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

// ──────────────────────────────────────────────────────────────
// Estados detalhados (derivados em tempo de render dos campos
// cpuMhz / wifi armazenados em cada PowerHistoryEntry)
// ──────────────────────────────────────────────────────────────
type DetailState =
  | 'sleeping'       // deep sleep
  | 'eco'            // bateria crítica
  | 'listening'      // escuta estendida, WiFi normal ou desconhecido
  | 'listen_wifips'  // escuta estendida, WiFi modem sleep (extendmode=0)
  | 'listen_nowifi'  // escuta estendida, WiFi off (extendmode=1)
  | 'awake_nowifi'   // acordado, WiFi completamente desligado
  | 'awake_wifips'   // acordado, WiFi modem sleep
  | 'awake_cpu80'    // acordado, CPU 80 MHz (WiFi normal)
  | 'awake'          // acordado, potência total (240 MHz + WiFi on)

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
  sleeping:      '#818cf8', // indigo-400   — deep sleep
  eco:           '#ef4444', // red-500      — bateria crítica
  listening:     '#fbbf24', // amber-400    — escuta estendida (WiFi normal)
  listen_wifips: '#a78bfa', // violet-400   — escuta + WiFi modem_sleep
  listen_nowifi: '#fb7185', // rose-400     — escuta + WiFi off
  awake_nowifi:  '#f97316', // orange-500   — acordado sem WiFi
  awake_wifips:  '#22d3ee', // cyan-400     — acordado WiFi modem_sleep
  awake_cpu80:   '#a3e635', // lime-400     — acordado CPU 80 MHz
  awake:         '#34d399', // emerald-400  — acordado potência total
  awakePred:     '#065f46', // emerald-900  — previsto acordado
  sleepingPred:  '#312e81', // indigo-900   — previsto dormindo
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
// Dia local (GMT-3)
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
// Janelas de recepção (previsão baseada na config do firmware)
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

// Sub-estado previsto para o período acordado (baseado em sleep.cpu80 / sleep.wifips)
function predictedAwakeState(config: RdzConfig): DetailState {
  const cpu80  = parseInt(String(config['sleep.cpu80']  ?? '0'), 10) === 1
  const wifips = parseInt(String(config['sleep.wifips'] ?? '0'), 10) === 1
  if (cpu80 && wifips) return 'awake_cpu80'   // cpu80 domina visualmente
  if (wifips) return 'awake_wifips'
  if (cpu80)  return 'awake_cpu80'
  return 'awake'
}

function intersectMs(a: number, b: number, c: number, d: number): number {
  return Math.max(0, Math.min(b, d) - Math.max(a, c))
}

// ──────────────────────────────────────────────────────────────
// Linha de dados do gráfico
// ──────────────────────────────────────────────────────────────
type DayRow = {
  day: string
  dateKey: string
  // Observado
  sleeping: number
  eco: number
  listening: number
  listen_wifips: number
  listen_nowifi: number
  awake_nowifi: number
  awake_wifips: number
  awake_cpu80: number
  awake: number
  // Previsto
  awakePred: number
  sleepingPred: number
  // Sem info
  noData: number
  // Meta
  hasData: boolean
  hasPrediction: boolean
}

function emptyRow(dayKey: string): DayRow {
  const [, m, d] = dayKey.split('-')
  return {
    day: `${d}/${m}`, dateKey: dayKey,
    sleeping: 0, eco: 0, listening: 0, listen_wifips: 0, listen_nowifi: 0,
    awake_nowifi: 0, awake_wifips: 0, awake_cpu80: 0, awake: 0,
    awakePred: 0, sleepingPred: 0, noData: 0,
    hasData: false, hasPrediction: false,
  }
}

function computeDailyDurations(
  history: PowerHistoryEntry[],
  days: number,
  config: RdzConfig | null,
  mqttConnected: boolean,
): DayRow[] {
  const dayKeys = lastNDayKeys(days)
  const windows = config ? parseSleepWindows(config) : null
  const awakeSubState: DetailState = config ? predictedAwakeState(config) : 'awake'
  const now = Date.now()
  const rangeStart = localDayStartUtcMs(dayKeys[0])

  // Intervalos MQTT — último segmento termina em `now` só se conectado
  interface MqttIv { start: number; end: number; ds: DetailState }
  const mqttIvs: MqttIv[] = []
  if (history.length > 0) {
    const sorted = [...history].sort((a, b) => a.at - b.at)
    const lastEnd = mqttConnected ? now : sorted[sorted.length - 1].at
    for (let i = 0; i < sorted.length; i++) {
      const start = sorted[i].at
      const end   = i + 1 < sorted.length ? sorted[i + 1].at : lastEnd
      if (end > start && start >= rangeStart) {
        mqttIvs.push({ start, end, ds: entryDetailState(sorted[i]) })
      }
    }
  }

  const rows = new Map<string, DayRow>(dayKeys.map(k => [k, emptyRow(k)]))

  for (const [dk, row] of rows) {
    const dayStart = localDayStartUtcMs(dk)
    const dayEnd   = dayStart + DAY_MS

    // Intervalos MQTT recortados para este dia
    const dayMqtt = mqttIvs
      .map(iv => ({ ...iv, start: Math.max(iv.start, dayStart), end: Math.min(iv.end, dayEnd) }))
      .filter(iv => iv.end > iv.start)
      .sort((a, b) => a.start - b.start)

    const fillGap = (gapStart: number, gapEnd: number) => {
      if (gapEnd <= gapStart) return
      if (windows) {
        let awakeMs = 0
        for (const w of windows) {
          const wStart = dayStart + w.startMin * 60000
          const wEnd   = dayStart + (w.startMin + w.durMin) * 60000
          awakeMs += intersectMs(gapStart, gapEnd, wStart, wEnd)
        }
        const sleepMs = (gapEnd - gapStart) - awakeMs
        row[awakeSubState]  = (row[awakeSubState]  as number) + awakeMs
        row.sleepingPred   += sleepMs
        row.hasPrediction = true
      } else {
        row.noData += gapEnd - gapStart
      }
    }

    let cursor = dayStart
    for (const iv of dayMqtt) {
      if (iv.start > cursor) fillGap(cursor, iv.start)
      row[iv.ds] = (row[iv.ds] as number) + (iv.end - iv.start)
      row.hasData = true
      cursor = Math.max(cursor, iv.end)
    }
    if (cursor < dayEnd) fillGap(cursor, dayEnd)
  }

  // O fillGap acima escreveu os minutos de janela em row[awakeSubState] (que
  // pode ser 'awake', 'awake_cpu80', etc.). Para o gráfico renderizar esses
  // minutos com a COR ESCURA de "previsto", movemos para awakePred e zeramos
  // o campo original — assim as cores vivas ficam exclusivas do MQTT observado.
  for (const row of rows.values()) {
    if (!row.hasPrediction) continue
    row.awakePred += row[awakeSubState] as number
    ;(row[awakeSubState] as any) = 0
  }

  return [...rows.values()]
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '0min'
  const totalMin = Math.round(ms / 60000)
  const h = Math.floor(totalMin / 60)
  const min = totalMin % 60
  if (h === 0) return `${min}min`
  return `${h}h${min > 0 ? ` ${min}min` : ''}`
}

// ──────────────────────────────────────────────────────────────
// Tooltip
// ──────────────────────────────────────────────────────────────
const OBSERVED_STATES: DetailState[] = [
  'awake','awake_cpu80','awake_wifips','awake_nowifi',
  'listen_nowifi','listen_wifips','listening',
  'eco','sleeping',
]

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  const row: DayRow = payload[0]?.payload
  if (!row) return null

  const obs = OBSERVED_STATES.filter(s => (row[s] as number) > 0)
  const pred = (['awakePred','sleepingPred'] as const).filter(s => row[s] > 0)
  const noDataMs = row.noData

  return (
    <div className="bg-surface border border-border rounded-md p-3 text-xs min-w-[210px]">
      <p className="text-white font-medium mb-2">{label}</p>
      {obs.length > 0 && (
        <>
          <p className="text-[10px] text-faint uppercase tracking-wide mb-1">Observado via MQTT</p>
          {obs.map(s => (
            <p key={s} style={{ color: COLORS[s] }}>
              {LABELS[s]}: <span className="font-mono font-bold">{formatDuration(row[s] as number)}</span>
            </p>
          ))}
        </>
      )}
      {pred.length > 0 && (
        <>
          {obs.length > 0 && <div className="border-t border-border my-1.5" />}
          <p className="text-[10px] text-faint uppercase tracking-wide mb-1">Previsto (config firmware)</p>
          {pred.map(s => (
            <p key={s} style={{ color: COLORS[s] }}>
              {LABELS[s]}: <span className="font-mono font-bold">{formatDuration(row[s])}</span>
            </p>
          ))}
        </>
      )}
      {noDataMs > 0 && (
        <p className="text-faint mt-1">Sem dados: {formatDuration(noDataMs)}</p>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Componente principal
// ──────────────────────────────────────────────────────────────
const ALL_DETAIL_STATES: DetailState[] = [
  'sleeping','eco',
  'listen_nowifi','listen_wifips','listening',
  'awake_nowifi','awake_wifips','awake_cpu80','awake',
]

export default function PowerTimeline({ history, config, mqttConnected, onDeleteDay }: PowerTimelineProps) {
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const rows = computeDailyDurations(history, DAYS, config, mqttConnected)
  const hasConfig = !!(config && parseSleepWindows(config))
  const hasSomeObserved = rows.some(r => r.hasData)

  const doDelete = (dayKey: string) => {
    onDeleteDay(dayKey)
    setConfirmDelete(null)
  }

  return (
    <div className="panel p-5 mb-6">
      <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-1">
        <Battery size={14} className="text-blue-400" />
        Deep Sleep / Power — últimos {DAYS} dias
      </h2>
      <p className="text-[11px] text-faint mb-4 flex items-start gap-1.5">
        <Info size={11} className="flex-shrink-0 mt-0.5" />
        {hasConfig
          ? 'Cores vivas = observado via MQTT (quando o app estava aberto). Cores escuras = estimativa baseada nas janelas de recepção configuradas no firmware (inclui horas futuras de hoje).'
          : 'Registra períodos em que o app estava aberto com MQTT conectado. Carregue a configuração do receptor para estimar deep sleep nas lacunas.'}
      </p>

      {/* Gráfico de barras — label do eixo Y com botão de apagar por dia */}
      <div className="flex">
        {/* Labels customizados com botão trash */}
        <div className="flex flex-col justify-around pr-1" style={{ width: 68, paddingBottom: 20 }}>
          {rows.map(row => (
            <div key={row.dateKey} className="flex items-center justify-end gap-1" style={{ height: 32 }}>
              {confirmDelete === row.dateKey ? (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => doDelete(row.dateKey)}
                    className="px-1.5 py-0.5 bg-red-600 text-[9px] text-white rounded"
                  >ok</button>
                  <button
                    onClick={() => setConfirmDelete(null)}
                    className="px-1.5 py-0.5 bg-surface border border-border text-[9px] text-gray-400 rounded"
                  >×</button>
                </div>
              ) : (
                <>
                  <span className="text-[11px] mono" style={{ color: CHART.tick }}>{row.day}</span>
                  <button
                    onClick={() => setConfirmDelete(row.dateKey)}
                    title="Apagar dados deste dia"
                    className="text-gray-600 hover:text-red-400 transition-colors"
                  >
                    <Trash2 size={10} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>

        {/* Gráfico sem o YAxis (labels acima) */}
        <div className="flex-1 min-w-0">
          <ResponsiveContainer width="100%" height={DAYS * 32 + 20}>
            <BarChart data={rows} layout="vertical" barCategoryGap={6}>
              <XAxis
                type="number"
                domain={[0, DAY_MS]}
                tickFormatter={ms => `${Math.round(ms / 3600000)}h`}
                tick={{ fill: CHART.tick, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis type="category" dataKey="day" hide />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />

              {/* Previsto (escuro) — base */}
              <Bar dataKey="sleepingPred" stackId="a" fill={COLORS.sleepingPred} />
              <Bar dataKey="awakePred"    stackId="a" fill={COLORS.awakePred} />
              {/* Sem info */}
              <Bar dataKey="noData"       stackId="a" fill={COLORS.noData} />
              {/* Observado (vivo) — sobre o previsto */}
              <Bar dataKey="sleeping"      stackId="a" fill={COLORS.sleeping} />
              <Bar dataKey="eco"           stackId="a" fill={COLORS.eco} />
              <Bar dataKey="listen_nowifi" stackId="a" fill={COLORS.listen_nowifi} />
              <Bar dataKey="listen_wifips" stackId="a" fill={COLORS.listen_wifips} />
              <Bar dataKey="listening"     stackId="a" fill={COLORS.listening} />
              <Bar dataKey="awake_nowifi"  stackId="a" fill={COLORS.awake_nowifi} />
              <Bar dataKey="awake_wifips"  stackId="a" fill={COLORS.awake_wifips} />
              <Bar dataKey="awake_cpu80"   stackId="a" fill={COLORS.awake_cpu80} />
              <Bar dataKey="awake"         stackId="a" fill={COLORS.awake} radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Legendas */}
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
