'use client'

import { useEffect, useMemo, useState } from 'react'
import { Battery, ChevronLeft, ChevronRight, Trash2, ZoomIn, ZoomOut } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, ReferenceArea, CartesianGrid,
} from 'recharts'
import { CHART } from '@/app/lib/tokens'
import { GMT3 } from '@/app/lib/types'
import { type BattVoltageEntry, localBattDayKey } from '@/app/painel/hooks/useBatteryHistory'
import type { RdzConfig } from '@/app/lib/rdzConfig'

interface BatteryChartProps {
  history:     BattVoltageEntry[]
  config:      RdzConfig | null
  onDeleteDay: (dayKey: string) => void
}

const DAY_MS = 24 * 60 * 60 * 1000

function pad(n: number) { return String(n).padStart(2, '0') }

function dayStartUtcMs(dayKey: string): number {
  const [y, m, d] = dayKey.split('-').map(Number)
  return Date.UTC(y, m - 1, d, 0, 0, 0) - GMT3
}
function dayEndUtcMs(dayKey: string): number {
  return dayStartUtcMs(dayKey) + DAY_MS
}

function dayLabel(dayKey: string): string {
  const [y, m, d] = dayKey.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
    .toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
}
function dayLabelShort(dayKey: string): string {
  const [y, m, d] = dayKey.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
    .toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
}

function fmtTime(utcMs: number): string {
  const local = new Date(utcMs + GMT3)
  return `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`
}

function lineColor(v: number, vcrit?: number, vlow?: number): string {
  if (vcrit !== undefined && v <= vcrit) return '#ef4444'
  if (vlow  !== undefined && v <= vlow)  return '#f59e0b'
  return '#34d399'
}

// Gera ticks a cada `stepMs` dentro de um domínio [start, end]
function makeTicks(start: number, end: number, stepMs: number): number[] {
  const ticks: number[] = []
  const first = Math.ceil(start / stepMs) * stepMs
  for (let t = first; t <= end; t += stepMs) ticks.push(t)
  return ticks
}

// Escolhe passo dos ticks conforme o span visível
function tickStep(spanMs: number): number {
  if (spanMs <= 30 * 60_000)   return 5  * 60_000  // ≤30min → a cada 5min
  if (spanMs <= 2 * 3600_000)  return 15 * 60_000  // ≤2h   → a cada 15min
  if (spanMs <= 6 * 3600_000)  return 1  * 3600_000 // ≤6h   → a cada 1h
  return 2 * 3600_000                                // >6h   → a cada 2h
}

export default function BatteryChart({ history, config, onDeleteDay }: BatteryChartProps) {
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null)
  const [confirmDelete,  setConfirmDelete]  = useState(false)

  // ── Zoom por arrastar ────────────────────────────────────────────
  const [zoomDomain,   setZoomDomain]   = useState<[number, number] | null>(null)
  const [dragLeft,     setDragLeft]     = useState<number | null>(null)
  const [dragRight,    setDragRight]    = useState<number | null>(null)
  const [isDragging,   setIsDragging]   = useState(false)

  const vcrit  = config?.['sleep.vcrit']  ? parseFloat(config['sleep.vcrit'])  : undefined
  const vlow   = config?.['sleep.vlow']   ? parseFloat(config['sleep.vlow'])   : undefined
  const vpanic = config?.['sleep.vpanic'] ? parseFloat(config['sleep.vpanic']) : undefined

  const sortedDays = useMemo(
    () => [...new Set(history.map(e => localBattDayKey(e.at)))].sort(),
    [history]
  )

  const activeDayKey = (selectedDayKey && sortedDays.includes(selectedDayKey))
    ? selectedDayKey
    : (sortedDays[sortedDays.length - 1] ?? null)

  const activeIdx = activeDayKey ? sortedDays.indexOf(activeDayKey) : -1

  const dayData = useMemo(
    () => activeDayKey ? history.filter(e => localBattDayKey(e.at) === activeDayKey) : [],
    [history, activeDayKey]
  )

  // Resetar zoom ao trocar de dia
  useEffect(() => {
    setZoomDomain(null)
    setDragLeft(null)
    setDragRight(null)
    setIsDragging(false)
  }, [activeDayKey])

  const fullStart = activeDayKey ? dayStartUtcMs(activeDayKey) : Date.now() - DAY_MS
  const fullEnd   = activeDayKey ? dayEndUtcMs(activeDayKey)   : Date.now()

  const [xMin, xMax] = zoomDomain ?? [fullStart, fullEnd]
  const spanMs = xMax - xMin
  const xTicks = useMemo(() => makeTicks(xMin, xMax, tickStep(spanMs)), [xMin, xMax, spanMs])

  const yMin = 0
  const yMax = 6

  const latest   = dayData.length > 0 ? dayData[dayData.length - 1] : null
  const curColor = latest ? lineColor(latest.v, vcrit, vlow) : '#34d399'

  // Handlers de zoom por arrasto
  function handleMouseDown(e: any) {
    if (!e?.activeLabel) return
    const v = Number(e.activeLabel)
    setDragLeft(v)
    setDragRight(null)
    setIsDragging(true)
  }
  function handleMouseMove(e: any) {
    if (!isDragging || !e?.activeLabel) return
    setDragRight(Number(e.activeLabel))
  }
  function handleMouseUp() {
    if (isDragging && dragLeft !== null && dragRight !== null && dragLeft !== dragRight) {
      const [l, r] = dragLeft < dragRight ? [dragLeft, dragRight] : [dragRight, dragLeft]
      // Ignorar seleção menor que 1 min (clique acidental)
      if (r - l > 60_000) setZoomDomain([l, r])
    }
    setDragLeft(null)
    setDragRight(null)
    setIsDragging(false)
  }

  const selectionLeft  = dragLeft  !== null && dragRight !== null ? Math.min(dragLeft, dragRight)  : null
  const selectionRight = dragLeft  !== null && dragRight !== null ? Math.max(dragLeft, dragRight)   : null

  if (history.length === 0) {
    return (
      <div className="panel p-5 mb-6">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-2">
          <Battery size={14} className="text-emerald-400" />
          Tensão da bateria — últimos 7 dias
        </h2>
        <p className="text-xs text-faint">Sem dados — aguardando leituras via MQTT.</p>
      </div>
    )
  }

  return (
    <div className="panel p-5 mb-6">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <Battery size={14} className="text-emerald-400" />
          Tensão da bateria
        </h2>
        <div className="flex items-center gap-2">
          {zoomDomain ? (
            <button
              onClick={() => setZoomDomain(null)}
              className="flex items-center gap-1 px-2 py-0.5 rounded border border-blue-500/50 bg-blue-600/20 text-blue-300 text-[10px] hover:bg-blue-600/30 transition-colors"
              title="Remover zoom"
            >
              <ZoomOut size={11} /> Resetar zoom
            </button>
          ) : (
            <span className="text-[10px] text-faint flex items-center gap-1">
              <ZoomIn size={10} /> arraste para zoom
            </span>
          )}
          {latest && (
            <span className="text-sm font-mono font-semibold" style={{ color: curColor }}>
              {latest.v.toFixed(3)} V
            </span>
          )}
        </div>
      </div>

      {/* Navegação de dia */}
      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={() => { setSelectedDayKey(sortedDays[activeIdx - 1]); setConfirmDelete(false) }}
          disabled={activeIdx <= 0}
          className="p-1 rounded border border-border text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Dia anterior"
        >
          <ChevronLeft size={14} />
        </button>
        <span className="text-xs text-white flex-1 text-center">
          {activeDayKey ? dayLabel(activeDayKey) : '—'}
        </span>
        <button
          onClick={() => { setSelectedDayKey(sortedDays[activeIdx + 1]); setConfirmDelete(false) }}
          disabled={activeIdx >= sortedDays.length - 1}
          className="p-1 rounded border border-border text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Próximo dia"
        >
          <ChevronRight size={14} />
        </button>
        {sortedDays.length > 1 && (
          <span className="text-[10px] text-faint mono ml-1">
            {activeIdx + 1}/{sortedDays.length}
          </span>
        )}
      </div>

      {/* Gráfico */}
      {dayData.length === 0 ? (
        <p className="text-xs text-faint py-8 text-center">Sem dados para este dia.</p>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <LineChart
            data={dayData}
            margin={{ top: 4, right: 56, bottom: 4, left: 0 }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            style={{ cursor: isDragging ? 'crosshair' : 'default' }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />

            {/* Zona de alerta crítico (apenas abaixo de vpanic) */}
            {vpanic !== undefined && isFinite(vpanic) && (
              <ReferenceArea y1={yMin} y2={vpanic} fill="#450a0a" fillOpacity={0.5} />
            )}

            {/* Seleção de zoom (arrastar) */}
            {selectionLeft !== null && selectionRight !== null && (
              <ReferenceArea
                x1={selectionLeft} x2={selectionRight}
                fill="#3b82f6" fillOpacity={0.15}
                stroke="#3b82f6" strokeOpacity={0.5}
              />
            )}

            {/* Linhas de limiar */}
            {vlow   !== undefined && isFinite(vlow)   && (
              <ReferenceLine y={vlow}   stroke="#f59e0b" strokeDasharray="4 2"
                label={{ value: `vlow ${vlow}V`,   fill: '#f59e0b', fontSize: 9, position: 'right' }} />
            )}
            {vcrit  !== undefined && isFinite(vcrit)  && (
              <ReferenceLine y={vcrit}  stroke="#ef4444" strokeDasharray="4 2"
                label={{ value: `vcrit ${vcrit}V`,  fill: '#ef4444', fontSize: 9, position: 'right' }} />
            )}
            {vpanic !== undefined && isFinite(vpanic) && (
              <ReferenceLine y={vpanic} stroke="#7f1d1d" strokeDasharray="4 2"
                label={{ value: `panic ${vpanic}V`, fill: '#991b1b', fontSize: 9, position: 'right' }} />
            )}

            <XAxis
              dataKey="at"
              type="number"
              scale="time"
              domain={[xMin, xMax]}
              ticks={xTicks}
              tickFormatter={t => {
                const local = new Date(t + GMT3)
                const h = local.getUTCHours()
                const min = local.getUTCMinutes()
                return min === 0 ? `${pad(h)}h` : `${pad(h)}:${pad(min)}`
              }}
              tick={{ fill: CHART.tick, fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              domain={[yMin, yMax]}
              tick={{ fill: CHART.tick, fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={40}
              tickFormatter={v => `${(v as number).toFixed(1)}V`}
            />
            <Tooltip
              contentStyle={{ background: '#111827', border: '1px solid #334155', borderRadius: 6, fontSize: 11 }}
              labelFormatter={t => fmtTime(Number(t))}
              formatter={(v: unknown) => [`${(v as number).toFixed(3)} V`, 'Tensão']}
              cursor={{ stroke: '#475569', strokeWidth: 1 }}
              // Suprime tooltip durante seleção de zoom
              active={isDragging ? false : undefined}
            />
            <Line
              type="monotone"
              dataKey="v"
              stroke={curColor}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      )}

      {/* Legenda dos limiares */}
      {(vcrit !== undefined || vlow !== undefined || vpanic !== undefined) && (
        <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-faint">
          {vlow   !== undefined && <span><span style={{ color: '#f59e0b' }}>■</span> vlow {vlow}V</span>}
          {vcrit  !== undefined && <span><span style={{ color: '#ef4444' }}>■</span> vcrit {vcrit}V</span>}
          {vpanic !== undefined && <span><span style={{ color: '#7f1d1d' }}>■</span> panic {vpanic}V</span>}
        </div>
      )}

      {/* Miniaturas dos dias */}
      {sortedDays.length > 1 && (
        <div className="mt-3 pt-3 border-t border-border flex flex-wrap gap-1.5">
          {sortedDays.map(dk => (
            <button
              key={dk}
              onClick={() => { setSelectedDayKey(dk); setConfirmDelete(false) }}
              className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${
                dk === activeDayKey
                  ? 'bg-blue-600/30 border-blue-500/60 text-blue-300'
                  : 'border-border text-gray-500 hover:text-white hover:border-border-strong'
              }`}
            >
              {dayLabelShort(dk)}
            </button>
          ))}
        </div>
      )}

      {/* Apagar dia ativo */}
      {activeDayKey && (
        <div className="mt-2 flex items-center gap-2">
          {confirmDelete ? (
            <>
              <span className="text-[11px] text-gray-400">Apagar dados de {dayLabelShort(activeDayKey)}?</span>
              <button
                onClick={() => {
                  onDeleteDay(activeDayKey)
                  setConfirmDelete(false)
                  if (activeIdx > 0) setSelectedDayKey(sortedDays[activeIdx - 1])
                  else setSelectedDayKey(null)
                }}
                className="px-2 py-0.5 rounded bg-red-900 text-red-300 text-[10px] hover:bg-red-800 transition-colors"
              >ok</button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-2 py-0.5 rounded bg-surface text-gray-400 text-[10px] hover:text-white transition-colors"
              >×</button>
            </>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-1 text-[10px] text-gray-600 hover:text-red-400 transition-colors"
            >
              <Trash2 size={10} /> Apagar este dia
            </button>
          )}
        </div>
      )}
    </div>
  )
}
