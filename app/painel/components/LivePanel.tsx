'use client'

import { Wind, Loader2, Sun, Moon } from 'lucide-react'
import type { TodayFlight } from '@/app/lib/radiosondy'
import { isDaytime, formatGmt3 } from '@/app/lib/launchUtils'
import type { Launch } from '@/app/lib/types'
import type { SelectedTarget } from '../selection'

interface LivePanelProps {
  todayFlights: TodayFlight[]
  liveFlightChecked: boolean
  recentLaunches: Launch[] // últimos lançamentos com posição conhecida
  selected: SelectedTarget | null
  onSelect: (t: SelectedTarget | null) => void
}

// Painel esquerdo: sondas de hoje + últimos lançamentos com posição.
export default function LivePanel({
  todayFlights, liveFlightChecked, recentLaunches, selected, onSelect,
}: LivePanelProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="panel p-4">
        <p className="panel-title mb-3">Sondas de hoje</p>
        {!liveFlightChecked ? (
          <span className="text-xs text-dim flex items-center gap-1.5">
            <Loader2 size={11} className="animate-spin" /> Verificando…
          </span>
        ) : todayFlights.length === 0 ? (
          <p className="text-xs text-dim">Nenhuma sonda detectada hoje.</p>
        ) : (
          <div className="space-y-2">
            {todayFlights.map(f => {
              const isSelected = selected?.serial === f.sondeNumber
              return (
                <button
                  key={f.sondeNumber}
                  onClick={() => onSelect(isSelected ? null : {
                    serial: f.sondeNumber, lat: f.lat, lon: f.lon,
                    altitude: f.altitude, climbing: f.climbing,
                    isLive: f.isLive, lastReportUtc: f.lastReportUtc,
                  })}
                  className={`w-full text-left p-2.5 rounded border transition-all ${
                    isSelected ? 'border-blue-500/60 bg-blue-500/10' : 'border-border hover:border-border-strong bg-bg'
                  }`}
                >
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`text-xs font-semibold flex items-center gap-1 ${
                      f.isLive ? 'text-live pulse-soft' : 'text-green-400'
                    }`}>
                      <Wind size={11} />
                      {f.isLive ? (f.climbing >= 0 ? 'Subindo' : 'Descendo') : 'Pousada'}
                    </span>
                    <span className="text-xs text-emerald-400 mono">{Math.round(f.altitude).toLocaleString('pt-BR')} m</span>
                  </div>
                  <div className="mono text-xs text-amber-400 mt-1">{f.sondeNumber}</div>
                  <div className="text-[10px] text-faint mono mt-0.5">{formatGmt3(f.lastReportUtc)}</div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="panel p-4">
        <p className="panel-title mb-3">Últimos lançamentos</p>
        {recentLaunches.length === 0 ? (
          <p className="text-xs text-dim">Sem lançamentos recentes com posição.</p>
        ) : (
          <div className="space-y-1">
            {recentLaunches.map((l, i) => {
              const pos = l.position!
              const isSelected = selected?.launch != null &&
                selected.launch.date === l.date && selected.launch.time_local === l.time_local
              return (
                <button
                  key={i}
                  onClick={() => onSelect(isSelected ? null : {
                    serial: pos.sondeNumber, lat: pos.lat, lon: pos.lon,
                    altitude: pos.altitude, isLive: false, launch: l,
                  })}
                  className={`w-full text-left px-2.5 py-1.5 rounded border text-xs flex items-center gap-2 transition-all ${
                    isSelected ? 'border-blue-500/60 bg-blue-500/10' : 'border-transparent hover:border-border bg-transparent'
                  }`}
                >
                  {isDaytime(l.time_local) ? <Sun size={10} className="text-day" /> : <Moon size={10} className="text-night" />}
                  <span className="mono text-white">{l.date.slice(8)}/{l.date.slice(5, 7)}</span>
                  <span className="mono text-dim">{l.time_local}</span>
                  <span className="mono text-amber-400/80 truncate flex-1 text-right">{pos.sondeNumber}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
