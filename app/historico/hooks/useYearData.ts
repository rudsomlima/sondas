'use client'

import { useCallback, useEffect, useState } from 'react'
import { getCacheByYear, writeCache, clearMonth } from '@/app/lib/cache'
import type { Station } from '@/app/lib/stations'
import type { Launch, YearData } from '@/app/lib/types'

const MONTHS_FULL = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

// Estado do histórico anual: pinta do localStorage imediatamente, sincroniza
// meses pendentes com a API (retry rápido 8s/16s), e re-tenta o mês corrente
// e meses falhos num laço de 5 min.
export function useYearData(year: number, station: Station, onCacheChange?: () => void) {
  const currentYear = new Date().getFullYear()
  const [data, setData] = useState<YearData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [failedMonths, setFailedMonths] = useState<Set<number>>(new Set())

  const syncMonths = useCallback(async (y: number, months: number[]): Promise<number[]> => {
    if (months.length === 0) return []
    setSyncing(true)
    const failed: number[] = []
    for (const m of months) {
      setStatusMsg(`Buscando ${MONTHS_FULL[m - 1]}/${y}…`)
      try {
        const res = await fetch(`/api/sounding?action=month&year=${y}&month=${m}&station=${station.id}`)
        if (!res.ok) throw new Error(`Erro ${res.status}`)
        const json = await res.json()
        if (json.error) throw new Error(json.error)

        writeCache({ year: y, month: m, launches: json.launches, timestamp: Date.now(), version: 1, station: station.id })

        setData(prev => {
          if (!prev || prev.year !== y) return prev
          const merged = prev.launches.filter(l => l.month !== m).concat(json.launches)
          return { ...prev, launches: merged, count: merged.length }
        })
        setFailedMonths(prev => {
          if (!prev.has(m)) return prev
          const next = new Set(prev)
          next.delete(m)
          return next
        })
      } catch (e: any) {
        // Falhas do mês corrente tendem a ser bloqueios temporários — não
        // exibe o banner de erro; só meses passados acusam erro visível.
        const isCurrentMonth = y === currentYear && m === new Date().getMonth() + 1
        if (!isCurrentMonth) setError(e.message || 'Erro ao carregar dados')
        setFailedMonths(prev => new Set(prev).add(m))
        failed.push(m)
      }
    }
    setStatusMsg(null)
    setSyncing(false)
    onCacheChange?.()
    return failed
  }, [currentYear, station.id, onCacheChange])

  const fetchData = useCallback(async (y: number) => {
    setError(null)
    setFailedMonths(new Set())

    const maxMonth = y === currentYear ? new Date().getMonth() + 1 : (y > currentYear ? 0 : 12)

    // Pinta imediatamente o que já existe em cache local; descarta meses futuros.
    const cachedMonthsAll = getCacheByYear(y, station.id)
    const cachedMonths = cachedMonthsAll.filter(c => c.month <= maxMonth)
    for (const stale of cachedMonthsAll) {
      if (stale.month > maxMonth) clearMonth(y, stale.month, station.id)
    }
    const launchesFromCache = cachedMonths.flatMap(c => c.launches)
    setData({ year: y, station: station.id, count: launchesFromCache.length, launches: launchesFromCache, errors: [] })

    const cachedSet = new Set(cachedMonths.map(c => c.month))
    let pending: number[] = []
    for (let m = 1; m <= maxMonth; m++) {
      const isCurrentMonth = y === currentYear && m === maxMonth
      if (cachedSet.has(m) && !isCurrentMonth) continue
      pending.push(m)
    }

    // Retry rápido (8s, 16s) antes de cair no laço periódico de 5 minutos.
    for (let attempt = 0; pending.length > 0 && attempt < 3; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, attempt * 8000))
      pending = await syncMonths(y, pending)
    }
  }, [currentYear, syncMonths, station.id])

  useEffect(() => {
    fetchData(year)
  }, [year, fetchData])

  // Laço periódico: mês corrente + meses falhos.
  useEffect(() => {
    const interval = setInterval(() => {
      const months = new Set(failedMonths)
      if (year === currentYear) months.add(new Date().getMonth() + 1)
      if (months.size > 0) syncMonths(year, [...months])
    }, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [year, currentYear, failedMonths, syncMonths])

  return { data, setData, error, statusMsg, syncing, failedMonths, fetchData, syncMonths }
}
