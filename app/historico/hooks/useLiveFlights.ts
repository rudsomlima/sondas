'use client'

import { useCallback, useEffect, useState } from 'react'
import { fetchTodayFlights, TodayFlight } from '@/app/lib/radiosondy'
import { fetchSondeHubFlights } from '@/app/lib/sondehub'
import { getRadiosondyStartplace, Station } from '@/app/lib/stations'

// Snapshot mais antigo que isso é tratado como "sem cache" — o cron externo
// roda a cada poucos minutos (ver app/api/poll), então algo bem mais velho
// que isso quer dizer que o cron parou, não que o dado ainda é bom.
const CACHE_MAX_AGE_MS = 10 * 60 * 1000

// Lê o snapshot pronto no servidor (ver app/lib/liveFlightsCache.ts,
// atualizado pelo cron /api/poll) — evita todo usuário que abre a página
// reprocessar o feed global do SondeHub/radiosondy.info sozinho. `null` se
// ainda não existir cache pra essa estação ou estiver velho demais.
async function fetchFromCache(stationId: string): Promise<TodayFlight[] | null> {
  try {
    const res = await fetch(`/api/live-flights?station=${encodeURIComponent(stationId)}`, { cache: 'no-store' })
    if (!res.ok) return null
    const snapshot = await res.json()
    if (!snapshot || !Array.isArray(snapshot.flights)) return null
    if (Date.now() - snapshot.updatedAt > CACHE_MAX_AGE_MS) return null
    return snapshot.flights
  } catch { return null }
}

// Voo dura só ~2h, então o polling do feed ao vivo é bem mais frequente (20s)
// que o de "houve lançamento hoje". Usa radiosondy.info (quando a estação tem
// startplace) e sondehub.org (por geografia, qualquer estação) em paralelo.
// Pausa o polling quando a aba está oculta (visibilitychange).
export function useLiveFlights(station: Station, todayStr: string | undefined, pollSeconds = 20) {
  const [todayFlights, setTodayFlights] = useState<TodayFlight[]>([])
  const [liveFlightChecked, setLiveFlightChecked] = useState(false)

  const fetchLiveFlight = useCallback(async () => {
    // Cache do servidor primeiro — instantâneo, sem reprocessar o feed
    // global. Só cai pro fetch direto (mesmo caminho de sempre) se ainda
    // não houver snapshot pronto pra essa estação.
    const cached = await fetchFromCache(station.id)
    if (cached) {
      setTodayFlights(cached)
      setLiveFlightChecked(true)
      return
    }

    const startplace = getRadiosondyStartplace(station.id)
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const today = todayStr ?? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

    const [radiosondyResult, sondeHubResult] = await Promise.allSettled([
      startplace ? fetchTodayFlights(today, startplace) : Promise.resolve([]),
      fetchSondeHubFlights(station.lat, station.lon, today),
    ])

    const bySondeNumber = new Map<string, TodayFlight>()
    for (const result of [radiosondyResult, sondeHubResult]) {
      if (result.status !== 'fulfilled') continue
      for (const f of result.value) {
        const existing = bySondeNumber.get(f.sondeNumber)
        if (!existing || f.lastReportUtc > existing.lastReportUtc) {
          bySondeNumber.set(f.sondeNumber, f)
        }
      }
    }

    // Só substitui o que já está na tela se pelo menos uma fonte respondeu.
    if (radiosondyResult.status === 'fulfilled' || sondeHubResult.status === 'fulfilled') {
      setTodayFlights([...bySondeNumber.values()])
    }
    setLiveFlightChecked(true)
  }, [todayStr, station.id, station.lat, station.lon])

  useEffect(() => {
    fetchLiveFlight()
    let interval: ReturnType<typeof setInterval> | null = setInterval(fetchLiveFlight, pollSeconds * 1000)

    // Pausa quando a aba fica oculta; retoma (com fetch imediato) ao voltar.
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
      if (interval) clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [fetchLiveFlight, pollSeconds])

  return { todayFlights, liveFlightChecked, refresh: fetchLiveFlight }
}
