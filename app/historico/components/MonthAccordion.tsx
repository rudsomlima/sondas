'use client'

import { ChevronDown, Wind, Trash2, Sun, Moon, Map as MapIcon, MapPin } from 'lucide-react'
import LaunchMap from '../LaunchMap'
import YearMap from '../YearMap'
import SourceBadges from '@/app/components/ui/SourceBadges'
import { computeConfidence } from '@/app/lib/confidence'
import { MONTHS, MONTHS_FULL, isDaytime, sameLaunch, launchKey, launchDisplayTime } from '@/app/lib/launchUtils'
import { isValidPosition } from '@/app/lib/launchData'
import type { Station } from '@/app/lib/stations'
import type { Launch, LaunchPosition } from '@/app/lib/types'
import type { SondePoint } from '@/app/lib/sondePoints'
import type { SondeRecord } from '@/app/lib/sondeRegistry'
import { useWyomingEnabled } from '@/app/lib/appSettings'

interface MonthAccordionProps {
  year: number
  station: Station
  byMonth: Record<number, Launch[]>
  expandedMonth: number | null
  setExpandedMonth: (m: number | null) => void
  selectedLaunch: Launch | null
  setSelectedLaunch: (l: Launch | null) => void
  noMatchLaunches: Set<string>
  setNoMatchLaunches: (updater: (prev: Set<string>) => Set<string>) => void
  showYearMap: boolean
  setShowYearMap: (v: boolean) => void
  deleteMonthConfirm: number | null
  onRequestDeleteMonth: (m: number | null) => void
  onConfirmDeleteMonth: () => void
  monthPoints?: SondePoint[] // sondas de todas as fontes do mês aberto
  records?: Map<string, SondeRecord> // registro de sondas (R2) — dados mais completos por sonda
  onLaunchPosition?: (launch: Launch, position: LaunchPosition) => void
  onYearPoints?: (points: SondePoint[]) => void
}

// Acordeão mês → dia → horários, com badges de fonte (W/R/S), LaunchMap
// embutido e mapa do ano.
export default function MonthAccordion({
  year, station, byMonth,
  expandedMonth, setExpandedMonth,
  selectedLaunch, setSelectedLaunch,
  noMatchLaunches, setNoMatchLaunches,
  showYearMap, setShowYearMap,
  deleteMonthConfirm, onRequestDeleteMonth, onConfirmDeleteMonth,
  monthPoints, records, onLaunchPosition, onYearPoints,
}: MonthAccordionProps) {
  const wyomingOn = useWyomingEnabled()
  return (
    <div className="panel overflow-hidden mb-6">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <Wind size={15} className="text-blue-400" />
          Detalhe por mês
        </h2>
        <button
          onClick={() => {
            setShowYearMap(!showYearMap)
            setSelectedLaunch(null)
          }}
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-surface border border-border rounded-md text-xs text-green-400 hover:text-white hover:border-border-strong transition-all"
          title="Ver no mapa todas as sondas do ano"
        >
          <MapIcon size={13} />
          {showYearMap ? 'Fechar mapa do ano' : 'Ver mapa do ano'}
        </button>
      </div>

      {showYearMap && (
        <div className="px-5 pt-4 bg-bg">
          <YearMap
            year={year}
            station={station.id}
            launches={Object.values(byMonth).flat()}
            onPoints={onYearPoints}
            onClose={() => setShowYearMap(false)}
          />
        </div>
      )}

      <div className="divide-y divide-border">
        {MONTHS.map((mon, idx) => {
          const m = idx + 1
          const launches = byMonth[m] ?? []
          const days = new Set(launches.map(l => l.date)).size
          const tracked = launches.filter(l => isValidPosition(l.position)).length
          const isOpen = expandedMonth === m

          return (
            <div key={m}>
              <div className="flex items-center px-5 py-3 hover:bg-white/[0.02] transition-colors gap-2">
                <button
                  onClick={() => setExpandedMonth(isOpen ? null : m)}
                  className="flex-1 flex items-center gap-3 text-left"
                >
                  <div className="w-10 text-xs text-gray-400 mono font-medium">{mon}</div>
                  <div className="flex-1 text-sm text-gray-300">{MONTHS_FULL[idx]}</div>
                  {launches.length > 0 ? (
                    <>
                      <span className="badge badge-info mono text-xs">{launches.length}</span>
                      <span className="text-xs text-gray-400">{days} dia{days !== 1 ? 's' : ''}</span>
                      <span
                        className="text-xs text-emerald-400 flex items-center gap-1 whitespace-nowrap"
                        title="Lançamentos com posição de rastreio válida"
                      >
                        <MapPin size={11} />
                        {tracked} rastreado{tracked !== 1 ? 's' : ''}
                      </span>
                    </>
                  ) : (
                    <span className="text-xs text-gray-400">sem dados</span>
                  )}
                  <ChevronDown
                    size={14}
                    className={`text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                {launches.length > 0 && (
                  deleteMonthConfirm === m ? (
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <span className="text-xs text-yellow-400">Remover mês?</span>
                      <button
                        onClick={onConfirmDeleteMonth}
                        className="px-2 py-1 bg-red-600 text-xs text-white rounded hover:bg-red-700 transition-all"
                      >
                        Confirmar
                      </button>
                      <button
                        onClick={() => onRequestDeleteMonth(null)}
                        className="px-2 py-1 bg-surface-2 text-xs text-gray-400 rounded hover:text-white transition-all"
                      >
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => onRequestDeleteMonth(m)}
                      className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded transition-all"
                      title="Deletar mês"
                    >
                      <Trash2 size={14} />
                    </button>
                  )
                )}
              </div>

              {isOpen && launches.length > 0 && (
                <div className="px-5 pb-4 bg-bg">
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mt-3">
                    {Object.entries(
                      launches.reduce((acc: Record<string, Launch[]>, l) => {
                        (acc[l.date] ??= []).push(l)
                        return acc
                      }, {})
                    )
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([date, dayLaunches]) => (
                        <div
                          key={date}
                          className={`p-3 bg-surface border rounded text-xs ${
                            selectedLaunch?.date === date ? 'border-red-500' : 'border-border'
                          }`}
                        >
                          <div className="text-gray-400 text-[11px] mb-1.5">
                            {new Date(date + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'short', day: 'numeric' })}
                          </div>
                          <div className="flex flex-wrap gap-x-2 gap-y-1">
                            {[...dayLaunches]
                              .map(l => ({ l, display: launchDisplayTime(l) }))
                              .sort((a, b) => a.display.time.localeCompare(b.display.time))
                              .map(({ l, display }, i) => {
                                const noMatch = l.radiosondyMatch === 'no' || noMatchLaunches.has(launchKey(l))
                                const sourceLabel = l.source === 'sondehub' ? 'sondehub.org' : 'radiosondy.info'
                                const title = display.exact
                                  ? `Primeiro dado recebido da sonda${l.position ? ` ${l.position.sondeNumber}` : ''} (radiosondy.info)`
                                  : l.approx
                                  ? l.association === 'geographic'
                                    ? 'Candidato aproximado do sondehub.org por proximidade geográfica; pode pertencer a outra estação'
                                  : !wyomingOn
                                    ? `Horário aproximado via ${sourceLabel} — consulta à Wyoming desativada em Configurações`
                                  : station.wyomingSupported === false
                                    ? `Horário aproximado via ${sourceLabel} — Wyoming não cobre esta estação`
                                    : `Horário aproximado via ${sourceLabel} — Wyoming ainda não publicou este lançamento`
                                  : noMatch
                                    ? 'Sem correspondência no radiosondy.info'
                                    : 'Ver no mapa a posição mais próxima após o lançamento'
                                return (
                                  <button
                                    key={i}
                                    onClick={() => {
                                      // Mesmo marcado "sem correspondência" (o cron marca isso
                                      // cedo, antes do pouso ser registrado), o mapa ainda tenta
                                      // todas as fontes — só ele mostra o aviso se nada aparecer.
                                      setShowYearMap(false)
                                      setSelectedLaunch(sameLaunch(selectedLaunch, l) ? null : l)
                                    }}
                                    title={title}
                                    className={`mono font-semibold flex items-center gap-1 hover:underline ${
                                      isDaytime(display.time) ? 'text-amber-400' : 'text-indigo-400'
                                    }`}
                                  >
                                    {isDaytime(display.time) ? <Sun size={10} /> : <Moon size={10} />}
                                    {!display.exact && '~'}{display.time}
                                    <SourceBadges confidence={computeConfidence(l, station.wyomingSupported !== false, wyomingOn)} />
                                  </button>
                                )
                              })}
                          </div>
                        </div>
                      ))}
                  </div>

                  {selectedLaunch && selectedLaunch.month === m && (
                    <LaunchMap
                      launch={selectedLaunch}
                      station={station.id}
                      contextPoints={monthPoints}
                      records={records}
                      onPosition={onLaunchPosition}
                      onClose={() => setSelectedLaunch(null)}
                      onResult={found => {
                        setNoMatchLaunches(prev => {
                          const key = launchKey(selectedLaunch)
                          const has = prev.has(key)
                          if (found && has) {
                            const next = new Set(prev); next.delete(key); return next
                          }
                          if (!found && !has) {
                            const next = new Set(prev); next.add(key); return next
                          }
                          return prev
                        })
                      }}
                    />
                  )}
                </div>
              )}
              {isOpen && launches.length === 0 && (
                <div className="px-5 pb-4 bg-bg">
                  <p className="text-xs text-gray-400 py-2">Nenhum lançamento registrado neste mês.</p>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
