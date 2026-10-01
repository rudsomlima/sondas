'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { clearMonth, clearYear, getCacheByYear, writeCache } from '@/app/lib/cache'
import type { Station } from '@/app/lib/stations'
import type { Launch, LaunchPosition, TodayData } from '@/app/lib/types'
import { nowGMT3 } from '@/app/lib/types'
import type { TodayFlight } from '@/app/lib/radiosondy'
import { isValidPosition, mergeLaunchCollections } from '@/app/lib/launchData'
import { MONTHS_FULL, withoutStationTag } from '@/app/lib/launchUtils'
import { cacheStationKey, wyomingQuery } from '@/app/lib/appSettings'
import { attachPositions, isPointInMonth, mergeSondePoints, mergeWithRegistry, pointsFromLaunches, splitTodayFlights, type SondePoint } from '@/app/lib/sondePoints'
import { useRecoveredLaunches } from '../hooks/useRecoveredLaunches'
import { useSondeLaunches } from '../hooks/useSondeLaunches'
import { useSondeRegistry } from '../hooks/useSondeRegistry'
import { useYearData } from '../hooks/useYearData'
import { useSondePoints } from '../hooks/useSondePoints'
import { useTodayData } from '../hooks/useTodayData'
import { useLiveFlights, type LiveSourceHealth } from '../hooks/useLiveFlights'

const NO_LAUNCHES: Launch[] = []

// Ações de UMA estação que a página dispara (por estação, ou em todas na aba
// "Todas"). Referência estável: não muda entre renders.
export interface HistoryStationActions {
  refresh: () => void
  // Mensagem pronta pra mostrar (sucesso ou erro).
  recheck: () => Promise<string>
  deleteMonth: (month: number) => Promise<string>
  deleteYear: () => void
  launchPosition: (launch: Launch, position: LaunchPosition) => void
  yearPoints: (points: SondePoint[]) => void
}

// Tudo que o /historico sabe de UMA estação num ano. A página monta um
// <HistoryStationFeed> por estação escolhida e mostra uma delas (aba da
// estação) ou a soma de todas (aba "Todas") — cada hook segue sendo de uma
// estação só, sem hooks em laço. Os lançamentos saem carimbados com
// `stationId` (só exibição) pra o mesmo horário em duas estações não se
// confundir na tela.
export interface HistoryStationState {
  station: Station
  year: number
  // Ano desta estação já montado (cache ou servidor).
  ready: boolean
  // Lançamentos da Wyoming/cache (a "verdade" do ano) e a lista de exibição
  // (uma entrada por sonda, completada pelo registro), ambos carimbados.
  yearLaunches: Launch[]
  displayLaunches: Launch[]
  // Pontos de contexto do mês aberto (mapa do lançamento).
  monthContextPoints: SondePoint[]
  error: string | null
  statusMsg: string | null
  syncing: boolean
  failedMonths: Set<number>
  lastUpdatedAt: number | null
  todayData: TodayData | null
  todayLoading: boolean
  todayError: string | null
  lastFetchAt: Date | null
  flights: TodayFlight[]
  reappeared: SondePoint[]
  liveFlightChecked: boolean
  liveError: string | null
  sourceHealth: LiveSourceHealth
  actions: HistoryStationActions
}

interface HistoryStationFeedProps {
  station: Station
  year: number
  expandedMonth: number | null
  onUpdate: (state: HistoryStationState) => void
  onRemove: (stationId: string) => void
}

export default function HistoryStationFeed({ station, year, expandedMonth, onUpdate, onRemove }: HistoryStationFeedProps) {
  const { data, setData, error, statusMsg, syncing, failedMonths, lastUpdatedAt, fetchData } = useYearData(year, station)
  const { todayData, todayLoading, todayError, lastFetchAt } = useTodayData(station)
  const { todayFlights, liveFlightChecked, liveError, sourceHealth } = useLiveFlights(station, todayData?.today)
  const ready = !!data && data.year === year && data.station === station.id

  // Posições de todas as fontes do mês aberto (ou do mês corrente): preenchem
  // lançamentos sem posição e ficam como contexto no mapa do lançamento.
  const clock = nowGMT3()
  const pointsMonth = expandedMonth ?? (year === clock.getUTCFullYear() ? clock.getUTCMonth() + 1 : null)
  const { points: rawSondePoints } = useSondePoints(station, year, pointsMonth)
  // Status de recuperação do SondeHub nas posições UNKNOWN (só exibição; a
  // rede é consultada só pro mês aberto/corrente, o cache vale pro ano todo).
  const recoveredLaunches = useRecoveredLaunches(ready ? data.launches : NO_LAUNCHES, pointsMonth)
  // Registro permanente de sondas (R2): o ano inteiro da estação vem de uma
  // vez (completa todos os meses); as fontes pesadas só são consultadas pras
  // sondas do mês aberto.
  const registrySerials = useMemo(() => [
    ...rawSondePoints.map(p => p.serial),
    ...recoveredLaunches.filter(l => l.month === pointsMonth && l.position).map(l => l.position!.sondeNumber),
  ], [rawSondePoints, recoveredLaunches, pointsMonth])
  const records = useSondeRegistry(station.id, [year], registrySerials)
  const sondePoints = useMemo(() => pointsMonth == null ? rawSondePoints : mergeWithRegistry(rawSondePoints, records,
    (r, p) => !!r.stations?.includes(station.id) && isPointInMonth(p, year, pointsMonth)),
  [rawSondePoints, records, station.id, year, pointsMonth])
  // Uma entrada por sonda + 1º quadro, receptores e último sinal (só exibição:
  // o YearStore/cache do ano continuam sendo a verdade da Wyoming).
  const displayLaunchesRaw = useSondeLaunches(recoveredLaunches, sondePoints, records)
  // Sonda velha reportada de novo hoje não é voo de hoje: sai do card "Ao
  // vivo" como voo e volta como reaparecimento, ligada ao pouso original.
  // Ver app/lib/reappearance.ts.
  const today = useMemo(() => splitTodayFlights(todayFlights, records), [todayFlights, records])

  const tag = useCallback((ls: Launch[]) => ls.map(l => ({ ...l, stationId: station.id })), [station.id])
  const yearLaunches = useMemo(() => ready ? tag(data.launches) : NO_LAUNCHES, [ready, data, tag])
  const displayLaunches = useMemo(() => tag(displayLaunchesRaw), [displayLaunchesRaw, tag])
  const taggedToday = useMemo((): TodayData | null => todayData ? {
    ...todayData, launches: tag(todayData.launches ?? []),
  } : null, [todayData, tag])

  const dataRef = useRef(data)
  dataRef.current = data

  const applyPositions = useCallback((resolved: Launch[]) => {
    const withPosition = resolved.filter(l => isValidPosition(l.position)).map(withoutStationTag)
    if (withPosition.length === 0) return
    // Só atualiza meses já presentes no cache local: criar uma entrada nova
    // faria o useYearData pular a busca desse mês no servidor.
    for (const m of new Set(withPosition.map(l => l.month))) {
      const entry = getCacheByYear(year, cacheStationKey(station.id)).find(c => c.month === m)
      if (!entry) continue
      writeCache({ ...entry, launches: mergeLaunchCollections(entry.launches as Launch[], withPosition.filter(l => l.month === m)) })
    }
    const byKey = new Map(withPosition.map(l => [`${l.date}_${l.time_utc}`, l.position!]))
    setData(prev => {
      if (!prev || prev.year !== year || prev.station !== station.id) return prev
      let changed = false
      const launches = prev.launches.map(l => {
        const position = byKey.get(`${l.date}_${l.time_utc}`)
        if (!position || isValidPosition(l.position)) return l
        changed = true
        return { ...l, position }
      })
      return changed ? { ...prev, launches } : prev
    })
  }, [year, station.id, setData])

  useEffect(() => {
    if (!data || data.year !== year || data.station !== station.id || sondePoints.length === 0) return
    const { changed } = attachPositions(data.launches, sondePoints)
    if (changed.length > 0) applyPositions(changed)
  }, [data, sondePoints, year, station.id, applyPositions])

  const monthContextPoints = useMemo(() => {
    if (!ready || expandedMonth == null) return sondePoints
    return mergeSondePoints(pointsFromLaunches(displayLaunchesRaw.filter(l => l.month === expandedMonth)), sondePoints)
  }, [ready, displayLaunchesRaw, expandedMonth, sondePoints])

  // Apaga o mês DE VERDADE: no R2 (YearStore) e no cache deste navegador.
  // Não ressincroniza depois — era isso que fazia o mês voltar na hora, e o
  // botão parecer que não apagava nada. Sem desfazer: só volta se o mês for
  // sincronizado de novo (botão Atualizar / sync automático).
  const deleteMonth = useCallback(async (targetMonth: number): Promise<string> => {
    clearMonth(year, targetMonth, cacheStationKey(station.id))
    setData(prev => prev ? {
      ...prev,
      launches: prev.launches.filter(l => l.month !== targetMonth),
      count: prev.launches.filter(l => l.month !== targetMonth).length,
    } : null)
    try {
      const res = await fetch(
        `/api/sounding?action=delete-month&year=${year}&month=${targetMonth}&station=${station.id}`,
        { cache: 'no-store' },
      )
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || `Erro ${res.status}`)
      const nome = MONTHS_FULL[targetMonth - 1]
      const quanto = json.removed > 0
        ? `${json.removed} lançamento(s) apagado(s) do servidor`
        : 'nada havia gravado no servidor; só o cache local foi limpo'
      // Mês corrente não congela: a coleta segue e o que as fontes reportarem
      // volta na próxima sincronização. Melhor dizer do que o usuário
      // descobrir sozinho recarregando a página.
      const now = nowGMT3()
      return json.frozen === false && json.removed >= 0 && targetMonth === now.getUTCMonth() + 1 && year === now.getUTCFullYear()
        ? `${nome}: ${quanto}. Como é o mês corrente, ele continua sendo coletado — o que as fontes reportarem volta na próxima sincronização.`
        : `${nome}: ${quanto}.`
    } catch (e: any) {
      return `Apagado só neste navegador — o servidor recusou: ${e.message}`
    }
  }, [year, station.id, setData])

  const recheck = useCallback(async (): Promise<string> => {
    try {
      const res = await fetch(`/api/sounding?action=recheck&year=${year}&station=${station.id}${wyomingQuery()}`)
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      if (json.downgraded > 0) {
        // Alguns launches passaram de "confirmado" para "erro" — o cache
        // local (localStorage) ficaria com o dado antigo até o próximo
        // clique manual em "Atualizar", então recarrega direto da API.
        clearYear(year, cacheStationKey(station.id))
        await fetchData(year)
        return `${json.downgraded} de ${json.checked} lançamento(s) atualizado(s): a Wyoming não confirma mais os dados.`
      }
      return `Nenhuma mudança — ${json.checked} lançamento(s) reverificado(s), todos ainda confirmados pela Wyoming.`
    } catch (e: any) {
      return e.message || 'Erro ao reverificar'
    }
  }, [year, station.id, fetchData])

  const deleteYear = useCallback(() => {
    clearYear(year, cacheStationKey(station.id))
    fetchData(year)
  }, [year, station.id, fetchData])

  const latestRef = useRef({ fetchData, recheck, deleteMonth, deleteYear, applyPositions, year, station })
  latestRef.current = { fetchData, recheck, deleteMonth, deleteYear, applyPositions, year, station }
  const actions = useMemo((): HistoryStationActions => ({
    refresh: () => { latestRef.current.fetchData(latestRef.current.year) },
    recheck: () => latestRef.current.recheck(),
    deleteMonth: m => latestRef.current.deleteMonth(m),
    deleteYear: () => latestRef.current.deleteYear(),
    launchPosition: (launch, position) => latestRef.current.applyPositions([{ ...launch, position }]),
    yearPoints: points => {
      const { year, station, applyPositions } = latestRef.current
      const current = dataRef.current
      if (!current || current.year !== year || current.station !== station.id) return
      applyPositions(attachPositions(current.launches, points).changed)
    },
  }), [])

  const state = useMemo((): HistoryStationState => ({
    station, year, ready, yearLaunches, displayLaunches, monthContextPoints,
    error, statusMsg, syncing, failedMonths, lastUpdatedAt,
    todayData: taggedToday, todayLoading, todayError, lastFetchAt,
    flights: today.flights, reappeared: today.reappeared,
    liveFlightChecked, liveError, sourceHealth, actions,
  }), [station, year, ready, yearLaunches, displayLaunches, monthContextPoints, error, statusMsg, syncing,
    failedMonths, lastUpdatedAt, taggedToday, todayLoading, todayError, lastFetchAt, today,
    liveFlightChecked, liveError, sourceHealth, actions])

  useEffect(() => { onUpdate(state) }, [state, onUpdate])
  useEffect(() => () => onRemove(station.id), [station.id, onRemove])

  return null
}
