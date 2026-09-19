'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { History, RefreshCw, AlertCircle, Loader2, HardDrive, Radio, Trash2, ShieldCheck } from 'lucide-react'
import { clearMonth, clearYear, getCacheByYear, writeCache } from '@/app/lib/cache'
import { Station, DEFAULT_STATION, getSelectedStation, setSelectedStation } from '@/app/lib/stations'
import type { Launch, LaunchPosition } from '@/app/lib/types'
import { nowGMT3 } from '@/app/lib/types'
import { isValidPosition, launchInstantMs, mergeLaunchCollections, sourceCounts } from '@/app/lib/launchData'
import { launchKey, sameLaunch } from '@/app/lib/launchUtils'
import { useRecoveredLaunches } from './hooks/useRecoveredLaunches'
import { useSondeLaunches } from './hooks/useSondeLaunches'
import { useSondeRegistry } from './hooks/useSondeRegistry'
import { cacheStationKey, useWyomingEnabled, wyomingQuery } from '@/app/lib/appSettings'
import { attachPositions, isPointInMonth, mergeSondePoints, mergeWithRegistry, pointsFromLaunches, type SondePoint } from '@/app/lib/sondePoints'
import { useYearData } from './hooks/useYearData'
import { useSondePoints } from './hooks/useSondePoints'
import { useTodayData } from './hooks/useTodayData'
import { useLiveFlights } from './hooks/useLiveFlights'
import StationPicker from './components/StationPicker'
import LiveCard from './components/LiveCard'
import SummaryCards from './components/SummaryCards'
import MonthlyChart from './components/MonthlyChart'
import MonthAccordion from './components/MonthAccordion'

const NO_LAUNCHES: Launch[] = []

export default function HistoricoPage() {
  const currentYear = nowGMT3().getUTCFullYear()
  const [year, setYear] = useState(currentYear)
  const [station, setStation] = useState<Station>(DEFAULT_STATION)
  const [showStationPicker, setShowStationPicker] = useState(false)
  const [expandedMonth, setExpandedMonth] = useState<number | null>(null)
  const [selectedLaunch, setSelectedLaunch] = useState<Launch | null>(null)
  const [noMatchLaunches, setNoMatchLaunchesState] = useState<Set<string>>(new Set())
  const [showYearMap, setShowYearMap] = useState(false)
  const [deleteMonthConfirm, setDeleteMonthConfirm] = useState<number | null>(null)
  const [deleteYearConfirm, setDeleteYearConfirm] = useState(false)
  const [rechecking, setRechecking] = useState(false)
  const [recheckMsg, setRecheckMsg] = useState<string | null>(null)
  const userInteractedViewRef = useRef<string | null>(null)
  const autoSelectedLaunchRef = useRef<string | null>(null)

  useEffect(() => {
    setStation(getSelectedStation())
  }, [])

  const { data, setData, error, statusMsg, syncing, failedMonths, lastUpdatedAt, fetchData, syncMonths } = useYearData(year, station)
  // Liga/desliga da Wyoming (Configurações) — esconde tudo que é dela.
  const wyomingOn = useWyomingEnabled()
  const { todayData, todayLoading, todayError, lastFetchAt } = useTodayData(station)
  const { todayFlights, liveFlightChecked, liveError, sourceHealth } = useLiveFlights(station, todayData?.today)
  const viewKey = `${station.id}:${year}`

  // Ao trocar de estação/ano, libera uma nova seleção automática. Enquanto o
  // backfill anual chega mês a mês, acompanha o lançamento mais recente já
  // localizado. Depois da primeira interação do usuário, não toma mais o
  // controle da seleção nessa visualização.
  useEffect(() => {
    userInteractedViewRef.current = null
    autoSelectedLaunchRef.current = null
    setExpandedMonth(null)
    setSelectedLaunch(null)
    setShowYearMap(false)
  }, [viewKey])

  useEffect(() => {
    if (!data || data.year !== year || data.station !== station.id || data.launches.length === 0) return
    if (userInteractedViewRef.current === viewKey) return

    const latest = data.launches.reduce((best, launch) =>
      launchInstantMs(launch) > launchInstantMs(best) ? launch : best
    )
    const latestKey = launchKey(latest)
    if (autoSelectedLaunchRef.current === latestKey) return

    autoSelectedLaunchRef.current = latestKey
    setExpandedMonth(latest.month)
    setShowYearMap(false)
    setSelectedLaunch(latest)
  }, [data, station.id, viewKey, year])

  const setSelectedLaunchByUser = useCallback((launch: Launch | null) => {
    userInteractedViewRef.current = viewKey
    setSelectedLaunch(launch)
  }, [viewKey])

  const setExpandedMonthByUser = useCallback((month: number | null) => {
    userInteractedViewRef.current = viewKey
    setExpandedMonth(month)
  }, [viewKey])

  const changeStation = useCallback((s: Station) => {
    setStation(s)
    setSelectedStation(s)
    setSelectedLaunch(null)
    setNoMatchLaunchesState(new Set())
    setShowStationPicker(false)
  }, [])

  // Posições de todas as fontes do mês aberto (ou do mês corrente): preenchem
  // lançamentos sem posição e ficam como contexto no mapa do lançamento.
  const clock = nowGMT3()
  const pointsMonth = expandedMonth ?? (year === clock.getUTCFullYear() ? clock.getUTCMonth() + 1 : null)
  const { points: rawSondePoints } = useSondePoints(station, year, pointsMonth)
  // Status de recuperação do SondeHub nas posições UNKNOWN (só exibição; a
  // rede é consultada só pro mês aberto/corrente, o cache vale pro ano todo).
  const recoveredLaunches = useRecoveredLaunches(data?.launches ?? NO_LAUNCHES, pointsMonth)
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
  const displayLaunches = useSondeLaunches(recoveredLaunches, sondePoints, records)
  const dataRef = useRef(data)
  dataRef.current = data

  const applyPositions = useCallback((resolved: Launch[]) => {
    const withPosition = resolved.filter(l => isValidPosition(l.position))
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

  const handleYearPoints = useCallback((points: SondePoint[]) => {
    const current = dataRef.current
    if (!current || current.year !== year || current.station !== station.id) return
    applyPositions(attachPositions(current.launches, points).changed)
  }, [year, station.id, applyPositions])

  const handleLaunchPosition = useCallback((launch: Launch, position: LaunchPosition) => {
    applyPositions([{ ...launch, position }])
  }, [applyPositions])

  const monthContextPoints = useMemo(() => {
    if (!data || expandedMonth == null) return sondePoints
    return mergeSondePoints(pointsFromLaunches(displayLaunches.filter(l => l.month === expandedMonth)), sondePoints)
  }, [data, displayLaunches, expandedMonth, sondePoints])

  const setNoMatchLaunches = useCallback((updater: (prev: Set<string>) => Set<string>) => {
    setNoMatchLaunchesState(updater)
  }, [])

  const handleConfirmDeleteMonth = useCallback(() => {
    if (deleteMonthConfirm === null) return
    const targetMonth = deleteMonthConfirm
    clearMonth(year, targetMonth, cacheStationKey(station.id))
    setData(prev => prev ? {
      ...prev,
      launches: prev.launches.filter(l => l.month !== targetMonth),
      count: prev.launches.filter(l => l.month !== targetMonth).length,
    } : null)
    setDeleteMonthConfirm(null)
    syncMonths(year, [targetMonth])
  }, [deleteMonthConfirm, year, station.id, setData, syncMonths])

  const handleRecheckWyoming = useCallback(async () => {
    setRechecking(true)
    setRecheckMsg(null)
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
        setRecheckMsg(`${json.downgraded} de ${json.checked} lançamento(s) atualizado(s): a Wyoming não confirma mais os dados.`)
      } else {
        setRecheckMsg(`Nenhuma mudança — ${json.checked} lançamento(s) reverificado(s), todos ainda confirmados pela Wyoming.`)
      }
    } catch (e: any) {
      setRecheckMsg(e.message || 'Erro ao reverificar')
    } finally {
      setRechecking(false)
    }
  }, [year, station.id, fetchData])

  const handleConfirmDeleteYear = useCallback(() => {
    clearYear(year, cacheStationKey(station.id))
    setDeleteYearConfirm(false)
    fetchData(year)
  }, [year, station.id, fetchData])

  const years = Array.from({ length: currentYear - 2019 }, (_, i) => currentYear - i)

  // Agrupa por mês
  const byMonth: Record<number, Launch[]> = {}
  if (data) {
    for (const l of displayLaunches) {
      (byMonth[l.month] ??= []).push(l)
    }
  }
  // O lançamento selecionado é uma cópia de quando foi clicado: troca pela
  // versão atual (ex.: ganhou status de recuperação depois) pro mapa refletir.
  const liveSelectedLaunch = selectedLaunch
    ? displayLaunches.find(l => sameLaunch(l, selectedLaunch)) ?? selectedLaunch
    : null

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-8">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <History size={22} className="text-blue-400" />
              Histórico Anual
            </h1>
            <p className="text-gray-400 text-sm mt-1">Radiossondagens da estação {station.name}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowStationPicker(!showStationPicker)}
              title="Trocar estação"
              className="flex items-center gap-2 px-3 py-2 bg-surface border border-border rounded-md text-sm text-white hover:border-border-strong transition-all max-w-[180px]"
            >
              <Radio size={14} className="text-blue-400 flex-shrink-0" />
              <span className="truncate">{station.name}</span>
            </button>
            <select
              value={year}
              onChange={e => setYear(Number(e.target.value))}
              className="bg-surface border border-border rounded-md text-sm text-white px-3 py-2 outline-none focus:border-blue-500 cursor-pointer"
            >
              {years.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <button
              onClick={() => fetchData(year)}
              disabled={syncing}
              className="flex items-center gap-2 px-3 py-2.5 bg-surface border border-border rounded-md text-sm text-gray-400 hover:text-white hover:border-border-strong transition-all"
              title="Atualizar"
            >
              <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
            </button>
            <Link
              href="/configuracoes#dados"
              className="flex items-center gap-2 px-3 py-2.5 bg-surface border border-border rounded-md text-sm text-gray-400 hover:text-white hover:border-border-strong transition-all"
              title="Dados & Armazenamento"
            >
              <HardDrive size={14} />
            </Link>
            {wyomingOn && <button
              onClick={handleRecheckWyoming}
              disabled={rechecking}
              className="flex items-center gap-2 px-3 py-2.5 bg-surface border border-border rounded-md text-sm text-gray-400 hover:text-white hover:border-border-strong transition-all disabled:opacity-50"
              title="A Wyoming às vezes muda de ideia depois de confirmar uma sondagem (fica indisponível). Reverifica os lançamentos já marcados como confirmados neste ano."
            >
              {rechecking ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
            </button>}
          </div>
        </div>

        {showStationPicker && <StationPicker station={station} onSelect={changeStation} />}
        {recheckMsg && (
          <p className="text-xs text-gray-400 mt-2">{recheckMsg}</p>
        )}
      </div>

      <LiveCard
        todayData={todayData}
        todayLoading={todayLoading}
        todayError={todayError}
        liveError={liveError}
        todayFlights={todayFlights}
        liveFlightChecked={liveFlightChecked}
        lastFetchAt={lastFetchAt}
        selectedLaunch={selectedLaunch}
        onExpandMonth={setExpandedMonthByUser}
        onSelectLaunch={l => { setShowYearMap(false); setSelectedLaunchByUser(l) }}
      />

      {(todayError || liveError) && (
        <div className="panel p-3 mb-6 border-yellow-500/20 bg-yellow-500/5 flex items-start gap-2.5">
          <AlertCircle size={15} className="text-yellow-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs">
            <p className="text-yellow-300">Consulta ao vivo parcial; dados anteriores foram preservados.</p>
            <p className="text-dim mt-1">{todayError || liveError}</p>
          </div>
        </div>
      )}

      {error && (
        <div className="panel p-4 mb-6 border-red-500/20 bg-red-500/5 flex items-start gap-3">
          <AlertCircle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-red-400 font-medium">Erro ao carregar dados</p>
            <p className="text-xs text-gray-400 mt-1">{error}</p>
          </div>
        </div>
      )}

      {statusMsg && (
        <div className="panel p-3 mb-6 border-blue-500/20 bg-blue-500/5 flex items-center gap-2.5">
          <Loader2 size={14} className="text-blue-400 animate-spin flex-shrink-0" />
          <p className="text-xs text-blue-300">{statusMsg}</p>
        </div>
      )}

      {data ? (
        <>
          <SummaryCards data={data} />
          <div className="panel px-4 py-3 mb-6 flex items-center gap-x-5 gap-y-2 flex-wrap text-[11px]">
            <span className="text-dim">Cobertura</span>
            {wyomingOn
              ? <span className="text-src-wyoming mono">W {sourceCounts(data.launches).wyoming}</span>
              : <span className="text-faint" title="Consulta à Wyoming desativada em Configurações">Wyoming desativada</span>}
            <span className="text-src-radiosondy mono">R {sourceCounts(data.launches).radiosondy}</span>
            <span className="text-src-sondehub mono">S {sourceCounts(data.launches).sondehub}</span>
            <span className="text-gray-300 mono">posições {sourceCounts(data.launches).positioned}/{data.count}</span>
            {failedMonths.size > 0 && <span className="text-yellow-400">{failedMonths.size} mês(es) aguardando nova tentativa</span>}
            <span className="ml-auto text-faint">
              {lastUpdatedAt ? `cache atualizado ${new Date(lastUpdatedAt).toLocaleString('pt-BR')}` : 'sem cache local'} · ao vivo {sourceHealth.cache === 'ok' ? 'via snapshot' : 'via fontes diretas'}
            </span>
          </div>
          <MonthlyChart year={year} byMonth={byMonth} />
          <MonthAccordion
            year={year}
            station={station}
            byMonth={byMonth}
            expandedMonth={expandedMonth}
            setExpandedMonth={setExpandedMonthByUser}
            selectedLaunch={liveSelectedLaunch}
            setSelectedLaunch={setSelectedLaunchByUser}
            noMatchLaunches={noMatchLaunches}
            setNoMatchLaunches={setNoMatchLaunches}
            showYearMap={showYearMap}
            setShowYearMap={setShowYearMap}
            deleteMonthConfirm={deleteMonthConfirm}
            onRequestDeleteMonth={setDeleteMonthConfirm}
            onConfirmDeleteMonth={handleConfirmDeleteMonth}
            monthPoints={monthContextPoints}
            records={records}
            onLaunchPosition={handleLaunchPosition}
            onYearPoints={handleYearPoints}
          />

          {data.count > 0 && (
            deleteYearConfirm ? (
              <div className="panel p-4 border-yellow-500/20 bg-yellow-500/5 flex items-center gap-3 flex-wrap">
                <p className="text-sm text-yellow-400 font-medium">Remover {year} do cache local?</p>
                <button
                  onClick={handleConfirmDeleteYear}
                  className="px-3 py-1 bg-red-600 text-xs text-white rounded hover:bg-red-700 transition-all"
                >
                  Confirmar exclusão
                </button>
                <button
                  onClick={() => setDeleteYearConfirm(false)}
                  className="px-3 py-1 bg-surface-2 text-xs text-gray-400 rounded hover:text-white transition-all"
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <button
                onClick={() => setDeleteYearConfirm(true)}
                className="flex items-center gap-2 px-4 py-2 bg-red-600/20 border border-red-500/30 rounded-md text-sm text-red-400 hover:bg-red-600/30 transition-all"
              >
                <Trash2 size={14} />
                Deletar ano inteiro
              </button>
            )
          )}
        </>
      ) : null}
    </div>
  )
}
