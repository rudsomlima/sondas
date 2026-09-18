'use client'

import { Wind, Loader2, Sun, Moon, Antenna, MapPinOff } from 'lucide-react'
import { flightStatus, FLIGHT_STATUS_LABEL, type TodayFlight } from '@/app/lib/radiosondy'
import { isDaytime, formatGmt3, launchDisplayTime } from '@/app/lib/launchUtils'
import type { Launch } from '@/app/lib/types'
import type { SelectedTarget } from '../selection'

interface LivePanelProps {
  todayFlights: TodayFlight[]
  liveFlightChecked: boolean
  recentLaunches: Launch[]
  selected: SelectedTarget | null
  onSelect: (t: SelectedTarget | null) => void
  mySerials?: Set<string> // serials sendo recebidos pelo receptor do usuário
}

// Painel esquerdo: sondas de hoje + últimos lançamentos com posição.
export default function LivePanel({
  todayFlights, liveFlightChecked, recentLaunches, selected, onSelect, mySerials,
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
              const status = flightStatus(f)
              return (
                <button
                  key={f.sondeNumber}
                  onClick={() => onSelect(isSelected ? null : {
                    serial: f.sondeNumber, lat: f.lat, lon: f.lon,
                    altitude: f.altitude, climbing: f.climbing,
                    isLive: f.isLive, lastReportUtc: f.lastReportUtc,
                    source: f.source,
                  })}
                  className={`w-full text-left p-2.5 rounded border transition-all ${
                    isSelected ? 'border-blue-500/60 bg-blue-500/10' : 'border-border hover:border-border-strong bg-bg'
                  }`}
                >
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`text-xs font-semibold flex items-center gap-1 ${
                      f.isLive ? 'text-live pulse-soft' : status === 'signal-lost' ? 'text-yellow-400' : 'text-green-400'
                    }`}
                      title={status === 'signal-lost' ? 'Parou de transmitir ainda descendo, longe do chão — pouso não confirmado' : undefined}>
                      <Wind size={11} />
                      {FLIGHT_STATUS_LABEL[status]}
                    </span>
                    <span className="text-xs text-emerald-400 mono">{Math.round(f.altitude).toLocaleString('pt-BR')} m</span>
                    <span className={`text-[9px] mono ${f.source === 'sondehub' || f.source === 'radiosondy-approx' ? 'text-yellow-400' : 'text-faint'}`}
                      title={f.source === 'sondehub' || f.source === 'radiosondy-approx' ? 'Associação por proximidade; ainda não confirma a estação de lançamento' : 'Fonte vinculada à estação'}>
                      {f.source === 'sondehub-site' ? 'S/site' : f.source === 'radiosondy' ? 'R' : '~geo'}
                    </span>
                    {mySerials?.has(f.sondeNumber) && (
                      <span className="badge badge-info text-[9px] px-1.5 py-0 pulse-soft">
                        <Antenna size={9} /> RX local
                      </span>
                    )}
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
          <p className="text-xs text-dim">Sem lançamentos recentes.</p>
        ) : (
          <div className="space-y-1">
            {recentLaunches.map((l, i) => {
              const pos = l.position
              // Horário do primeiro quadro recebido da sonda; '~' = ainda sem
              // esse dado, mostrando o slot sinótico nominal.
              const { time, exact } = launchDisplayTime(l)
              const isSelected = selected?.launch != null &&
                selected.launch.date === l.date && selected.launch.time_local === l.time_local
              return (
                <button
                  key={i}
                  onClick={() => pos && onSelect(isSelected ? null : {
                    serial: pos.sondeNumber, lat: pos.lat, lon: pos.lon,
                    altitude: pos.altitude, isLive: false, launch: l,
                  })}
                  disabled={!pos}
                  className={`w-full text-left px-2.5 py-1.5 rounded border text-xs flex items-center gap-2 transition-all ${
                    isSelected ? 'border-blue-500/60 bg-blue-500/10' : 'border-transparent hover:border-border bg-transparent'
                  }`}
                >
                  {isDaytime(time) ? <Sun size={10} className="text-day" /> : <Moon size={10} className="text-night" />}
                  <span className="mono text-white">{l.date.slice(8)}/{l.date.slice(5, 7)}</span>
                  <span className="mono text-dim" title={exact ? 'Primeiro dado recebido da sonda (radiosondy.info)' : 'Horário sinótico nominal — sonda ainda sem primeiro quadro conhecido'}>
                    {exact ? '' : '~'}{time}
                  </span>
                  {pos ? (
                    <span className="mono text-amber-400/80 truncate flex-1 text-right">{pos.sondeNumber}</span>
                  ) : (
                    <span className="text-faint truncate flex-1 text-right flex items-center justify-end gap-1"><MapPinOff size={10} /> posição pendente</span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
