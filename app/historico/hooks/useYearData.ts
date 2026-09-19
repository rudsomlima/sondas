'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getCacheByYear, writeCache, clearMonth } from '@/app/lib/cache'
import type { Station } from '@/app/lib/stations'
import { nowGMT3 } from '@/app/lib/types'
import type { Launch, YearData } from '@/app/lib/types'
import { mergeLaunchCollections, sameMission, withoutWyoming } from '@/app/lib/launchData'
import { cacheStationKey, isWyomingEnabled, useWyomingEnabled, wyomingQuery } from '@/app/lib/appSettings'

const MONTHS_FULL = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

// Cache-first annual state with provider retries and race protection when the
// user changes station/year. Rich cached fields survive a leaner API response.
// Wyoming desligada (Configurações): as consultas vão com wyoming=0, o cache
// local usa um espaço separado (cacheStationKey) e qualquer lançamento vindo
// dela é descartado (withoutWyoming). Trocar a opção refaz tudo na hora.
function clean(launches: Launch[]): Launch[] {
  return isWyomingEnabled() ? launches : withoutWyoming(launches)
}

export function useYearData(year: number, station: Station, onCacheChange?: () => void) {
  const wyomingOn = useWyomingEnabled()
  const clock = nowGMT3()
  const currentYear = clock.getUTCFullYear()
  const currentMonth = clock.getUTCMonth() + 1
  const [data, setData] = useState<YearData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [failedMonths, setFailedMonths] = useState<Set<number>>(new Set())
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null)
  const activeKeyRef = useRef(`${station.id}:${year}:${wyomingOn}`)

  const syncMonths = useCallback(async (y: number, months: number[]): Promise<number[]> => {
    if (months.length === 0) return []
    const requestKey = `${station.id}:${y}:${wyomingOn}`
    setSyncing(true)
    const failed: number[] = []
    for (const m of months) {
      if (activeKeyRef.current !== requestKey) break
      setStatusMsg(`Buscando ${MONTHS_FULL[m - 1]}/${y}…`)
      try {
        const res = await fetch(`/api/sounding?action=month&year=${y}&month=${m}&station=${station.id}${wyomingQuery()}`, { cache: 'no-store' })
        const json = await res.json()
        if (!res.ok || json.error) throw new Error(json.error || `Erro ${res.status}`)
        if (activeKeyRef.current !== requestKey) break

        const cachedRaw = getCacheByYear(y, cacheStationKey(station.id)).find(c => c.month === m)?.launches as Launch[] | undefined
        const cached = cachedRaw ? clean(cachedRaw) : undefined
        const serverLaunches = Array.isArray(json.launches) ? clean(json.launches as Launch[]) : []
        const mergedAll = mergeLaunchCollections(cached ?? [], serverLaunches)
        // Empty/partial provider results do not erase useful evidence. For a
        // non-empty response, server membership is authoritative while richer
        // fields from matching cached missions are retained.
        const launches = serverLaunches.length === 0 && (cached?.length ?? 0) > 0
          ? mergeLaunchCollections(cached ?? [])
          : mergedAll.filter(l => serverLaunches.some(s => sameMission(l, s)))

        writeCache({ year: y, month: m, launches, timestamp: Date.now(), version: 1, station: cacheStationKey(station.id) })
        setData(prev => {
          if (!prev || prev.year !== y || prev.station !== station.id) return prev
          const all = mergeLaunchCollections(prev.launches.filter(l => l.month !== m), launches)
          return { ...prev, launches: all, count: all.length }
        })
        setLastUpdatedAt(Date.now())
        setFailedMonths(prev => {
          if (!prev.has(m)) return prev
          const next = new Set(prev); next.delete(m); return next
        })
      } catch (e: any) {
        if (activeKeyRef.current !== requestKey) break
        setFailedMonths(prev => new Set(prev).add(m))
        failed.push(m)
        if (!(y === currentYear && m === currentMonth)) {
          setError(e?.message || 'Erro ao carregar dados')
        }
      }
    }
    if (activeKeyRef.current === requestKey) {
      setStatusMsg(null)
      setSyncing(false)
      if (failed.length === 0) setError(null)
      onCacheChange?.()
    }
    return failed
  }, [currentYear, currentMonth, station.id, onCacheChange, wyomingOn])

  const fetchData = useCallback(async (y: number) => {
    const requestKey = `${station.id}:${y}:${wyomingOn}`
    activeKeyRef.current = requestKey
    setError(null)
    setFailedMonths(new Set())
    const maxMonth = y === currentYear ? currentMonth : (y > currentYear ? 0 : 12)

    const cacheKey = cacheStationKey(station.id)
    const cachedMonthsAll = getCacheByYear(y, cacheKey)
    const cachedMonths = cachedMonthsAll.filter(c => c.month <= maxMonth)
    for (const stale of cachedMonthsAll) {
      if (stale.month > maxMonth) clearMonth(y, stale.month, cacheKey)
    }
    const launches = clean(mergeLaunchCollections(...cachedMonths.map(c => c.launches as Launch[])))
    setData({ year: y, station: station.id, count: launches.length, launches, errors: [] })
    setLastUpdatedAt(cachedMonths.length ? Math.max(...cachedMonths.map(c => c.timestamp)) : null)

    const cachedSet = new Set(cachedMonths.map(c => c.month))
    let pending: number[] = []
    for (let m = 1; m <= maxMonth; m++) {
      const isCurrent = y === currentYear && m === currentMonth
      if (cachedSet.has(m) && !isCurrent) continue
      pending.push(m)
    }

    for (let attempt = 0; pending.length > 0 && attempt < 3; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, attempt * 8000))
      if (activeKeyRef.current !== requestKey) return
      pending = await syncMonths(y, pending)
    }
  }, [currentYear, currentMonth, syncMonths, station.id, wyomingOn])

  useEffect(() => {
    fetchData(year)
    return () => { activeKeyRef.current = '' }
  }, [year, fetchData])

  useEffect(() => {
    const interval = setInterval(() => {
      const months = new Set(failedMonths)
      if (year === currentYear) months.add(currentMonth)
      if (months.size > 0) syncMonths(year, [...months])
    }, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [year, currentYear, currentMonth, failedMonths, syncMonths])

  return { data, setData, error, statusMsg, syncing, failedMonths, lastUpdatedAt, fetchData, syncMonths }
}
