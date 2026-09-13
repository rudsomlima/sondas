'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchTodayFlights, TodayFlight } from '@/app/lib/radiosondy'
import { fetchSondeHubFlights } from '@/app/lib/sondehub'
import { getRadiosondyStartplace, Station } from '@/app/lib/stations'

const CACHE_MAX_AGE_MS = 10 * 60 * 1000

export interface LiveSourceHealth {
  cache: 'ok' | 'miss' | 'stale' | 'error'
  radiosondy: 'ok' | 'unavailable' | 'not-configured'
  sondehub: 'ok' | 'unavailable'
}

async function fetchFromCache(stationId: string): Promise<{ flights: TodayFlight[] | null; state: LiveSourceHealth['cache'] }> {
  try {
    const res = await fetch(`/api/live-flights?station=${encodeURIComponent(stationId)}`, { cache: 'no-store' })
    if (!res.ok) return { flights: null, state: 'error' }
    const snapshot = await res.json()
    if (!snapshot || !Array.isArray(snapshot.flights)) return { flights: null, state: 'miss' }
    if (Date.now() - snapshot.updatedAt > CACHE_MAX_AGE_MS) return { flights: null, state: 'stale' }
    return { flights: snapshot.flights, state: 'ok' }
  } catch {
    return { flights: null, state: 'error' }
  }
}

// Server snapshot first; direct radiosondy + SondeHub site/geo APIs are the
// redundant fallback. Previous good telemetry survives a total provider outage.
export function useLiveFlights(station: Station, todayStr: string | undefined, pollSeconds = 20) {
  const [todayFlights, setTodayFlights] = useState<TodayFlight[]>([])
  const [liveFlightChecked, setLiveFlightChecked] = useState(false)
  const [liveError, setLiveError] = useState<string | null>(null)
  const [liveLastFetchAt, setLiveLastFetchAt] = useState<Date | null>(null)
  const [sourceHealth, setSourceHealth] = useState<LiveSourceHealth>({
    cache: 'miss', radiosondy: 'not-configured', sondehub: 'unavailable',
  })
  const requestRef = useRef(0)

  const fetchLiveFlight = useCallback(async () => {
    const request = ++requestRef.current
    const startplace = getRadiosondyStartplace(station.id)
    const cached = await fetchFromCache(station.id)
    if (request !== requestRef.current) return
    if (cached.flights && cached.flights.length > 0) {
      setTodayFlights(cached.flights)
      setLiveFlightChecked(true)
      setLiveError(null)
      setLiveLastFetchAt(new Date())
      const hasStrongAssociation = cached.flights.some(f => f.source === 'radiosondy' || f.source === 'sondehub-site')
      setSourceHealth({
        cache: 'ok',
        radiosondy: cached.flights.some(f => f.source.startsWith('radiosondy')) ? 'ok' : (startplace ? 'unavailable' : 'not-configured'),
        sondehub: cached.flights.some(f => f.source.startsWith('sondehub')) ? 'ok' : 'unavailable',
      })
      if (hasStrongAssociation) return
    }

    const d = new Date(Date.now() - 3 * 60 * 60 * 1000)
    const pad = (n: number) => String(n).padStart(2, '0')
    const today = todayStr ?? `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
    const [radiosondyResult, sondeHubResult] = await Promise.allSettled([
      startplace ? fetchTodayFlights(today, startplace) : Promise.resolve([]),
      fetchSondeHubFlights(station.id, station.lat, station.lon, today),
    ])
    if (request !== requestRef.current) return

    const bySondeNumber = new Map<string, TodayFlight>()
    for (const result of [radiosondyResult, sondeHubResult]) {
      if (result.status !== 'fulfilled') continue
      for (const f of result.value) {
        const existing = bySondeNumber.get(f.sondeNumber)
        if (!existing || f.lastReportUtc > existing.lastReportUtc) bySondeNumber.set(f.sondeNumber, f)
      }
    }

    if (radiosondyResult.status === 'fulfilled' || sondeHubResult.status === 'fulfilled') {
      setTodayFlights([...bySondeNumber.values()])
      setLiveError(null)
    } else {
      setLiveError('As fontes de telemetria ao vivo estão indisponíveis; mantendo o último dado conhecido.')
    }
    setSourceHealth({
      cache: cached.state,
      radiosondy: !startplace ? 'not-configured' : radiosondyResult.status === 'fulfilled' ? 'ok' : 'unavailable',
      sondehub: sondeHubResult.status === 'fulfilled' ? 'ok' : 'unavailable',
    })
    setLiveFlightChecked(true)
    setLiveLastFetchAt(new Date())
  }, [todayStr, station.id, station.lat, station.lon])

  useEffect(() => {
    setTodayFlights([])
    setLiveFlightChecked(false)
    setLiveError(null)
    fetchLiveFlight()
    let interval: ReturnType<typeof setInterval> | null = setInterval(fetchLiveFlight, pollSeconds * 1000)
    const onVisibility = () => {
      if (document.hidden) {
        if (interval) { clearInterval(interval); interval = null }
      } else if (!interval) {
        fetchLiveFlight()
        interval = setInterval(fetchLiveFlight, pollSeconds * 1000)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      requestRef.current++
      if (interval) clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [fetchLiveFlight, pollSeconds])

  return { todayFlights, liveFlightChecked, liveError, liveLastFetchAt, sourceHealth, refresh: fetchLiveFlight }
}
