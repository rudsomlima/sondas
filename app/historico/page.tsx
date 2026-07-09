'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { History, RefreshCw, AlertCircle, Loader2, HardDrive, Radio, Trash2 } from 'lucide-react'
import { clearMonth, clearYear } from '@/app/lib/cache'
import { Station, DEFAULT_STATION, getSelectedStation, setSelectedStation } from '@/app/lib/stations'
import type { Launch } from '@/app/lib/types'
import { useYearData } from './hooks/useYearData'
import { useTodayData } from './hooks/useTodayData'
import { useLiveFlights } from './hooks/useLiveFlights'
import StationPicker from './components/StationPicker'
import LiveCard from './components/LiveCard'
import SummaryCards from './components/SummaryCards'
import MonthlyChart from './components/MonthlyChart'
import MonthAccordion from './components/MonthAccordion'

export default function HistoricoPage() {
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(currentYear)
  const [station, setStation] = useState<Station>(DEFAULT_STATION)
  const [showStationPicker, setShowStationPicker] = useState(false)
  const [expandedMonth, setExpandedMonth] = useState<number | null>(null)
  const [selectedLaunch, setSelectedLaunch] = useState<Launch | null>(null)
  const [noMatchLaunches, setNoMatchLaunchesState] = useState<Set<string>>(new Set())
  const [noMatchNotice, setNoMatchNotice] = useState<{ date: string; time_local: string; wyomingUrl: string } | null>(null)
  const [showYearMap, setShowYearMap] = useState(false)
  const [deleteMonthConfirm, setDeleteMonthConfirm] = useState<number | null>(null)
  const [deleteYearConfirm, setDeleteYearConfirm] = useState(false)

  useEffect(() => {
    setStation(getSelectedStation())
  }, [])

  const { data, setData, error, statusMsg, syncing, fetchData, syncMonths } = useYearData(year, station)
  const { todayData, todayLoading, lastFetchAt } = useTodayData(station)
  const { todayFlights, liveFlightChecked } = useLiveFlights(station, todayData?.today)

  const changeStation = useCallback((s: Station) => {
    setStation(s)
    setSelectedStation(s)
    setSelectedLaunch(null)
    setNoMatchLaunchesState(new Set())
    setNoMatchNotice(null)
    setShowStationPicker(false)
  }, [])

  const setNoMatchLaunches = useCallback((updater: (prev: Set<string>) => Set<string>) => {
    setNoMatchLaunchesState(updater)
  }, [])

  const handleConfirmDeleteMonth = useCallback(() => {
    if (deleteMonthConfirm === null) return
    const targetMonth = deleteMonthConfirm
    clearMonth(year, targetMonth, station.id)
    setData(prev => prev ? {
      ...prev,
      launches: prev.launches.filter(l => l.month !== targetMonth),
      count: prev.launches.filter(l => l.month !== targetMonth).length,
    } : null)
    setDeleteMonthConfirm(null)
    syncMonths(year, [targetMonth])
  }, [deleteMonthConfirm, year, station.id, setData, syncMonths])

  const handleConfirmDeleteYear = useCallback(() => {
    clearYear(year, station.id)
    setDeleteYearConfirm(false)
    fetchData(year)
  }, [year, station.id, fetchData])

  const years = Array.from({ length: 5 }, (_, i) => currentYear - i)

  // Agrupa por mês
  const byMonth: Record<number, Launch[]> = {}
  if (data) {
    for (const l of data.launches) {
      (byMonth[l.month] ??= []).push(l)
    }
  }

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
          </div>
        </div>

        {showStationPicker && <StationPicker station={station} onSelect={changeStation} />}
      </div>

      <LiveCard
        todayData={todayData}
        todayLoading={todayLoading}
        todayFlights={todayFlights}
        liveFlightChecked={liveFlightChecked}
        lastFetchAt={lastFetchAt}
        selectedLaunch={selectedLaunch}
        onExpandMonth={m => setExpandedMonth(m)}
        onSelectLaunch={l => { setShowYearMap(false); setSelectedLaunch(l) }}
      />

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
          <MonthlyChart year={year} byMonth={byMonth} />
          <MonthAccordion
            year={year}
            station={station}
            byMonth={byMonth}
            expandedMonth={expandedMonth}
            setExpandedMonth={setExpandedMonth}
            selectedLaunch={selectedLaunch}
            setSelectedLaunch={setSelectedLaunch}
            noMatchLaunches={noMatchLaunches}
            setNoMatchLaunches={setNoMatchLaunches}
            noMatchNotice={noMatchNotice}
            setNoMatchNotice={setNoMatchNotice}
            showYearMap={showYearMap}
            setShowYearMap={setShowYearMap}
            deleteMonthConfirm={deleteMonthConfirm}
            onRequestDeleteMonth={setDeleteMonthConfirm}
            onConfirmDeleteMonth={handleConfirmDeleteMonth}
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
