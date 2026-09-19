'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Station } from '@/app/lib/stations'
import type { Launch } from '@/app/lib/types'
import { nowGMT3 } from '@/app/lib/types'
import {
  attachPositions, enrichPointsWithRecoveries, fetchArchiveMonthPoints, fetchRadiosondyMonthPoints,
  fetchRecentSondeHubPoints, mergeSondePoints, monthOverlapsRecentWindow, pointToRecord, pointsFromLaunches,
  type SondePoint,
} from '@/app/lib/sondePoints'
import { reportSondes } from '@/app/lib/sondeRegistryClient'

/**
 * Todas as sondas de um ANO de uma estação, de todas as fontes: radiosondy.info
 * (todos os meses), SondeHub recente e arquivo S3 do SondeHub (só meses em que
 * ainda falta posição de lançamento). Era a lógica de dentro do "mapa do ano"
 * (YearMap) — extraída pra o mapa do /painel mostrar exatamente o mesmo.
 *
 * Tudo que chega das fontes é mandado pro registro permanente no R2
 * (reportSondes), e o consumidor completa com o registro (mergeWithRegistry).
 *
 * Meses passados não mudam: ficam em memória pela sessão. Mês corrente e
 * SondeHub recente são reconsultados a cada `refreshMinutes` (0 = nunca).
 */

const sessionMonthCache = new Map<string, SondePoint[]>()   // radiosondy por estação/ano/mês (meses passados)
const sessionArchiveCache = new Map<string, SondePoint[]>() // arquivo S3 por estação/ano/mês
const STORAGE_PREFIX = 'sondas_year_points_v1'

function storageKey(stationId: string, year: number) { return `${STORAGE_PREFIX}_${stationId}_${year}` }

function readStored(stationId: string, year: number): SondePoint[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(storageKey(stationId, year))
    const arr = raw ? JSON.parse(raw) : []
    if (!Array.isArray(arr)) return []
    return arr
      .map((p: SondePoint & { date: string }) => ({ ...p, date: new Date(p.date) }))
      .filter((p: SondePoint) => typeof p.lat === 'number' && typeof p.lon === 'number' && !isNaN(p.date.getTime()))
  } catch { return [] }
}

function writeStored(stationId: string, year: number, points: SondePoint[]) {
  try { localStorage.setItem(storageKey(stationId, year), JSON.stringify(points)) } catch { /* cheio */ }
}

export interface YearSondePoints {
  points: SondePoint[]
  status: string | null
  error: string | null
  sources: string[]
  refresh: () => void
}

export function useYearSondePoints(
  station: Station | null, year: number, launches: Launch[],
  opts: { enabled?: boolean; refreshMinutes?: number } = {},
): YearSondePoints {
  const enabled = opts.enabled !== false
  const refreshMinutes = opts.refreshMinutes ?? 0
  const [points, setPoints] = useState<SondePoint[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sources, setSources] = useState<string[]>([])
  const [attempt, setAttempt] = useState(0)
  const requestRef = useRef(0)

  // A página recria o array de lançamentos a cada render; só o conteúdo
  // relevante (datas/horários) dispara nova busca — posição fica de fora pra
  // o preenchimento de posições (onPoints) não realimentar a busca.
  const launchesRef = useRef(launches)
  launchesRef.current = launches
  const launchesKey = useMemo(() => launches.map(l => `${l.date}_${l.time_utc}`).join('|'), [launches])

  const stationId = station?.id ?? null

  useEffect(() => {
    if (!enabled || !station) { setPoints([]); return }
    const request = ++requestRef.current
    const cancelled = () => request !== requestRef.current
    const current = station

    ;(async () => {
      let pts = mergeSondePoints(readStored(current.id, year), pointsFromLaunches(launchesRef.current))
      setPoints(pts)
      setError(null)
      setStatus('Consultando radiosondy.info e SondeHub…')
      const used = new Set<string>(pts.length > 0 ? ['cache'] : [])

      const clock = nowGMT3()
      const isCurrentYear = year === clock.getUTCFullYear()
      const maxMonth = year < clock.getUTCFullYear() ? 12 : isCurrentYear ? clock.getUTCMonth() + 1 : 0
      const months = Array.from({ length: maxMonth }, (_, i) => i + 1)
      const currentMonth = isCurrentYear ? clock.getUTCMonth() + 1 : -1

      // Fase 1: radiosondy.info de todos os meses + SondeHub recente.
      const phase1: Promise<{ source: string; value: SondePoint[] }>[] = []
      const startplace = current.radiosondyStartplace
      if (startplace) {
        for (const m of months) {
          const key = `${current.id}_${year}_${m}`
          const cached = m !== currentMonth ? sessionMonthCache.get(key) : undefined
          phase1.push(cached
            ? Promise.resolve({ source: 'radiosondy', value: cached })
            : fetchRadiosondyMonthPoints(startplace, year, m).then(value => {
                if (m !== currentMonth) sessionMonthCache.set(key, value)
                return { source: 'radiosondy', value }
              }))
        }
      }
      if (months.some(m => monthOverlapsRecentWindow(year, m))) {
        phase1.push(fetchRecentSondeHubPoints(current)
          .then(value => ({ source: 'sondehub', value: value.filter(p => p.date.getUTCFullYear() === year) })))
      }
      // Desenha cada fonte assim que chega.
      let failed = 0
      await Promise.all(phase1.map(t => t.then(r => {
        if (cancelled()) return
        used.add(r.source)
        pts = mergeSondePoints(pts, r.value)
        setPoints(pts)
      }).catch(() => { failed++ })))
      if (cancelled()) return

      // Fase 2: arquivo S3 do SondeHub só nos meses com lançamento sem posição.
      const stillMissing = attachPositions(launchesRef.current, pts).launches.filter(l => !l.position)
      const archiveMonths = [...new Set(stillMissing.map(l => l.month))].filter(m => !monthOverlapsRecentWindow(year, m))
      if (archiveMonths.length > 0) {
        setStatus('Consultando arquivo do SondeHub…')
        const results = await Promise.allSettled(archiveMonths.map(async m => {
          const key = `${current.id}_${year}_${m}`
          const hit = sessionArchiveCache.get(key)
          if (hit) return hit
          const v = await fetchArchiveMonthPoints(current.id, year, m)
          sessionArchiveCache.set(key, v)
          return v
        }))
        if (cancelled()) return
        for (const r of results) {
          if (r.status !== 'fulfilled') { failed++; continue }
          if (r.value.length > 0) used.add('archive')
          pts = mergeSondePoints(pts, r.value)
        }
        setPoints(pts)
      }

      setSources([...used])
      setStatus(null)
      if (failed > 0) setError(`${failed} consulta(s) às fontes falharam — completando com o registro salvo no app.`)

      // Recuperações (SondeHub) pros UNKNOWN; depois grava tudo no registro.
      try {
        const enriched = await enrichPointsWithRecoveries(pts)
        if (cancelled()) return
        if (enriched !== pts) { pts = enriched; setPoints(pts) }
      } catch { /* best-effort */ }
      writeStored(current.id, year, pts)
      reportSondes(pts.map(pointToRecord).filter((r): r is NonNullable<typeof r> => !!r), current.id)
    })().catch((e: any) => {
      if (!cancelled()) { setStatus(null); setError(e?.message || 'Erro ao reunir as posições') }
    })
    return () => { requestRef.current++ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, stationId, year, launchesKey, attempt])

  useEffect(() => {
    if (!enabled || refreshMinutes <= 0 || year !== nowGMT3().getUTCFullYear()) return
    const id = setInterval(() => setAttempt(a => a + 1), refreshMinutes * 60_000)
    return () => clearInterval(id)
  }, [enabled, refreshMinutes, year])

  const refresh = useCallback(() => setAttempt(a => a + 1), [])
  return { points, status, error, sources, refresh }
}
