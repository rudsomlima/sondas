'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Station } from '@/app/lib/stations'
import { getCacheByYear, writeCache } from '@/app/lib/cache'
import { mergeLaunchCollections, sameMission, withoutWyoming } from '@/app/lib/launchData'
import { nowGMT3 } from '@/app/lib/types'
import type { Launch, TodayData } from '@/app/lib/types'
import type { TodayFlight } from '@/app/lib/radiosondy'
import type { Reappearance } from '@/app/lib/reappearance'
import { useTodayData } from '../../historico/hooks/useTodayData'
import { useLiveFlights, type LiveSourceHealth } from '../../historico/hooks/useLiveFlights'
import { useYearSondePoints } from '../../historico/hooks/useYearSondePoints'
import { useYearData } from '../../historico/hooks/useYearData'
import { cacheStationKey, isWyomingEnabled, useWyomingEnabled, wyomingQuery } from '@/app/lib/appSettings'
import { useSondeRegistry } from '../../historico/hooks/useSondeRegistry'
import { useRecoveredLaunches } from '../../historico/hooks/useRecoveredLaunches'
import { useSondeLaunches } from '../../historico/hooks/useSondeLaunches'
import { attachPositions, mergeWithRegistry, isPointInMonth, splitTodayFlights, type SondePoint } from '@/app/lib/sondePoints'
import { reportSondes } from '@/app/lib/sondeRegistryClient'
import type { SondeRecord } from '@/app/lib/sondeRegistry'
import { parseUtcDateStr } from '@/app/lib/launchUtils'
import { useLaunchLandingWatcher } from '../hooks/useLaunchLandingWatcher'

// Tudo que o /painel sabe de UMA estação. O painel monta um <StationFeed>
// por estação escolhida em Configurações e soma os resultados — assim cada
// hook continua sendo de uma estação só (cache, corrida de requisições e
// registro no R2 iguais aos de antes), sem hooks em laço.
export interface StationFeedState {
  station: Station
  todayData: TodayData | null
  todayLoading: boolean
  todayError: string | null
  lastFetchAt: Date | null
  // Voos de hoje já sem os reaparecimentos (ver splitTodayFlights).
  flights: TodayFlight[]
  reappeared: SondePoint[]
  reappearedBySerial: Map<string, Reappearance>
  liveFlightChecked: boolean
  liveError: string | null
  sourceHealth: LiveSourceHealth
  // Todas as sondas do ano (mesmo conjunto do mapa anual) + registro do R2.
  yearPoints: SondePoint[]
  // Lançamentos do mês com posição/recuperação, e uma entrada por sonda.
  positionedMonth: Launch[]
  sondeLaunches: Launch[]
  monthLoading: boolean
  monthError: string | null
}

interface StationFeedProps {
  station: Station
  // Muda a cada clique em "Atualizar" no painel: refaz todas as consultas.
  refreshSignal: number
  onUpdate: (state: StationFeedState) => void
  onRemove: (stationId: string) => void
}

export default function StationFeed({ station, refreshSignal, onUpdate, onRemove }: StationFeedProps) {
  const [monthLaunches, setMonthLaunches] = useState<Launch[]>([])
  const [monthLoading, setMonthLoading] = useState(false)
  const [monthError, setMonthError] = useState<string | null>(null)
  const monthRequestRef = useRef(0)

  const { todayData, todayLoading, todayError, lastFetchAt, refresh: refreshToday } = useTodayData(station)
  const { todayFlights, liveFlightChecked, liveError, sourceHealth, refresh: refreshLive } = useLiveFlights(station, todayData?.today)

  const clock = nowGMT3()
  const year = clock.getUTCFullYear()
  const month = clock.getUTCMonth() + 1

  // Lançamentos do ano inteiro — MESMA fonte do /historico (useYearData,
  // cache-primeiro) — pro mapa mostrar exatamente o conjunto do mapa anual.
  const { data: yearData } = useYearData(year, station)
  const yearLaunches = useMemo(() => mergeLaunchCollections(
    yearData?.year === year && yearData.station === station.id ? yearData.launches : [], monthLaunches,
  ), [yearData, year, station.id, monthLaunches])
  const { points: yearSourcePoints, refresh: refreshPoints } = useYearSondePoints(station, year, yearLaunches, { refreshMinutes: 5 })

  // Registro permanente de sondas (R2): completa o que as fontes não
  // devolvem mais e traz receptores / último sinal / 1º quadro.
  // Ordem = prioridade de enriquecimento: sondas de hoje, depois as mais recentes.
  const registrySerials = useMemo(
    () => [
      ...todayFlights.map(f => f.sondeNumber),
      ...[...yearSourcePoints].sort((a, b) => b.date.getTime() - a.date.getTime()).map(p => p.serial),
    ],
    [yearSourcePoints, todayFlights],
  )
  const records = useSondeRegistry(station.id, [year], registrySerials)
  const yearPoints = useMemo(() => mergeWithRegistry(yearSourcePoints, records,
    (r, p) => !!r.stations?.includes(station.id) && p.date.getUTCFullYear() === year),
  [yearSourcePoints, records, station.id, year])
  const monthPoints = useMemo(() => yearPoints.filter(p => isPointInMonth(p, year, month)), [yearPoints, year, month])

  // Sonda velha reaparecendo hoje (achada e religada em outro lugar) NÃO é voo
  // de hoje: sai das listas e do alerta de pouso, e volta como o pouso
  // original + o reaparecimento ligado a ele. Ver app/lib/reappearance.ts.
  const today = useMemo(() => splitTodayFlights(todayFlights, records), [todayFlights, records])
  useLaunchLandingWatcher(today.flights, station)

  // Sondas de hoje também vão pro registro (posição, último receptor). Sonda
  // reaparecendo é gravada como REAPARECIMENTO: mandar a posição dela como
  // `lastPos` sobrescreveria o pouso original no R2.
  useEffect(() => {
    if (todayFlights.length === 0) return
    reportSondes(todayFlights.flatMap((f): ({ serial: string } & Partial<SondeRecord>)[] => {
      const d = parseUtcDateStr(f.lastReportUtc)
      if (isNaN(d.getTime())) return []
      const at = d.toISOString().replace(/\.\d{3}Z$/, 'Z')
      const reappeared = today.bySerial.get(f.sondeNumber)
      if (reappeared) return [{ serial: f.sondeNumber, reappearances: [reappeared] }]
      return [{
        serial: f.sondeNumber,
        lastPos: { lat: f.lat, lon: f.lon, alt: f.altitude, at },
        lastFrameUtc: at,
        lastReceiver: f.lastReceiver,
        lastReceiverAt: f.lastReceiver ? at : undefined,
        frequencyMHz: f.frequencyMHz,
      }]
    }), station.id)
  }, [todayFlights, today, station.id])

  // Lançamentos sem posição ganham o pouso casado por horário (qualquer fonte).
  const attachedMonth = useMemo(() => attachPositions(monthLaunches, monthPoints).launches, [monthLaunches, monthPoints])
  // Posições UNKNOWN (telemetria RF) ganham FOUND/LOST se alguém registrou a
  // recuperação no SondeHub — em segundo plano, sem atrasar o mapa.
  const positionedMonth = useRecoveredLaunches(attachedMonth)
  // Uma entrada por sonda (inclusive as que não casaram com nenhum slot da
  // Wyoming), com 1º quadro, receptores e último sinal do registro.
  const sondeLaunches = useSondeLaunches(positionedMonth, monthPoints, records)

  // Liga/desliga da Wyoming (Configurações): o mês é recarregado na hora.
  const wyomingOn = useWyomingEnabled()
  const loadMonth = useCallback(async () => {
    const request = ++monthRequestRef.current
    const now = nowGMT3()
    const year = now.getUTCFullYear()
    const month = now.getUTCMonth() + 1
    const clean = (ls: Launch[]) => isWyomingEnabled() ? ls : withoutWyoming(ls)
    const cacheKey = cacheStationKey(station.id)
    const cached = getCacheByYear(year, cacheKey).find(c => c.month === month)
    const cachedLaunches = clean(mergeLaunchCollections((cached?.launches ?? []) as Launch[]))
    setMonthLaunches(cachedLaunches)
    setMonthLoading(true)
    setMonthError(null)
    try {
      const res = await fetch(`/api/sounding?action=month&year=${year}&month=${month}&station=${station.id}${wyomingQuery()}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || `Erro ${res.status}`)
      if (request !== monthRequestRef.current) return
      const server = Array.isArray(json.launches) ? clean(json.launches as Launch[]) : []
      const all = mergeLaunchCollections(cachedLaunches, server)
      const launches = server.length === 0 && cachedLaunches.length > 0
        ? cachedLaunches
        : all.filter(l => server.some(s => sameMission(l, s)))
      writeCache({ year, month, launches, timestamp: Date.now(), version: 1, station: cacheKey })
      setMonthLaunches(launches)
    } catch (e: any) {
      if (request !== monthRequestRef.current) return
      setMonthError(e?.message || 'Falha ao sincronizar o mês; exibindo cache local.')
    } finally {
      if (request === monthRequestRef.current) setMonthLoading(false)
    }
  }, [station.id, wyomingOn])

  useEffect(() => {
    loadMonth()
    return () => { monthRequestRef.current++ }
  }, [loadMonth])

  useEffect(() => {
    if (!todayData?.all_this_month?.length) return
    setMonthLaunches(prev => mergeLaunchCollections(prev, todayData.all_this_month ?? []))
  }, [todayData])

  // "Atualizar" do painel: o 1º valor é o da montagem (as consultas já
  // partiram sozinhas), só os seguintes refazem tudo.
  const refreshRef = useRef({ refreshToday, refreshLive, loadMonth, refreshPoints })
  refreshRef.current = { refreshToday, refreshLive, loadMonth, refreshPoints }
  const firstSignalRef = useRef(refreshSignal)
  useEffect(() => {
    if (refreshSignal === firstSignalRef.current) return
    const r = refreshRef.current
    r.refreshToday(); r.refreshLive(); r.loadMonth(); r.refreshPoints()
  }, [refreshSignal])

  const state = useMemo((): StationFeedState => ({
    station, todayData, todayLoading, todayError, lastFetchAt,
    flights: today.flights, reappeared: today.reappeared, reappearedBySerial: today.bySerial,
    liveFlightChecked, liveError, sourceHealth,
    yearPoints, positionedMonth, sondeLaunches, monthLoading, monthError,
  }), [station, todayData, todayLoading, todayError, lastFetchAt, today, liveFlightChecked, liveError,
    sourceHealth, yearPoints, positionedMonth, sondeLaunches, monthLoading, monthError])

  useEffect(() => { onUpdate(state) }, [state, onUpdate])
  useEffect(() => () => onRemove(station.id), [station.id, onRemove])

  return null
}
