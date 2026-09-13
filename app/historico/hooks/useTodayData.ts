'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Station } from '@/app/lib/stations'
import type { TodayData } from '@/app/lib/types'
import { getSettings } from '@/app/lib/settings'

// A network error is an unknown state, never proof that there was no launch.
// The hook therefore preserves the last good value and exposes the error.
export function useTodayData(station: Station, pollMinutes?: number) {
  const [todayData, setTodayData] = useState<TodayData | null>(null)
  const [todayLoading, setTodayLoading] = useState(true)
  const [todayError, setTodayError] = useState<string | null>(null)
  const [lastFetchAt, setLastFetchAt] = useState<Date | null>(null)
  const requestRef = useRef(0)

  const fetchToday = useCallback(async () => {
    const request = ++requestRef.current
    setTodayLoading(true)
    try {
      const res = await fetch(`/api/sounding?action=today&station=${station.id}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || `Erro ${res.status}`)
      if (request !== requestRef.current) return
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
  }, [station.id])

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
