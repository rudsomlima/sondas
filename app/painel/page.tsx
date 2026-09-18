'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Station, DEFAULT_STATION, getSelectedStation, setSelectedStation } from '@/app/lib/stations'
import { getCacheByYear, writeCache } from '@/app/lib/cache'
import { useGeolocation } from '@/app/lib/chase'
import { mergeLaunchCollections, sameMission } from '@/app/lib/launchData'
import { nowGMT3 } from '@/app/lib/types'
import type { Launch } from '@/app/lib/types'
import { useTodayData } from '../historico/hooks/useTodayData'
import { useLiveFlights } from '../historico/hooks/useLiveFlights'
import { useSondePoints } from '../historico/hooks/useSondePoints'
import { useRecoveredLaunches } from '../historico/hooks/useRecoveredLaunches'
import { useSondeLaunches } from '../historico/hooks/useSondeLaunches'
import { attachPositions } from '@/app/lib/sondePoints'
import { launchSortMs } from '@/app/lib/sondeLaunches'
import { useReceiver } from './hooks/useReceiver'
import { useReceiverAlerts } from './hooks/useReceiverAlerts'
import { getSettings } from '@/app/lib/settings'
import StationPicker from '../historico/components/StationPicker'
import TopStatusBar from './components/TopStatusBar'
import LivePanel from './components/LivePanel'
import ReceiverPanel from './components/ReceiverPanel'
import MissionMap from './components/MissionMap'
import TelemetryPanel from './components/TelemetryPanel'
import ConfidencePanel from './components/ConfidencePanel'
import ChasePanel from './components/ChasePanel'
import DataCoveragePanel from './components/DataCoveragePanel'
import type { SelectedTarget } from './selection'

export default function PainelPage() {
  const [station, setStation] = useState<Station>(DEFAULT_STATION)
  const [showStationPicker, setShowStationPicker] = useState(false)
  const [selected, setSelected] = useState<SelectedTarget | null>(null)
  const [monthLaunches, setMonthLaunches] = useState<Launch[]>([])
  const [monthLoading, setMonthLoading] = useState(false)
  const [monthError, setMonthError] = useState<string | null>(null)
  const [callsign, setCallsign] = useState('')
  const [receiverPos, setReceiverPos] = useState<{ lat: number; lon: number } | null>(null)
  const monthRequestRef = useRef(0)

  useEffect(() => {
    setStation(getSelectedStation())
    const settings = getSettings()
    setCallsign(settings.uploaderCallsign)
    if (settings.homeLat != null && settings.homeLon != null) {
      setReceiverPos({ lat: settings.homeLat, lon: settings.homeLon })
    }
  }, [])

  const { todayData, todayLoading, todayError, lastFetchAt, refresh: refreshToday } = useTodayData(station)
  const { todayFlights, liveFlightChecked, liveError, sourceHealth, refresh: refreshLive } = useLiveFlights(station, todayData?.today)
  const receiver = useReceiver()
  useReceiverAlerts(receiver.mySondes, receiver.checked, setSelected)
  const geo = useGeolocation()

  const mySerials = useMemo(() => new Set(receiver.mySondes.map(m => m.serial)), [receiver.mySondes])

  const clock = nowGMT3()
  const { points: monthPoints, refresh: refreshPoints } = useSondePoints(station, clock.getUTCFullYear(), clock.getUTCMonth() + 1)
  // Lançamentos sem posição ganham o pouso casado por horário (qualquer fonte),
  // e o mapa ainda recebe as sondas que não casaram com nenhum lançamento.
  const attachedMonth = useMemo(() => attachPositions(monthLaunches, monthPoints).launches, [monthLaunches, monthPoints])
  // Posições UNKNOWN (telemetria RF) ganham FOUND/LOST se alguém registrou a
  // recuperação no SondeHub — em segundo plano, sem atrasar o mapa.
  const positionedMonth = useRecoveredLaunches(attachedMonth)
  // Uma entrada por sonda (inclusive as que não casaram com nenhum slot da
  // Wyoming) e horário do primeiro quadro recebido — ver sondeLaunches.ts.
  const sondeLaunches = useSondeLaunches(positionedMonth, monthPoints)

  const loadMonth = useCallback(async () => {
    const request = ++monthRequestRef.current
    const now = nowGMT3()
    const year = now.getUTCFullYear()
    const month = now.getUTCMonth() + 1
    const cached = getCacheByYear(year, station.id).find(c => c.month === month)
    const cachedLaunches = mergeLaunchCollections((cached?.launches ?? []) as Launch[])
    setMonthLaunches(cachedLaunches)
    setMonthLoading(true)
    setMonthError(null)
    try {
      const res = await fetch(`/api/sounding?action=month&year=${year}&month=${month}&station=${station.id}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || `Erro ${res.status}`)
      if (request !== monthRequestRef.current) return
      const server = Array.isArray(json.launches) ? json.launches as Launch[] : []
      const all = mergeLaunchCollections(cachedLaunches, server)
      const launches = server.length === 0 && cachedLaunches.length > 0
        ? cachedLaunches
        : all.filter(l => server.some(s => sameMission(l, s)))
      writeCache({ year, month, launches, timestamp: Date.now(), version: 1, station: station.id })
      setMonthLaunches(launches)
    } catch (e: any) {
      if (request !== monthRequestRef.current) return
      setMonthError(e?.message || 'Falha ao sincronizar o mês; exibindo cache local.')
    } finally {
      if (request === monthRequestRef.current) setMonthLoading(false)
    }
  }, [station.id])

  useEffect(() => {
    loadMonth()
    return () => { monthRequestRef.current++ }
  }, [loadMonth])

  useEffect(() => {
    if (!todayData?.all_this_month?.length) return
    setMonthLaunches(prev => mergeLaunchCollections(prev, todayData.all_this_month ?? []))
  }, [todayData])

  // Keep a selected live target moving as fresh telemetry arrives.
  useEffect(() => {
    if (!selected || selected.launch) return
    const fresh = todayFlights.find(f => f.sondeNumber === selected.serial)
    if (!fresh) return
    if (fresh.lat === selected.lat && fresh.lon === selected.lon && fresh.lastReportUtc === selected.lastReportUtc) return
    setSelected(prev => prev ? {
      ...prev, lat: fresh.lat, lon: fresh.lon, altitude: fresh.altitude,
      climbing: fresh.climbing, isLive: fresh.isLive, lastReportUtc: fresh.lastReportUtc, source: fresh.source,
    } : prev)
  }, [todayFlights, selected])

  const changeStation = useCallback((s: Station) => {
    setStation(s)
    setSelectedStation(s)
    setSelected(null)
    setMonthLaunches([])
    setShowStationPicker(false)
  }, [])

  const recentLaunches = useMemo(() => [...sondeLaunches]
    .sort((a, b) => launchSortMs(b) - launchSortMs(a))
    .slice(0, 8), [sondeLaunches])

  const refreshAll = useCallback(() => {
    refreshToday()
    refreshLive()
    loadMonth()
    refreshPoints()
  }, [refreshToday, refreshLive, loadMonth, refreshPoints])

  return (
    <div className="p-4 lg:h-[calc(100vh-0px)] flex flex-col">
      <TopStatusBar
        station={station} todayData={todayData} todayLoading={todayLoading}
        todayError={todayError} liveError={liveError} todayFlights={todayFlights}
        lastFetchAt={lastFetchAt} onRefresh={refreshAll}
        onToggleStationPicker={() => setShowStationPicker(v => !v)}
      />

      {showStationPicker && <div className="mb-4 -mt-2"><StationPicker station={station} onSelect={changeStation} /></div>}

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 min-h-0">
        <div className="lg:col-span-3 lg:overflow-y-auto min-h-0 order-2 lg:order-1 space-y-4">
          <ReceiverPanel
            status={receiver.status} mySondes={receiver.mySondes} checked={receiver.checked}
            enabled={receiver.enabled} callsign={callsign} source={receiver.source}
            liveConfigured={receiver.liveConfigured} liveConnected={receiver.liveConnected}
            ttgoBattV={receiver.ttgoBattV} sleeping={receiver.sleeping} waitingLate={receiver.waitingLate}
            liveLastMessageAt={receiver.liveLastMessageAt} power={receiver.power}
            selected={selected} onSelect={setSelected}
          />
          <LivePanel
            todayFlights={todayFlights} liveFlightChecked={liveFlightChecked}
            recentLaunches={recentLaunches} selected={selected} onSelect={setSelected} mySerials={mySerials}
          />
        </div>

        <div className="lg:col-span-6 h-[280px] sm:h-[340px] lg:h-auto order-1 lg:order-2">
          <MissionMap
            station={station} monthLaunches={positionedMonth} extraPoints={monthPoints} todayFlights={todayFlights}
            selected={selected} chasePos={geo.pos ? { lat: geo.pos.lat, lon: geo.pos.lon } : null}
            receiverPos={receiverPos} receiverName={callsign}
          />
        </div>

        <div className="lg:col-span-3 lg:overflow-y-auto min-h-0 space-y-4 order-3">
          <DataCoveragePanel launches={positionedMonth} monthLoading={monthLoading} monthError={monthError}
            todayError={todayError} liveError={liveError} sourceHealth={sourceHealth} onRefresh={refreshAll} />
          <TelemetryPanel selected={selected} />
          <ConfidencePanel selected={selected} station={station} />
          <ChasePanel selected={selected} geo={geo} />
        </div>
      </div>
    </div>
  )
}
