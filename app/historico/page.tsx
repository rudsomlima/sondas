'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { History, RefreshCw, AlertCircle, Loader2, HardDrive, Radio, Trash2, ShieldCheck } from 'lucide-react'
import { Station, setSelectedStations, stationShortName } from '@/app/lib/stations'
import { useSelectedStations } from '@/app/lib/useSelectedStations'
import type { Launch, LaunchPosition, YearData } from '@/app/lib/types'
import { nowGMT3 } from '@/app/lib/types'
import type { TodayFlight } from '@/app/lib/radiosondy'
import { launchInstantMs, sourceCounts } from '@/app/lib/launchData'
import { launchKey, sameLaunch } from '@/app/lib/launchUtils'
import { useSondeRegistry } from './hooks/useSondeRegistry'
import { combineSourceHealth } from './hooks/useLiveFlights'
import { useWyomingEnabled } from '@/app/lib/appSettings'
import type { SondePoint } from '@/app/lib/sondePoints'
import StationMultiPicker from '@/app/components/StationMultiPicker'
import StationTabs, { ALL_STATIONS } from '@/app/components/StationTabs'
import HistoryStationFeed, { type HistoryStationState } from './components/HistoryStationFeed'
import LiveCard from './components/LiveCard'
import SummaryCards from './components/SummaryCards'
import MonthlyChart from './components/MonthlyChart'
import MonthAccordion from './components/MonthAccordion'

const NO_YEARS: number[] = []
const NO_SERIALS: string[] = []
const NO_POINTS: SondePoint[] = []

export default function HistoricoPage() {
  const currentYear = nowGMT3().getUTCFullYear()
  const [year, setYear] = useState(currentYear)
  // Estações escolhidas em Configurações. Com mais de uma, a aba "Todas"
  // (padrão) soma todas; cada estação também tem a sua aba. Um
  // <HistoryStationFeed> por estação faz as consultas — aqui só se junta.
  const { stations, ready } = useSelectedStations()
  const [activeView, setActiveView] = useState<string>(ALL_STATIONS)
  const viewStations = useMemo(() => {
    const one = stations.filter(s => s.id === activeView)
    return one.length > 0 ? one : stations
  }, [stations, activeView])
  const viewId = viewStations.length === 1 && stations.length > 1 ? viewStations[0].id : ALL_STATIONS
  const single = viewStations.length === 1
  const primary = viewStations[0]
  const [feeds, setFeeds] = useState<Record<string, HistoryStationState>>({})
  const [showStationPicker, setShowStationPicker] = useState(false)
  const [expandedMonth, setExpandedMonth] = useState<number | null>(null)
  const [selectedLaunch, setSelectedLaunch] = useState<Launch | null>(null)
  const [noMatchLaunches, setNoMatchLaunchesState] = useState<Set<string>>(new Set())
  const [showYearMap, setShowYearMap] = useState(false)
  const [deleteMonthConfirm, setDeleteMonthConfirm] = useState<number | null>(null)
  const [deleteMonthMsg, setDeleteMonthMsg] = useState<string | null>(null)
  const [deleteYearConfirm, setDeleteYearConfirm] = useState(false)
  const [rechecking, setRechecking] = useState(false)
  const [recheckMsg, setRecheckMsg] = useState<string | null>(null)
  const userInteractedViewRef = useRef<string | null>(null)
  const autoSelectedLaunchRef = useRef<string | null>(null)

  // Liga/desliga da Wyoming (Configurações) — esconde tudo que é dela.
  const wyomingOn = useWyomingEnabled()
  // Registro de sondas (cache local, todas as estações) — só leitura aqui;
  // quem busca/enriquece é cada feed.
  const records = useSondeRegistry(null, NO_YEARS, NO_SERIALS, false)

  const onFeedUpdate = useCallback((state: HistoryStationState) => {
    setFeeds(prev => prev[state.station.id] === state ? prev : { ...prev, [state.station.id]: state })
  }, [])
  const onFeedRemove = useCallback((stationId: string) => {
    setFeeds(prev => {
      if (!(stationId in prev)) return prev
      const next = { ...prev }
      delete next[stationId]
      return next
    })
  }, [])
  // Feeds da visualização atual, na ordem escolhida, só os do ano aberto.
  const viewFeeds = useMemo(
    () => viewStations.map(s => feeds[s.id]).filter((f): f is HistoryStationState => !!f && f.year === year),
    [viewStations, feeds, year],
  )
  const stationById = useMemo(() => new Map(stations.map(s => [s.id, s])), [stations])
  const stationOf = useCallback((l: Launch) => (l.stationId && stationById.get(l.stationId)) || primary, [stationById, primary])

  const viewKey = `${viewStations.map(s => s.id).join(',')}:${year}`

  // Soma das estações da visualização (com uma só, é ela mesma).
  const merged = useMemo(() => {
    const flights = new Map<string, TodayFlight>()
    const flightStationName = new Map<string, string>()
    const reappeared = new Map<string, SondePoint>()
    for (const f of viewFeeds) {
      for (const fl of f.flights) {
        const prev = flights.get(fl.sondeNumber)
        if (!prev || fl.lastReportUtc > prev.lastReportUtc) flights.set(fl.sondeNumber, fl)
        if (!flightStationName.has(fl.sondeNumber)) flightStationName.set(fl.sondeNumber, stationShortName(f.station))
      }
      for (const p of f.reappeared) if (!reappeared.has(p.serial)) reappeared.set(p.serial, p)
    }
    const todays = viewFeeds.map(f => f.todayData).filter((t): t is NonNullable<typeof t> => !!t)
    const todayData = todays.length === 0 ? null : todays.length === 1 ? todays[0] : {
      ...todays[0],
      station: todays.map(t => t.station).join(','),
      launched_today: todays.some(t => t.launched_today),
      count: todays.reduce((n, t) => n + (t.count ?? 0), 0),
      launches: todays.flatMap(t => t.launches ?? []),
    }
    const joinMsgs = (pick: (f: HistoryStationState) => string | null) => {
      const list = viewFeeds.filter(f => pick(f))
      if (list.length === 0) return null
      return single ? pick(list[0]) : list.map(f => `${stationShortName(f.station)}: ${pick(f)}`).join(' · ')
    }
    const times = (xs: (number | null | undefined)[]) => xs.filter((x): x is number => !!x)
    const updated = times(viewFeeds.map(f => f.lastUpdatedAt))
    const fetched = times(viewFeeds.map(f => f.lastFetchAt?.getTime()))
    const failedMonths = new Set<number>()
    for (const f of viewFeeds) for (const m of f.failedMonths) failedMonths.add(m)
    return {
      anyReady: viewFeeds.some(f => f.ready),
      yearLaunches: viewFeeds.flatMap(f => f.yearLaunches),
      displayLaunches: viewFeeds.flatMap(f => f.displayLaunches),
      flights: [...flights.values()],
      flightStationName,
      reappeared: [...reappeared.values()],
      todayData,
      todayLoading: viewFeeds.length < viewStations.length || viewFeeds.some(f => f.todayLoading),
      todayError: joinMsgs(f => f.todayError),
      liveError: joinMsgs(f => f.liveError),
      error: joinMsgs(f => f.error),
      statusMsg: joinMsgs(f => f.statusMsg),
      syncing: viewFeeds.some(f => f.syncing),
      failedMonths,
      lastUpdatedAt: updated.length ? Math.max(...updated) : null,
      lastFetchAt: fetched.length ? new Date(Math.max(...fetched)) : null,
      liveFlightChecked: viewFeeds.length === viewStations.length && viewFeeds.every(f => f.liveFlightChecked),
      sourceHealth: combineSourceHealth(viewFeeds.map(f => f.sourceHealth)),
    }
  }, [viewFeeds, viewStations.length, single])

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
    setDeleteMonthConfirm(null)
    setDeleteYearConfirm(false)
    setNoMatchLaunchesState(new Set())
  }, [viewKey])

  useEffect(() => {
    if (merged.yearLaunches.length === 0) return
    if (userInteractedViewRef.current === viewKey) return

    const latest = merged.yearLaunches.reduce((best, launch) =>
      launchInstantMs(launch) > launchInstantMs(best) ? launch : best
    )
    const latestKey = launchKey(latest)
    if (autoSelectedLaunchRef.current === latestKey) return

    autoSelectedLaunchRef.current = latestKey
    setExpandedMonth(latest.month)
    setShowYearMap(false)
    setSelectedLaunch(latest)
  }, [merged.yearLaunches, viewKey])

  const setSelectedLaunchByUser = useCallback((launch: Launch | null) => {
    userInteractedViewRef.current = viewKey
    setSelectedLaunch(launch)
  }, [viewKey])

  const setExpandedMonthByUser = useCallback((month: number | null) => {
    userInteractedViewRef.current = viewKey
    setExpandedMonth(month)
  }, [viewKey])

  // Trocar de aba só muda o que está sendo visto; a seleção/mapa abertos são
  // limpos pelo efeito de viewKey.
  const changeStation = useCallback((s: Station) => setActiveView(s.id), [])
  // Editar a lista aqui vale pro app inteiro (igual a Configurações).
  const changeStations = useCallback((list: Station[]) => {
    setSelectedStations(list)
  }, [])

  const feedOf = useCallback((stationId: string | undefined) => feeds[stationId ?? primary.id], [feeds, primary])

  const handleLaunchPosition = useCallback((launch: Launch, position: LaunchPosition) => {
    feedOf(launch.stationId)?.actions.launchPosition(launch, position)
  }, [feedOf])

  const handleYearPoints = useCallback((stationId: string, points: SondePoint[]) => {
    feeds[stationId]?.actions.yearPoints(points)
  }, [feeds])

  const setNoMatchLaunches = useCallback((updater: (prev: Set<string>) => Set<string>) => {
    setNoMatchLaunchesState(updater)
  }, [])

  // Apagar mês/ano só existe com UMA estação na tela (aba da estação, ou uma
  // estação só escolhida) — ver canDelete no MonthAccordion.
  const handleConfirmDeleteMonth = useCallback(async () => {
    if (deleteMonthConfirm === null || !single) return
    const targetMonth = deleteMonthConfirm
    setDeleteMonthConfirm(null)
    setDeleteMonthMsg(null)
    const msg = await feeds[primary.id]?.actions.deleteMonth(targetMonth)
    if (msg) setDeleteMonthMsg(msg)
  }, [deleteMonthConfirm, single, feeds, primary])

  const handleRecheckWyoming = useCallback(async () => {
    setRechecking(true)
    setRecheckMsg(null)
    try {
      const msgs = await Promise.all(viewFeeds.map(async f => {
        const msg = await f.actions.recheck()
        return single ? msg : `${stationShortName(f.station)}: ${msg}`
      }))
      setRecheckMsg(msgs.join(' · '))
    } finally {
      setRechecking(false)
    }
  }, [viewFeeds, single])

  const handleConfirmDeleteYear = useCallback(() => {
    if (!single) return
    feeds[primary.id]?.actions.deleteYear()
    setDeleteYearConfirm(false)
  }, [single, feeds, primary])

  const refreshAll = useCallback(() => {
    for (const f of viewFeeds) f.actions.refresh()
  }, [viewFeeds])

  const years = Array.from({ length: currentYear - 2019 }, (_, i) => currentYear - i)
  const displayLaunches = merged.displayLaunches

  // Agrupa por mês
  const byMonth: Record<number, Launch[]> = {}
  for (const l of displayLaunches) {
    (byMonth[l.month] ??= []).push(l)
  }
  // O lançamento selecionado é uma cópia de quando foi clicado: troca pela
  // versão atual (ex.: ganhou status de recuperação depois) pro mapa refletir.
  const liveSelectedLaunch = selectedLaunch
    ? displayLaunches.find(l => sameLaunch(l, selectedLaunch)) ?? selectedLaunch
    : null
  // Contexto do mapa do lançamento = pontos do mês da estação dele.
  const monthPoints = feedOf(liveSelectedLaunch?.stationId)?.monthContextPoints ?? NO_POINTS
  const summaryData: YearData = {
    year, station: viewStations.map(s => s.id).join(','), count: displayLaunches.length, launches: displayLaunches, errors: [],
  }
  const multiView = viewStations.length > 1
  const stationName = useCallback((id: string | undefined) => {
    const st = id ? stationById.get(id) : undefined
    return st ? stationShortName(st) : undefined
  }, [stationById])

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Um alimentador invisível por estação escolhida (todas, pra trocar de
          aba sem esperar) — só depois de ler a lista real. */}
      {ready && stations.map(s => (
        <HistoryStationFeed
          key={s.id} station={s} year={year}
          expandedMonth={viewStations.some(v => v.id === s.id) ? expandedMonth : null}
          onUpdate={onFeedUpdate} onRemove={onFeedRemove}
        />
      ))}

      <div className="mb-8">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <History size={22} className="text-blue-400" />
              Histórico Anual
            </h1>
            <p className="text-gray-400 text-sm mt-1">
              {multiView
                ? <>Radiossondagens das estações {viewStations.map(s => stationShortName(s)).join(', ')}</>
                : <>Radiossondagens da estação {primary.name}</>}
              {!multiView && stations.length > 1 && <span className="text-faint"> · {stations.length} estações escolhidas</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowStationPicker(!showStationPicker)}
              title="Escolher estações (vale para todo o app)"
              className="flex items-center gap-2 px-3 py-2 bg-surface border border-border rounded-md text-sm text-white hover:border-border-strong transition-all max-w-[180px]"
            >
              <Radio size={14} className="text-blue-400 flex-shrink-0" />
              <span className="truncate">{stations.length > 1 ? `Estações (${stations.length})` : primary.name}</span>
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
              onClick={refreshAll}
              disabled={merged.syncing}
              className="flex items-center gap-2 px-3 py-2.5 bg-surface border border-border rounded-md text-sm text-gray-400 hover:text-white hover:border-border-strong transition-all"
              title="Atualizar"
            >
              <RefreshCw size={14} className={merged.syncing ? 'animate-spin' : ''} />
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
              title={`A Wyoming às vezes muda de ideia depois de confirmar uma sondagem (fica indisponível). Reverifica os lançamentos já marcados como confirmados neste ano${multiView ? ' — em todas as estações mostradas' : ''}.`}
            >
              {rechecking ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
            </button>}
          </div>
        </div>

        <StationTabs
          stations={stations} activeId={viewId} onChange={changeStation}
          onSelectAll={() => setActiveView(ALL_STATIONS)} className="mt-4"
        />
        {showStationPicker && <StationMultiPicker selected={stations} onChange={changeStations} autoFocus />}
        {recheckMsg && (
          <p className="text-xs text-gray-400 mt-2">{recheckMsg}</p>
        )}
        {deleteMonthMsg && (
          <p className="text-xs text-yellow-300 mt-2 flex items-start gap-2">
            <span className="flex-1">{deleteMonthMsg}</span>
            <button onClick={() => setDeleteMonthMsg(null)} className="text-gray-400 hover:text-white">dispensar</button>
          </p>
        )}
      </div>

      <LiveCard
        todayData={merged.todayData}
        todayLoading={merged.todayLoading}
        todayError={merged.todayError}
        liveError={merged.liveError}
        todayFlights={merged.flights}
        reappearedToday={merged.reappeared}
        liveFlightChecked={merged.liveFlightChecked}
        lastFetchAt={merged.lastFetchAt}
        selectedLaunch={selectedLaunch}
        onExpandMonth={setExpandedMonthByUser}
        onSelectLaunch={l => { setShowYearMap(false); setSelectedLaunchByUser(l) }}
        stationName={multiView ? stationName : undefined}
        flightStationName={multiView ? merged.flightStationName : undefined}
      />

      {(merged.todayError || merged.liveError) && (
        <div className="panel p-3 mb-6 border-yellow-500/20 bg-yellow-500/5 flex items-start gap-2.5">
          <AlertCircle size={15} className="text-yellow-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs">
            <p className="text-yellow-300">Consulta ao vivo parcial; dados anteriores foram preservados.</p>
            <p className="text-dim mt-1">{merged.todayError || merged.liveError}</p>
          </div>
        </div>
      )}

      {merged.error && (
        <div className="panel p-4 mb-6 border-red-500/20 bg-red-500/5 flex items-start gap-3">
          <AlertCircle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-red-400 font-medium">Erro ao carregar dados</p>
            <p className="text-xs text-gray-400 mt-1">{merged.error}</p>
          </div>
        </div>
      )}

      {merged.statusMsg && (
        <div className="panel p-3 mb-6 border-blue-500/20 bg-blue-500/5 flex items-center gap-2.5">
          <Loader2 size={14} className="text-blue-400 animate-spin flex-shrink-0" />
          <p className="text-xs text-blue-300">{merged.statusMsg}</p>
        </div>
      )}

      {merged.anyReady ? (
        <>
          {/* Resumo com os lançamentos já completados pelo registro de sondas
              (fontes que confirmam, uma entrada por sonda). */}
          <SummaryCards data={summaryData} />
          <div className="panel px-4 py-3 mb-6 flex items-center gap-x-5 gap-y-2 flex-wrap text-[11px]">
            <span className="text-dim">Cobertura{multiView ? ` · ${viewStations.length} estações` : ''}</span>
            {wyomingOn
              ? <span className="text-src-wyoming mono">W {sourceCounts(displayLaunches).wyoming}</span>
              : <span className="text-faint" title="Consulta à Wyoming desativada em Configurações">Wyoming desativada</span>}
            <span className="text-src-radiosondy mono">R {sourceCounts(displayLaunches).radiosondy}</span>
            <span className="text-src-sondehub mono">S {sourceCounts(displayLaunches).sondehub}</span>
            <span className="text-gray-300 mono">posições {sourceCounts(displayLaunches).positioned}/{displayLaunches.length}</span>
            {merged.failedMonths.size > 0 && <span className="text-yellow-400">{merged.failedMonths.size} mês(es) aguardando nova tentativa</span>}
            <span className="ml-auto text-faint">
              {merged.lastUpdatedAt ? `cache atualizado ${new Date(merged.lastUpdatedAt).toLocaleString('pt-BR')}` : 'sem cache local'} · ao vivo {merged.sourceHealth.cache === 'ok' ? 'via snapshot' : 'via fontes diretas'}
            </span>
          </div>
          {multiView && (
            <div className="panel px-4 py-3 mb-6 flex items-center gap-x-4 gap-y-2 flex-wrap text-[11px]">
              <span className="text-dim">Por estação</span>
              {viewFeeds.map(f => (
                <button
                  key={f.station.id}
                  onClick={() => changeStation(f.station)}
                  className="flex items-center gap-1.5 text-gray-300 hover:text-white"
                  title={`Abrir só ${f.station.name}`}
                >
                  {stationShortName(f.station)}
                  <span className="mono text-blue-300">{f.displayLaunches.length}</span>
                  {f.syncing && <Loader2 size={10} className="animate-spin text-blue-400" />}
                </button>
              ))}
            </div>
          )}
          <MonthlyChart year={year} byMonth={byMonth} />
          <MonthAccordion
            year={year}
            stations={viewStations}
            stationOf={stationOf}
            canDelete={single}
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
            monthPoints={monthPoints}
            records={records}
            onLaunchPosition={handleLaunchPosition}
            onYearPoints={handleYearPoints}
          />

          {!single ? (
            <p className="text-[11px] text-faint">
              Para apagar um mês ou o ano do cache, abra a aba da estação — na visão &quot;Todas&quot; isso apagaria de todas ao mesmo tempo.
            </p>
          ) : merged.yearLaunches.length > 0 && (
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
