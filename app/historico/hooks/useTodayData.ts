'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Station } from '@/app/lib/stations'
import type { TodayData } from '@/app/lib/types'
import { getSettings } from '@/app/lib/settings'

// Consulta "houve lançamento hoje?" (Wyoming + complementares, via API própria).
// Intervalo de polling vem das preferências do usuário (sondas_settings);
// default 5 min — muda raramente (1-2x/dia). 0 = sem polling automático.
export function useTodayData(station: Station, pollMinutes?: number) {
  const [todayData, setTodayData] = useState<TodayData | null>(null)
  const [todayLoading, setTodayLoading] = useState(true)
  const [lastFetchAt, setLastFetchAt] = useState<Date | null>(null)

  const fetchToday = useCallback(async () => {
    setTodayLoading(true)
    try {
      const res = await fetch(`/api/sounding?action=today&station=${station.id}`)
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      setTodayData(json)
    } catch {
      // Falha ao consultar a origem: trata como "sem lançamento hoje" em vez
      // de mostrar um erro alarmante.
      const d = new Date()
      const pad = (n: number) => String(n).padStart(2, '0')
      setTodayData({
        today: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
        station: station.id,
        launched_today: false,
        count: 0,
        launches: [],
      })
    } finally {
      setTodayLoading(false)
      setLastFetchAt(new Date())
    }
  }, [station.id])

  useEffect(() => {
    fetchToday()
    const minutes = pollMinutes ?? getSettings().autoRefreshMinutes
    if (minutes <= 0) return
    const interval = setInterval(fetchToday, minutes * 60 * 1000)
    return () => clearInterval(interval)
  }, [fetchToday, pollMinutes])

  return { todayData, todayLoading, lastFetchAt, refresh: fetchToday }
}
