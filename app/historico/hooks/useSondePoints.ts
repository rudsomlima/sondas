'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Station } from '@/app/lib/stations'
import { fetchMonthSondePoints, enrichPointsWithRecoveries, applyRecoveriesToPoints, pointToRecord, type SondePoint } from '@/app/lib/sondePoints'
import { reportSondes } from '@/app/lib/sondeRegistryClient'
import { cachedRecovery, type SondeRecovery } from '@/app/lib/sondehubRecovery'
import { nowGMT3 } from '@/app/lib/types'

// Último resultado de cada estação/mês guardado no navegador: o mapa abre com
// ele na hora e só depois troca pelo resultado novo. Sem isso, cada visita ao
// painel esperava todas as fontes (uma delas às vezes leva >10 s).
const STORAGE_PREFIX = 'sondas_points_v1'

function storageKey(stationId: string, year: number, month: number) {
  return `${STORAGE_PREFIX}_${stationId}_${year}_${month}`
}

function readStoredPoints(stationId: string, year: number, month: number): SondePoint[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(storageKey(stationId, year, month))
    const arr = raw ? JSON.parse(raw) : []
    if (!Array.isArray(arr)) return []
    return arr
      .map((p: SondePoint & { date: string }) => ({ ...p, date: new Date(p.date) }))
      .filter((p: SondePoint) => typeof p.lat === 'number' && typeof p.lon === 'number' && !isNaN(p.date.getTime()))
  } catch { return [] }
}

function writeStoredPoints(stationId: string, year: number, month: number, points: SondePoint[]) {
  try { localStorage.setItem(storageKey(stationId, year, month), JSON.stringify(points)) } catch { }
}

// Mescla um resultado parcial de uma fonte com o que já está na tela: por
// sonda (serial), não pelo tamanho total da lista. Antes, uma fonte que
// respondesse com menos pontos num ciclo (comum logo após o pouso, quando
// uma fonte fica momentaneamente atrás) fazia o app descartar a atualização
// inteira e manter a posição antiga de todas as sondas, inclusive as que já
// tinham dado novo. Agora cada sonda é atualizada se o parcial trouxer um
// reporte mais recente para ela, e as demais (não presentes nesse parcial)
// continuam com o que já estava na tela.
function mergePartial(prev: SondePoint[], partial: SondePoint[]): SondePoint[] {
  const bySerial = new Map(prev.map(p => [p.serial, p]))
  for (const p of partial) {
    const existing = bySerial.get(p.serial)
    if (!existing || p.date.getTime() >= existing.date.getTime()) bySerial.set(p.serial, p)
  }
  return [...bySerial.values()]
}

// Aplica só o que já está no cache de recuperações (sem rede) — pra os
// pontos parciais já saírem com o status certo das sondas já consultadas.
function withCachedRecoveries(points: SondePoint[]): SondePoint[] {
  const known = new Map<string, SondeRecovery>()
  for (const p of points) {
    if (p.status !== 'UNKNOWN') continue
    const rec = cachedRecovery(p.serial)
    if (rec) known.set(p.serial, rec)
  }
  return applyRecoveriesToPoints(points, known)
}

// Posições de todas as fontes (radiosondy.info + SondeHub recente/arquivo) de
// um mês, independentes da lista de lançamentos. month = null desliga a busca.
// O mês corrente é reconsultado periodicamente; meses passados, uma vez.
export function useSondePoints(station: Station, year: number, month: number | null, refreshMinutes = 5) {
  const [points, setPoints] = useState<SondePoint[]>([])
  const [loading, setLoading] = useState(false)
  const requestRef = useRef(0)

  const load = useCallback(async () => {
    const request = ++requestRef.current
    if (month == null) { setPoints([]); setLoading(false); return }
    const now = nowGMT3()
    const isRecent = year === now.getUTCFullYear() && now.getUTCMonth() + 1 - month <= 1
    setLoading(true)
    try {
      // O arquivo S3 do SondeHub tem meses de atraso: só vale para meses antigos.
      const result = await fetchMonthSondePoints(station, year, month, { archive: !isRecent }, partial => {
        // Desenha cada fonte assim que responde, mesclando por sonda com o
        // que já está na tela (ex.: vinda do localStorage) — ver mergePartial.
        if (request !== requestRef.current) return
        setPoints(prev => withCachedRecoveries(mergePartial(prev, partial)))
      })
      if (request !== requestRef.current) return
      // Falha total de rede não apaga os pontos já conhecidos.
      if (result.points.length === 0 && result.failed > 0) return
      const base = withCachedRecoveries(result.points)
      setPoints(base)
      writeStoredPoints(station.id, year, month, base)
      // Recuperações do SondeHub pros que ainda estão UNKNOWN: em segundo
      // plano, depois de o mapa já estar desenhado.
      const enriched = await enrichPointsWithRecoveries(base)
      // Tudo que veio das fontes vai pro registro permanente no R2.
      reportSondes(enriched.map(pointToRecord).filter((r): r is NonNullable<typeof r> => !!r), station.id)
      if (request !== requestRef.current || enriched === base) return
      setPoints(enriched)
      writeStoredPoints(station.id, year, month, enriched)
    } finally {
      if (request === requestRef.current) setLoading(false)
    }
  }, [station, year, month])

  useEffect(() => {
    setPoints(month == null ? [] : withCachedRecoveries(readStoredPoints(station.id, year, month)))
    load()
    const now = nowGMT3()
    const isCurrent = year === now.getUTCFullYear() && month === now.getUTCMonth() + 1
    if (!isCurrent || refreshMinutes <= 0) return () => { requestRef.current++ }
    const interval = setInterval(load, refreshMinutes * 60 * 1000)
    return () => { requestRef.current++; clearInterval(interval) }
  }, [load, station.id, year, month, refreshMinutes])

  return { points, loading, refresh: load }
}
