'use client'

import { useEffect, useMemo, useState } from 'react'
import { BarChart3, Radio } from 'lucide-react'
import { Station, DEFAULT_STATION, getSelectedStation, setSelectedStation } from '@/app/lib/stations'
import { getCacheByYear } from '@/app/lib/cache'
import { computeYearMetrics, landingDensity } from '@/app/lib/metrics'
import type { Launch } from '@/app/lib/types'
import StationPicker from '../historico/components/StationPicker'
import FlightMetricsCards from './components/FlightMetricsCards'
import LandingHeatmap from './components/LandingHeatmap'
import DriftRose from './components/DriftRose'
import StationCompare from './components/StationCompare'

export default function AnalyticsPage() {
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(currentYear)
  const [station, setStation] = useState<Station>(DEFAULT_STATION)
  const [showStationPicker, setShowStationPicker] = useState(false)
  const [launches, setLaunches] = useState<Launch[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setStation(getSelectedStation())
  }, [])

  // Pinta do cache local; complementa com o servidor (positions/flightStats
  // vêm do YearStore, que o cron enriquece).
  useEffect(() => {
    const cached = getCacheByYear(year, station.id).flatMap(c => c.launches)
    setLaunches(cached)

    let cancelled = false
    async function sync() {
      setLoading(true)
      try {
        const res = await fetch(`/api/sounding?action=year&station=${station.id}&year=${year}`)
        if (!res.ok) return
        const json = await res.json()
        if (cancelled || json.error) return
        if (Array.isArray(json.launches)) setLaunches(json.launches)
      } catch {
        // cache local já pintou
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    sync()
    return () => { cancelled = true }
  }, [year, station.id])

  const metrics = useMemo(() => computeYearMetrics(launches, station), [launches, station])
  const cells = useMemo(() => landingDensity(launches), [launches])
  const years = Array.from({ length: 5 }, (_, i) => currentYear - i)

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <BarChart3 size={22} className="text-blue-400" />
            Análises
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Métricas de voo e padrões de pouso — {station.name}
            {loading && <span className="text-faint"> · sincronizando…</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowStationPicker(v => !v)}
            title="Trocar estação"
            className="flex items-center gap-2 px-3 py-2 bg-surface border border-border rounded-md text-sm text-white hover:border-border-strong transition-all max-w-[180px]"
          >
            <Radio size={14} className="text-blue-400 flex-shrink-0" />
            <span className="truncate">{station.name}</span>
          </button>
          <select
            value={year}
            onChange={e => setYear(Number(e.target.value))}
            className="bg-surface border border-border rounded-md text-sm text-white px-3 py-2 outline-none focus:border-blue-500 cursor-pointer"
          >
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {showStationPicker && (
        <div className="mb-6 -mt-3">
          <StationPicker
            station={station}
            onSelect={s => { setStation(s); setSelectedStation(s); setShowStationPicker(false) }}
          />
        </div>
      )}

      <FlightMetricsCards metrics={metrics} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <div className="lg:col-span-2">
          <LandingHeatmap station={station} cells={cells} />
        </div>
        <DriftRose driftByOctant={metrics.driftByOctant} />
      </div>

      <StationCompare year={year} baseStation={station} baseLaunches={launches} />
    </div>
  )
}
