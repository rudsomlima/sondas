'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Station, DEFAULT_STATION, getSelectedStation, setSelectedStation } from '@/app/lib/stations'
import { getCacheByYear, writeCache } from '@/app/lib/cache'
import { useGeolocation } from '@/app/lib/chase'
import type { Launch } from '@/app/lib/types'
import { useTodayData } from '../historico/hooks/useTodayData'
import { useLiveFlights } from '../historico/hooks/useLiveFlights'
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
import type { SelectedTarget } from './selection'

export default function PainelPage() {
  const [station, setStation] = useState<Station>(DEFAULT_STATION)
  const [showStationPicker, setShowStationPicker] = useState(false)
  const [selected, setSelected] = useState<SelectedTarget | null>(null)
  const [monthLaunches, setMonthLaunches] = useState<Launch[]>([])

  useEffect(() => {
    setStation(getSelectedStation())
  }, [])

  const [callsign, setCallsign] = useState('')
  useEffect(() => { setCallsign(getSettings().uploaderCallsign) }, [])

  const { todayData, todayLoading, lastFetchAt } = useTodayData(station)
  const { todayFlights, liveFlightChecked } = useLiveFlights(station, todayData?.today)
  const receiver = useReceiver()
  useReceiverAlerts(receiver.mySondes, receiver.checked, setSelected)
  const geo = useGeolocation()

  // Serials sendo recebidos pelo receptor local — badge "RX local" no LivePanel.
  const mySerials = useMemo(
    () => new Set(receiver.mySondes.map(m => m.serial)),
    [receiver.mySondes]
  )

  // Lançamentos do mês corrente: pinta do localStorage e sincroniza com a API.
  useEffect(() => {
    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth() + 1

    const cached = getCacheByYear(year, station.id).find(c => c.month === month)
    if (cached) setMonthLaunches(cached.launches)
    else setMonthLaunches([])

    let cancelled = false
    async function sync() {
      try {
        const res = await fetch(`/api/sounding?action=month&year=${year}&month=${month}&station=${station.id}`)
        if (!res.ok) return
        const json = await res.json()
        if (cancelled || json.error) return
        writeCache({ year, month, launches: json.launches, timestamp: Date.now(), version: 1, station: station.id })
        setMonthLaunches(json.launches)
      } catch {
        // cache local já pintou o que havia
      }
    }
    sync()
    return () => { cancelled = true }
  }, [station.id])

  const changeStation = useCallback((s: Station) => {
    setStation(s)
    setSelectedStation(s)
    setSelected(null)
    setShowStationPicker(false)
  }, [])

  // Últimos 5 lançamentos com posição conhecida (mais recentes primeiro).
  const recentLaunches = useMemo(() =>
    [...monthLaunches]
      .filter(l => l.position)
      .sort((a, b) => (b.date + b.time_local).localeCompare(a.date + a.time_local))
      .slice(0, 5),
    [monthLaunches]
  )

  return (
    <div className="p-4 lg:h-[calc(100vh-0px)] flex flex-col">
      <TopStatusBar
        station={station}
        todayData={todayData}
        todayLoading={todayLoading}
        todayFlights={todayFlights}
        lastFetchAt={lastFetchAt}
        onToggleStationPicker={() => setShowStationPicker(v => !v)}
      />

      {showStationPicker && (
        <div className="mb-4 -mt-2">
          <StationPicker station={station} onSelect={changeStation} />
        </div>
      )}

      {/* Grid mission control: 3-6-3 no desktop; coluna única no mobile */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 min-h-0">
        <div className="lg:col-span-3 lg:overflow-y-auto min-h-0 order-2 lg:order-1 space-y-4">
          <ReceiverPanel
            status={receiver.status}
            mySondes={receiver.mySondes}
            checked={receiver.checked}
            enabled={receiver.enabled}
            callsign={callsign}
            source={receiver.source}
            mqttConfigured={receiver.mqttConfigured}
            mqttConnected={receiver.mqttConnected}
            uptimeMs={receiver.uptimeMs}
            ttgoBattV={receiver.ttgoBattV}
            sleeping={receiver.sleeping}
            waitingLate={receiver.waitingLate}
            receiverIp={receiver.receiverIp}
            mqttLastMessageAt={receiver.mqttLastMessageAt}
            mqttPublishedAt={receiver.mqttPublishedAt}
            selected={selected}
            onSelect={setSelected}
          />
          <LivePanel
            todayFlights={todayFlights}
            liveFlightChecked={liveFlightChecked}
            recentLaunches={recentLaunches}
            selected={selected}
            onSelect={setSelected}
            mySerials={mySerials}
          />
        </div>

        <div className="lg:col-span-6 h-[280px] sm:h-[340px] lg:h-auto order-1 lg:order-2">
          <MissionMap
            station={station}
            monthLaunches={monthLaunches}
            todayFlights={todayFlights}
            selected={selected}
            chasePos={geo.pos ? { lat: geo.pos.lat, lon: geo.pos.lon } : null}
            receiverPos={receiver.rxPosition}
          />
        </div>

        <div className="lg:col-span-3 lg:overflow-y-auto min-h-0 space-y-4 order-3">
          <TelemetryPanel selected={selected} />
          <ConfidencePanel selected={selected} station={station} />
          <ChasePanel selected={selected} geo={geo} />
        </div>
      </div>
    </div>
  )
}
