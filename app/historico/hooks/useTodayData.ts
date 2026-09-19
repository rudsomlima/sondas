'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Station } from '@/app/lib/stations'
import type { TodayData } from '@/app/lib/types'
import { getSettings } from '@/app/lib/settings'
import { isWyomingEnabled, useWyomingEnabled, wyomingQuery } from '@/app/lib/appSettings'
import { withoutWyoming } from '@/app/lib/launchData'

// A network error is an unknown state, never proof that there was no launch.
// The hook therefore preserves the last good value and exposes the error.
export function useTodayData(station: Station, pollMinutes?: number) {
  // Liga/desliga da Wyoming (Configurações): refaz a consulta na hora.
  const wyomingOn = useWyomingEnabled()
  const [todayData, setTodayData] = useState<TodayData | null>(null)
  const [todayLoading, setTodayLoading] = useState(true)
  const [todayError, setTodayError] = useState<string | null>(null)
  const [lastFetchAt, setLastFetchAt] = useState<Date | null>(null)
  const requestRef = useRef(0)

  const fetchToday = useCallback(async () => {
    const request = ++requestRef.current
    setTodayLoading(true)
    try {
      const res = await fetch(`/api/sounding?action=today&station=${station.id}${wyomingQuery()}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || `Erro ${res.status}`)
      if (request !== requestRef.current) return
      if (!isWyomingEnabled()) {
        // Defesa: nada da Wyoming passa, mesmo de uma resposta antiga em cache.
        json.launches = withoutWyoming(json.launches ?? [])
        json.all_this_month = withoutWyoming(json.all_this_month ?? [])
        json.candidates = withoutWyoming(json.candidates ?? [])
        json.count = json.launches.length
        json.launched_today = json.launches.length > 0
      }
      setTodayData(json)
      setTodayError(json.partial ? 'Consulta parcial: ao menos uma fonte está temporariamente indisponível.' : null)
    } catch (error: any) {
      if (request !== requestRef.current) return
      setTodayData(prev => prev?.station === station.id ? prev : null)
      setTodayError(error?.message || 'Não foi possível consultar os lançamentos de hoje.')
    } finally {
      if (request === requestRef.current) {
        setTodayLoading(false)
        setLastFetchAt(new Date())
      }
    }
  }, [station.id, wyomingOn])

  useEffect(() => {
    setTodayData(null)
    setTodayError(null)
    setTodayLoading(true)
    fetchToday()
    const minutes = pollMinutes ?? getSettings().autoRefreshMinutes
    if (minutes <= 0) return
    const interval = setInterval(fetchToday, minutes * 60 * 1000)
    return () => clearInterval(interval)
  }, [fetchToday, pollMinutes])

  return { todayData, todayLoading, todayError, lastFetchAt, refresh: fetchToday }
}
