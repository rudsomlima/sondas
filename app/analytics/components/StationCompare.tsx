'use client'

import { useCallback, useState } from 'react'
import { GitCompareArrows, Loader2, Plus, X } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { CHART } from '@/app/lib/tokens'
import { MONTHS } from '@/app/lib/launchUtils'
import { computeYearMetrics, YearMetrics } from '@/app/lib/metrics'
import { SOUTH_AMERICA_STATIONS, findStation, Station } from '@/app/lib/stations'
import type { Launch } from '@/app/lib/types'

const COMPARE_COLORS = ['#3b82f6', '#34d399', '#a78bfa']

interface CompareEntry {
  station: Station
  metrics: YearMetrics
  byMonth: number[]
}

interface StationCompareProps {
  year: number
  baseStation: Station
  baseLaunches: Launch[]
}

// Comparativo de até 3 estações: lançamentos/mês + métricas de voo.
export default function StationCompare({ year, baseStation, baseLaunches }: StationCompareProps) {
  const [entries, setEntries] = useState<CompareEntry[]>([])
  const [adding, setAdding] = useState(false)
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const baseEntry: CompareEntry = {
    station: baseStation,
    metrics: computeYearMetrics(baseLaunches, baseStation),
    byMonth: countByMonth(baseLaunches),
  }

  function countByMonth(launches: Launch[]): number[] {
    const counts = new Array(12).fill(0)
    for (const l of launches) counts[l.month - 1]++
    return counts
  }

  const addStation = useCallback(async (id: string) => {
    const st = findStation(id)
    if (!st || entries.some(e => e.station.id === id) || id === baseStation.id) return
    setLoading(id)
    setError(null)
    try {
      const res = await fetch(`/api/sounding?action=year&station=${id}&year=${year}`)
      if (!res.ok) throw new Error(`Erro ${res.status}`)
      const json = await res.json()
      const launches: Launch[] = json.launches ?? []
      setEntries(prev => [...prev, {
        station: st,
        metrics: computeYearMetrics(launches, st),
        byMonth: countByMonth(launches),
      }].slice(0, 2))
    } catch (e: any) {
      setError(`Falha ao carregar ${st.name}: ${e.message}`)
    } finally {
      setLoading(null)
      setAdding(false)
    }
  }, [entries, baseStation.id, year])

  const all = [baseEntry, ...entries]
  const chartData = MONTHS.map((name, i) => {
    const row: Record<string, any> = { name }
    for (const e of all) row[e.station.name.split(',')[0]] = e.byMonth[i]
    return row
  })

  return (
    <div className="panel p-5">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <GitCompareArrows size={15} className="text-blue-400" />
          Comparativo entre estações — {year}
        </h2>
        {all.length < 3 && (
          adding ? (
            <select
              autoFocus
              onChange={e => e.target.value && addStation(e.target.value)}
              onBlur={() => setAdding(false)}
              defaultValue=""
              className="bg-surface border border-border rounded text-xs text-white px-2 py-1.5 outline-none focus:border-blue-500 max-w-[220px]"
            >
              <option value="" disabled>Escolher estação…</option>
              {SOUTH_AMERICA_STATIONS
                .filter(s => s.id !== baseStation.id && !entries.some(e => e.station.id === s.id))
                .map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          ) : (
            <button
              onClick={() => setAdding(true)}
              disabled={!!loading}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-blue-600/20 border border-blue-500/30 rounded text-xs text-blue-300 hover:bg-blue-600/30 transition-all disabled:opacity-50"
            >
              {loading ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
              Adicionar estação
            </button>
          )
        )}
      </div>

      {error && <p className="text-xs text-red-400 mb-3">{error}</p>}
      {loading && <p className="text-xs text-dim mb-3">Sincronizando estação (primeira vez pode demorar)…</p>}

      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData} barGap={2}>
          <XAxis dataKey="name" tick={{ fill: CHART.tick, fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: CHART.tick, fontSize: 11 }} axisLine={false} tickLine={false} width={28} allowDecimals={false} />
          <Tooltip
            cursor={{ fill: 'rgba(255,255,255,0.03)' }}
            contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {all.map((e, i) => (
            <Bar key={e.station.id} dataKey={e.station.name.split(',')[0]} fill={COMPARE_COLORS[i]} radius={[3, 3, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>

      {/* Tabela de métricas */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-dim border-b border-border">
              <th className="py-2 pr-3 font-medium">Estação</th>
              <th className="py-2 pr-3 font-medium">Lançamentos</th>
              <th className="py-2 pr-3 font-medium">Com posição</th>
              <th className="py-2 pr-3 font-medium">Estouro médio</th>
              <th className="py-2 pr-3 font-medium">Deriva média</th>
              <th className="py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {all.map((e, i) => (
              <tr key={e.station.id} className="border-b border-border/50">
                <td className="py-2 pr-3">
                  <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ background: COMPARE_COLORS[i] }} />
                  <span className="text-white">{e.station.name.split(',')[0]}</span>
                  <span className="text-faint mono ml-1.5">{e.station.id}</span>
                </td>
                <td className="py-2 pr-3 mono text-white">{e.metrics.totalLaunches}</td>
                <td className="py-2 pr-3 mono text-white">
                  {e.metrics.totalLaunches > 0 ? `${Math.round(e.metrics.withPosition / e.metrics.totalLaunches * 100)}%` : '—'}
                </td>
                <td className="py-2 pr-3 mono text-white">
                  {e.metrics.meanBurstAltM ? `${(e.metrics.meanBurstAltM / 1000).toFixed(1)} km` : '—'}
                </td>
                <td className="py-2 pr-3 mono text-white">
                  {e.metrics.meanDriftKm ? `${Math.round(e.metrics.meanDriftKm)} km` : '—'}
                </td>
                <td className="py-2 text-right">
                  {i > 0 && (
                    <button
                      onClick={() => setEntries(prev => prev.filter(x => x.station.id !== e.station.id))}
                      className="text-gray-500 hover:text-red-400"
                      title="Remover do comparativo"
                    >
                      <X size={12} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
