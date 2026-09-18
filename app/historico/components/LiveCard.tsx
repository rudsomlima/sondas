'use client'

import { CheckCircle2, XCircle, Clock, Wind, Sun, Moon, Loader2 } from 'lucide-react'
import { sondeHubUrl, flightStatus, FLIGHT_STATUS_LABEL, TodayFlight } from '@/app/lib/radiosondy'
import { isDaytime, sameLaunch, formatGmt3, launchDisplayTime } from '@/app/lib/launchUtils'
import type { Launch, TodayData } from '@/app/lib/types'

interface LiveCardProps {
  todayData: TodayData | null
  todayLoading: boolean
  todayError?: string | null
  liveError?: string | null
  todayFlights: TodayFlight[]
  liveFlightChecked: boolean
  lastFetchAt: Date | null
  selectedLaunch: Launch | null
  onExpandMonth: (month: number) => void
  onSelectLaunch: (l: Launch | null) => void
}

// Card "Ao vivo": estado de hoje combinando Wyoming (horário oficial) com
// radiosondy.info/sondehub.org (voo quase em tempo real).
export default function LiveCard({
  todayData, todayLoading, todayError, liveError, todayFlights, liveFlightChecked, lastFetchAt,
  selectedLaunch, onExpandMonth, onSelectLaunch,
}: LiveCardProps) {
  // Sondehub casa por proximidade geográfica (raio), então sozinho pode
  // pegar um voo de outra estação passando perto — só conta como "teve voo"
  // quando a Wyoming (fonte oficial) já confirmou o lançamento de hoje ou o
  // radiosondy.info (amarrado ao startplace exato) achou a sonda.
  const hadFlightToday = todayData?.launched_today || todayFlights.some(f => f.source === 'radiosondy' || f.source === 'sondehub-site')
  const hasUnconfirmedCandidate = !hadFlightToday && todayFlights.length > 0
  const unknown = !todayLoading && !todayData?.launched_today && todayFlights.length === 0 && !!todayError
  // Sem confirmação (Wyoming/radiosondy.info), não deixa matches soltos do
  // sondehub inflarem a contagem exibida — o card já mostraria "Nenhum
  // lançamento" enquanto o número dissesse o contrário.
  const count = Math.max(todayData?.count ?? 0, hadFlightToday ? todayFlights.length : 0)
  const todayMonth = todayData?.today
    ? parseInt(todayData.today.split('-')[1], 10)
    : new Date(Date.now() - 3 * 60 * 60 * 1000).getUTCMonth() + 1

  return (
    <div
      onClick={() => onExpandMonth(todayMonth)}
      title="Ver este mês no histórico"
      className={`relative panel p-5 mb-6 border-2 ring-2 ring-blue-500/30 shadow-lg shadow-blue-500/10 bg-blue-500/[0.04] cursor-pointer ${
        todayLoading ? 'border-border' : unknown || hasUnconfirmedCandidate ? 'border-yellow-500/30' : hadFlightToday ? 'border-green-500/40' : 'border-red-500/25'
      }`}
    >
      <span className="absolute -top-2 left-3 px-1.5 py-0.5 rounded-full bg-blue-600 text-[9px] font-semibold text-white tracking-wide uppercase">
        Ao vivo
      </span>
      <div className="text-xs text-gray-400 mb-1 flex items-center gap-1.5">
        {todayLoading ? <Clock size={12} /> : hadFlightToday
          ? <CheckCircle2 size={12} className="text-green-400" />
          : <XCircle size={12} className="text-red-400" />}
        Hoje
      </div>
      {todayLoading ? (
        <div className="text-3xl font-bold text-gray-400 mono">—</div>
      ) : unknown ? (
        <div>
          <div className="text-xl font-bold text-yellow-300 mono">INDETERMINADO</div>
          <p className="text-xs text-dim mt-1">As fontes não responderam; isso não significa ausência de lançamento.</p>
        </div>
      ) : (
        <>
          <div className="text-3xl font-bold text-white mono">{count}</div>
          {hasUnconfirmedCandidate && <div className="text-xs text-yellow-300 mt-1">{todayFlights.length} telemetria(s) próxima(s), ainda sem vínculo confirmado com esta estação</div>}
          {todayData?.launched_today ? (
            <div className="flex flex-wrap gap-x-2 gap-y-1 mt-1">
              {todayData.launches.map((l, i) => {
                const display = launchDisplayTime(l)
                return (
                <button
                  key={i}
                  onClick={e => {
                    e.stopPropagation()
                    onExpandMonth(l.month)
                    onSelectLaunch(sameLaunch(selectedLaunch, l) ? null : l)
                  }}
                  title={display.exact
                    ? 'Primeiro dado recebido da sonda (radiosondy.info) — clique pra ver no mapa'
                    : 'Horário sinótico nominal — clique pra ver no mapa a posição mais próxima'}
                  className={`text-xs mono font-medium hover:underline flex items-center gap-1 ${
                    isDaytime(display.time) ? 'text-amber-400' : 'text-indigo-400'
                  }`}
                >
                  {isDaytime(display.time) ? <Sun size={10} /> : <Moon size={10} />}
                  {display.exact ? '' : '~'}{display.time}
                </button>
                )
              })}
            </div>
          ) : !hadFlightToday ? (
            <div className="text-xs text-gray-400 mt-1">Nenhum lançamento</div>
          ) : null}
          {(hadFlightToday || hasUnconfirmedCandidate || !liveFlightChecked) && (
            <div className="mt-2 pt-2 border-t border-border flex flex-col gap-1.5">
              {!liveFlightChecked ? (
                <span className="text-xs text-gray-400 flex items-center gap-1">
                  <Loader2 size={10} className="animate-spin" /> Verificando voo…
                </span>
              ) : todayFlights.length > 0 ? (
                todayFlights.map(f => (
                  <div key={f.sondeNumber} className="flex flex-col">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`text-xs font-semibold flex items-center gap-1 ${
                        f.isLive ? 'text-red-400' : flightStatus(f) === 'signal-lost' ? 'text-yellow-400' : 'text-green-400'
                      }`}>
                        <Wind size={11} />
                        {f.isLive
                          ? (f.climbing >= 0 ? 'Em voo (subindo)' : 'Em voo (descendo)')
                          : FLIGHT_STATUS_LABEL[flightStatus(f)]}
                      </span>
                      <span className="text-xs text-emerald-400 mono font-medium">
                        {Math.round(f.altitude).toLocaleString('pt-BR')} m
                      </span>
                      <span className="text-xs text-amber-400 mono font-medium">{f.sondeNumber}</span>
                      <span className="text-[9px] text-faint mono">{f.source === 'sondehub-site' ? 'SondeHub/site' : f.source}</span>
                      <a
                        href={sondeHubUrl(f.sondeNumber, f.lat, f.lon)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="text-xs text-indigo-400 hover:underline"
                      >
                        Ver no SondeHub
                      </a>
                    </div>
                    <span className="text-[11px] text-violet-400/80 mono" title="Último report (GMT-3)">
                      {formatGmt3(f.lastReportUtc)}
                    </span>
                  </div>
                ))
              ) : (
                <span className="text-xs text-gray-400">Sem dados de voo do radiosondy.info ainda</span>
              )}
            </div>
          )}
          {lastFetchAt && (
            <p className="text-[10px] text-gray-400 mt-2">
              Última busca pelo app: {lastFetchAt.toLocaleTimeString('pt-BR', { hour12: false })}
            </p>
          )}
          {liveError && <p className="text-[10px] text-yellow-400 mt-1">Telemetria parcial; última posição conhecida mantida.</p>}
        </>
      )}
    </div>
  )
}
