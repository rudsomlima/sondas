'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Station, setSelectedStations, stationShortName } from '@/app/lib/stations'
import { useSelectedStations } from '@/app/lib/useSelectedStations'
import { useGeolocation } from '@/app/lib/chase'
import type { Launch } from '@/app/lib/types'
import type { TodayFlight } from '@/app/lib/radiosondy'
import type { Reappearance } from '@/app/lib/reappearance'
import type { LiveSourceHealth } from '../historico/hooks/useLiveFlights'
import { useSondeRegistry } from '../historico/hooks/useSondeRegistry'
import { mergeSondePoints, todayFlightReappearance, type SondePoint } from '@/app/lib/sondePoints'
import { launchSortMs } from '@/app/lib/sondeLaunches'
import { useReceiver } from './hooks/useReceiver'
import { useReceiverAlerts } from './hooks/useReceiverAlerts'
import { getSettings } from '@/app/lib/settings'
import StationMultiPicker from '@/app/components/StationMultiPicker'
import TopStatusBar from './components/TopStatusBar'
import LivePanel from './components/LivePanel'
import ReceiverPanel from './components/ReceiverPanel'
import MissionMap from './components/MissionMap'
import TelemetryPanel from './components/TelemetryPanel'
import ConfidencePanel from './components/ConfidencePanel'
import ChasePanel from './components/ChasePanel'
import DataCoveragePanel from './components/DataCoveragePanel'
import StationFeed, { type StationFeedState } from './components/StationFeed'
import type { SelectedTarget } from './selection'

const NO_SERIALS: string[] = []
const NO_YEARS: number[] = []

// Saúde das fontes ao vivo somada entre estações: basta uma responder pra a
// fonte estar "ok"; o snapshot do servidor só é "ok" se valeu pra todas.
function combineHealth(list: LiveSourceHealth[]): LiveSourceHealth {
  if (list.length === 0) return { cache: 'miss', radiosondy: 'not-configured', sondehub: 'unavailable' }
  if (list.length === 1) return list[0]
  return {
    cache: list.find(h => h.cache !== 'ok')?.cache ?? 'ok',
    radiosondy: list.some(h => h.radiosondy === 'ok') ? 'ok'
      : list.some(h => h.radiosondy === 'unavailable') ? 'unavailable' : 'not-configured',
    sondehub: list.some(h => h.sondehub === 'ok') ? 'ok' : 'unavailable',
  }
}

export default function PainelPage() {
  // Estações escolhidas em Configurações: o painel acompanha TODAS ao mesmo
  // tempo — um <StationFeed> por estação faz as consultas e aqui só se soma.
  const { stations, ready } = useSelectedStations()
  const primary = stations[0]
  const multi = stations.length > 1
  const [feeds, setFeeds] = useState<Record<string, StationFeedState>>({})
  const [refreshSignal, setRefreshSignal] = useState(0)
  const [showStationPicker, setShowStationPicker] = useState(false)
  const [selected, setSelected] = useState<SelectedTarget | null>(null)
  const [callsign, setCallsign] = useState('')
  const [receiverPos, setReceiverPos] = useState<{ lat: number; lon: number } | null>(null)

  useEffect(() => {
    const settings = getSettings()
    setCallsign(settings.uploaderCallsign)
    if (settings.homeLat != null && settings.homeLon != null) {
      setReceiverPos({ lat: settings.homeLat, lon: settings.homeLon })
    }
  }, [])

  const onFeedUpdate = useCallback((state: StationFeedState) => {
    setFeeds(prev => prev[state.station.id] === state ? prev : { ...prev, [state.station.id]: state })
  }, [])
  const onFeedRemove = useCallback((stationId: string) => {
    setFeeds(prev => {
      if (!(stationId in prev)) return prev
      const next = { ...prev }
      delete next[stationId]
      return next
    })
  }, [])
  // Na ordem das estações escolhidas (a principal primeiro).
  const activeFeeds = useMemo(
    () => stations.map(s => feeds[s.id]).filter((f): f is StationFeedState => !!f),
    [stations, feeds],
  )

  const receiver = useReceiver()
  const geo = useGeolocation()
  const mySerials = useMemo(() => new Set(receiver.mySondes.map(m => m.serial)), [receiver.mySondes])
  // Registro de sondas (cache local, todas as estações) — só leitura aqui;
  // quem busca/enriquece é cada StationFeed.
  const records = useSondeRegistry(null, NO_YEARS, NO_SERIALS, false)

  // Soma das estações. Uma sonda perto de duas estações aparece nas duas
  // consultas: fica uma vez só (o reporte mais recente), atribuída à 1ª
  // estação (na ordem escolhida) que a viu.
  const merged = useMemo(() => {
    const flights = new Map<string, TodayFlight>()
    const flightStation = new Map<string, Station>()
    const reappeared = new Map<string, SondePoint>()
    const reappearedBySerial = new Map<string, Reappearance>()
    const launchStation = new Map<Launch, Station>()
    const serialStation = new Map<string, Station>()
    const launches: Launch[] = []
    for (const feed of activeFeeds) {
      for (const f of feed.flights) {
        const prev = flights.get(f.sondeNumber)
        if (!prev || f.lastReportUtc > prev.lastReportUtc) flights.set(f.sondeNumber, f)
        if (!flightStation.has(f.sondeNumber)) flightStation.set(f.sondeNumber, feed.station)
      }
      for (const p of feed.reappeared) if (!reappeared.has(p.serial)) reappeared.set(p.serial, p)
      for (const [k, v] of feed.reappearedBySerial) if (!reappearedBySerial.has(k)) reappearedBySerial.set(k, v)
      for (const l of feed.sondeLaunches) {
        const serial = l.position?.sondeNumber
        if (serial) {
          if (serialStation.has(serial)) continue
          serialStation.set(serial, feed.station)
        }
        launchStation.set(l, feed.station)
        launches.push(l)
      }
    }
    const errors = (pick: (f: StationFeedState) => string | null) => {
      const list = activeFeeds.filter(f => pick(f))
      if (list.length === 0) return null
      return multi ? list.map(f => `${stationShortName(f.station)}: ${pick(f)}`).join(' · ') : pick(list[0])
    }
    const fetchTimes = activeFeeds.map(f => f.lastFetchAt?.getTime() ?? 0).filter(t => t > 0)
    return {
      flights: [...flights.values()],
      flightStation, serialStation, launchStation, launches,
      reappeared: [...reappeared.values()],
      reappearedBySerial,
      yearPoints: activeFeeds.length === 1 ? activeFeeds[0].yearPoints : mergeSondePoints(...activeFeeds.map(f => f.yearPoints)),
      positionedMonth: activeFeeds.flatMap(f => f.positionedMonth),
      liveFlightChecked: activeFeeds.length > 0 && activeFeeds.length === stations.length && activeFeeds.every(f => f.liveFlightChecked),
      todayError: errors(f => f.todayError),
      liveError: errors(f => f.liveError),
      monthError: errors(f => f.monthError),
      monthLoading: activeFeeds.some(f => f.monthLoading),
      sourceHealth: combineHealth(activeFeeds.map(f => f.sourceHealth)),
      lastFetchAt: fetchTimes.length ? new Date(Math.max(...fetchTimes)) : null,
    }
  }, [activeFeeds, stations.length, multi])

  // Seriais que estão reaparecendo agora — inclusive no MEU receptor, que é
  // justamente onde uma sonda recuperada e religada em casa aparece.
  const reappearedSerials = useMemo(() => {
    const set = new Set(merged.reappearedBySerial.keys())
    for (const m of receiver.mySondes) {
      if (todayFlightReappearance({ ...m, sondeNumber: m.serial, altitude: m.alt }, records)) set.add(m.serial)
    }
    return set
  }, [merged.reappearedBySerial, receiver.mySondes, records])
  useReceiverAlerts(receiver.mySondes, receiver.checked, setSelected, reappearedSerials)

  // Keep a selected live target moving as fresh telemetry arrives.
  useEffect(() => {
    if (!selected || selected.launch) return
    const fresh = merged.flights.find(f => f.sondeNumber === selected.serial)
    if (!fresh) return
    if (fresh.lat === selected.lat && fresh.lon === selected.lon && fresh.lastReportUtc === selected.lastReportUtc) return
    setSelected(prev => prev ? {
      ...prev, lat: fresh.lat, lon: fresh.lon, altitude: fresh.altitude,
      climbing: fresh.climbing, isLive: fresh.isLive, lastReportUtc: fresh.lastReportUtc, source: fresh.source,
    } : prev)
  }, [merged.flights, selected])

  // Estação do alvo selecionado (trajetória do arquivo, confiança da Wyoming).
  const selectedStation = (selected && (
    (selected.launch && merged.launchStation.get(selected.launch)) ||
    merged.flightStation.get(selected.serial) || merged.serialStation.get(selected.serial)
  )) || primary

  // Mudou a lista de estações: a seleção pode ser de uma estação que saiu.
  const stationsKey = stations.map(s => s.id).join(',')
  useEffect(() => { setSelected(null) }, [stationsKey])

  const changeStations = useCallback((list: Station[]) => {
    setSelectedStations(list)
  }, [])

  const recentLaunches = useMemo(() => [...merged.launches]
    .sort((a, b) => launchSortMs(b) - launchSortMs(a))
    .slice(0, 8), [merged.launches])

  // Rótulo de estação em cada item das listas — só com mais de uma estação.
  const stationLabels = useMemo(() => {
    if (!multi) return { flights: undefined, launches: undefined }
    const flights = new Map<string, string>()
    for (const [serial, st] of merged.flightStation) flights.set(serial, stationShortName(st))
    const launches = new Map<Launch, string>()
    for (const [l, st] of merged.launchStation) launches.set(l, stationShortName(st))
    return { flights, launches }
  }, [multi, merged.flightStation, merged.launchStation])

  const refreshAll = useCallback(() => setRefreshSignal(n => n + 1), [])

  return (
    <div className="p-4 lg:h-[calc(100vh-0px)] flex flex-col">
      {/* Um alimentador invisível por estação — só depois de ler a lista
          real, pra não consultar a estação padrão à toa. */}
      {ready && stations.map(s => (
        <StationFeed key={s.id} station={s} refreshSignal={refreshSignal} onUpdate={onFeedUpdate} onRemove={onFeedRemove} />
      ))}

      <TopStatusBar
        entries={stations.map(s => {
          const f = feeds[s.id]
          return {
            station: s, todayData: f?.todayData ?? null, todayLoading: f?.todayLoading ?? true,
            todayError: f?.todayError ?? null, todayFlights: f?.flights ?? [],
          }
        })}
        liveError={merged.liveError}
        lastFetchAt={merged.lastFetchAt} onRefresh={refreshAll}
        onToggleStationPicker={() => setShowStationPicker(v => !v)}
      />

      {showStationPicker && <div className="mb-4 -mt-2"><StationMultiPicker selected={stations} onChange={changeStations} autoFocus /></div>}

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 min-h-0">
        <div className="lg:col-span-3 lg:overflow-y-auto min-h-0 order-2 lg:order-1 space-y-4">
          <ReceiverPanel
            status={receiver.status} mySondes={receiver.mySondes} checked={receiver.checked}
            enabled={receiver.enabled} callsign={callsign} source={receiver.source}
            liveConfigured={receiver.liveConfigured} liveConnected={receiver.liveConnected}
            ttgoBattV={receiver.ttgoBattV} sleeping={receiver.sleeping} waitingLate={receiver.waitingLate}
            liveLastMessageAt={receiver.liveLastMessageAt} power={receiver.power} boot={receiver.boot}
            selected={selected} onSelect={setSelected} reappearedSerials={reappearedSerials}
          />
          <LivePanel
            todayFlights={merged.flights} liveFlightChecked={merged.liveFlightChecked}
            reappearedToday={merged.reappeared}
            recentLaunches={recentLaunches} selected={selected} onSelect={setSelected} mySerials={mySerials}
            flightStationName={stationLabels.flights} launchStationName={stationLabels.launches}
          />
        </div>

        <div className="lg:col-span-6 h-[280px] sm:h-[340px] lg:h-auto order-1 lg:order-2">
          {/* Mesmo conjunto do mapa do histórico anual (useYearSondePoints +
              registro do R2) de cada estação, com filtro Mês/Ano no próprio mapa. */}
          <MissionMap
            stations={stations} selectedStation={selectedStation}
            points={merged.yearPoints} records={records} todayFlights={merged.flights}
            reappearedToday={merged.reappeared}
            selected={selected} chasePos={geo.pos ? { lat: geo.pos.lat, lon: geo.pos.lon } : null}
            receiverPos={receiverPos} receiverName={callsign}
          />
        </div>

        <div className="lg:col-span-3 lg:overflow-y-auto min-h-0 space-y-4 order-3">
          <DataCoveragePanel launches={merged.positionedMonth} monthLoading={merged.monthLoading} monthError={merged.monthError}
            todayError={merged.todayError} liveError={merged.liveError} sourceHealth={merged.sourceHealth} onRefresh={refreshAll}
            stationCount={stations.length} />
          <TelemetryPanel selected={selected} />
          <ConfidencePanel selected={selected} station={selectedStation} />
          <ChasePanel selected={selected} geo={geo} />
        </div>
      </div>
    </div>
  )
}
