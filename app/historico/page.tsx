'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  History, RefreshCw, ChevronDown, TrendingUp, Calendar,
  AlertCircle, Wind, BarChart3, Trash2, Download, HardDrive, AlertTriangle,
  CheckCircle2, XCircle, Clock, Sun, Moon, Loader2, Map as MapIcon,
  Radio, Search, Check
} from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import {
  getCacheByYear, writeCache, clearMonth, clearYear, clearAllCache, clearStation,
  getCacheStats, getCacheSizeBytes, getCacheStatsByStation, exportCache, importCache,
  StationCacheStats, CacheEntry
} from '@/app/lib/cache'
import {
  fetchTodayFlights, sondeHubUrl, TodayFlight
} from '@/app/lib/radiosondy'
import { fetchSondeHubFlights } from '@/app/lib/sondehub'
import {
  Station, DEFAULT_STATION, getSelectedStation, setSelectedStation,
  getRadiosondyStartplace, searchStations,
} from '@/app/lib/stations'
import LaunchMap from './LaunchMap'
import YearMap from './YearMap'

interface Launch {
  date: string
  time_local: string
  time_utc: string
  day: number
  month: number
  year: number
  // Preenchido pelo sync em segundo plano (app/api/radiosondy-sync) — quando
  // já se sabe que não há correspondência, o badge já aparece marcado sem
  // precisar que o usuário clique primeiro.
  radiosondyMatch?: 'yes' | 'no'
  // Posição final da sonda (radiosondy.info ou sondehub.org), quando já
  // resolvida — ver app/historico/LaunchMap.tsx.
  position?: { lat: number; lon: number; sondeNumber: string; status: string; altitude?: number; course?: string }
  // Estações sem cobertura na Wyoming (Station.wyomingSupported === false):
  // 'radiosondy'/'sondehub' = horário aproximado. Ausente = Wyoming (padrão).
  source?: 'wyoming' | 'radiosondy' | 'sondehub'
  approx?: boolean
}

interface YearData {
  year: number
  station: string
  count: number
  launches: Launch[]
  errors: { month: number; error: string }[]
}

interface TodayData {
  today: string
  station: string
  launched_today: boolean
  count: number
  launches: Launch[]
}

const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const MONTHS_FULL = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

// Lançamentos de 12Z (~09h local) caem de dia; os de 00Z (~21h local) caem de noite
function isDaytime(timeLocal: string): boolean {
  const hour = parseInt(timeLocal.split(':')[0], 10)
  return hour >= 6 && hour < 18
}

// Mesmo lançamento clicado de novo: fecha o mapa em vez de reabrir
function sameLaunch(a: Launch | null, b: Launch): boolean {
  return !!a && a.date === b.date && a.time_utc === b.time_utc
}

function launchKey(l: Launch): string {
  return `${l.date}_${l.time_utc}`
}

// Formata um timestamp "YYYY-MM-DD HH:mm:ssz" (UTC) do radiosondy.info como
// dd-mm-yyyy hh:mm:ss em GMT-3, 24h.
function formatGmt3(utcStr: string): string {
  const iso = utcStr.replace(' ', 'T').replace(/z$/i, '') + 'Z'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return utcStr
  const local = new Date(d.getTime() - 3 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(local.getUTCDate())}-${pad(local.getUTCMonth() + 1)}-${local.getUTCFullYear()} ` +
    `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}`
}

export default function HistoricoPage() {
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(currentYear)
  const [data, setData] = useState<YearData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expandedMonth, setExpandedMonth] = useState<number | null>(null)
  const [cacheStats, setCacheStats] = useState<any>(null)
  const [cacheStatsByStation, setCacheStatsByStation] = useState<StationCacheStats[]>([])
  const [cacheSizeBytes, setCacheSizeBytes] = useState(0)
  const [expandedCacheStations, setExpandedCacheStations] = useState<Set<string>>(new Set())
  const [showCachePanel, setShowCachePanel] = useState(false)
  const [bulkSyncFrom, setBulkSyncFrom] = useState(currentYear - 4)
  const [bulkSyncStatus, setBulkSyncStatus] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'month' | 'year' | 'all' | 'station'; month?: number; year?: number; station?: string } | null>(null)
  const [todayData, setTodayData] = useState<TodayData | null>(null)
  const [todayLoading, setTodayLoading] = useState(true)
  const [todayFlights, setTodayFlights] = useState<TodayFlight[]>([])
  const [liveFlightChecked, setLiveFlightChecked] = useState(false)
  const [lastFetchAt, setLastFetchAt] = useState<Date | null>(null)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [failedMonths, setFailedMonths] = useState<Set<number>>(new Set())
  const [selectedLaunch, setSelectedLaunch] = useState<Launch | null>(null)
  const [noMatchLaunches, setNoMatchLaunches] = useState<Set<string>>(new Set())
  const [noMatchNotice, setNoMatchNotice] = useState<{ date: string; time_local: string; wyomingUrl: string } | null>(null)
  const [showYearMap, setShowYearMap] = useState(false)
  const [station, setStation] = useState<Station>(DEFAULT_STATION)
  const [showStationPicker, setShowStationPicker] = useState(false)
  const [stationQuery, setStationQuery] = useState('')

  useEffect(() => {
    setStation(getSelectedStation())
  }, [])

  const changeStation = useCallback((s: Station) => {
    setStation(s)
    setSelectedStation(s)
    setSelectedLaunch(null)
    setNoMatchLaunches(new Set())
    setNoMatchNotice(null)
    setShowStationPicker(false)
    setStationQuery('')
  }, [])

  const stationResults = useMemo(() => searchStations(stationQuery), [stationQuery])

  const years = Array.from({ length: 5 }, (_, i) => currentYear - i)

  const fetchToday = useCallback(async () => {
    setTodayLoading(true)
    try {
      const res = await fetch(`/api/sounding?action=today&station=${station.id}`)
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      setTodayData(json)
    } catch {
      // Falha ao consultar a origem (instabilidade, 403/500 temporário etc.):
      // trata como "sem lançamento hoje" em vez de mostrar um erro alarmante.
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
    const interval = setInterval(fetchToday, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [fetchToday])

  // Voo dura só ~2h, então o polling do feed ao vivo precisa ser bem mais
  // frequente que o de "houve lançamento hoje" (que muda só 1x/dia). Cobre
  // tanto a sonda ainda em voo quanto a(s) já pousada(s) hoje — a Wyoming
  // atrasa para publicar o lançamento do dia, então não dá pra confiar só em
  // todayData.count/launched_today.
  // Usa as duas fontes que temos, em paralelo: radiosondy.info (só quando a
  // estação tem um "startplace" conhecido) e sondehub.org (funciona por
  // geografia, pra qualquer estação — costuma ter o lançamento de hoje minutos
  // depois de decolar, antes do radiosondy.info ou da Wyoming publicarem).
  const fetchLiveFlight = useCallback(async () => {
    const startplace = getRadiosondyStartplace(station.id)
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const todayStr = todayData?.today ?? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

    const [radiosondyResult, sondeHubResult] = await Promise.allSettled([
      startplace ? fetchTodayFlights(todayStr, startplace) : Promise.resolve([]),
      fetchSondeHubFlights(station.lat, station.lon, todayStr),
    ])

    const bySondeNumber = new Map<string, TodayFlight>()
    for (const result of [radiosondyResult, sondeHubResult]) {
      if (result.status !== 'fulfilled') continue
      for (const f of result.value) {
        const existing = bySondeNumber.get(f.sondeNumber)
        if (!existing || f.lastReportUtc > existing.lastReportUtc) {
          bySondeNumber.set(f.sondeNumber, f)
        }
      }
    }

    // Só substitui o que já está na tela se pelo menos uma fonte respondeu —
    // falha pontual de rede nas duas não deve apagar os últimos dados exibidos.
    if (radiosondyResult.status === 'fulfilled' || sondeHubResult.status === 'fulfilled') {
      setTodayFlights([...bySondeNumber.values()])
    }
    setLiveFlightChecked(true)
  }, [todayData?.today, station.id, station.lat, station.lon])

  useEffect(() => {
    fetchLiveFlight()
    const interval = setInterval(fetchLiveFlight, 20 * 1000)
    return () => clearInterval(interval)
  }, [fetchLiveFlight])

  const updateCacheStats = useCallback(() => {
    setCacheStats(getCacheStats())
    setCacheStatsByStation(getCacheStatsByStation())
    setCacheSizeBytes(getCacheSizeBytes())
  }, [])

  // Busca um mês na API e mescla o resultado nos dados já exibidos,
  // mostrando o que está fazendo enquanto consulta a origem.
  // Retorna os meses que falharam, para quem chamou decidir se tenta de novo.
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
        // O mês corrente é refeito automaticamente em segundo plano (ver useEffect
        // de retry); falhas nele tendem a ser bloqueios temporários da origem, então
        // não exibe o banner de erro alarmante — só meses passados acusam erro visível.
        const isCurrentMonth = y === currentYear && m === new Date().getMonth() + 1
        if (!isCurrentMonth) setError(e.message || 'Erro ao carregar dados')
        setFailedMonths(prev => new Set(prev).add(m))
        failed.push(m)
      }
    }
    setStatusMsg(null)
    setSyncing(false)
    updateCacheStats()
    return failed
  }, [updateCacheStats, currentYear, station.id])

  const fetchData = useCallback(async (y: number) => {
    setError(null)
    setFailedMonths(new Set())

    const maxMonth = y === currentYear ? new Date().getMonth() + 1 : (y > currentYear ? 0 : 12)

    // Pinta imediatamente o que já existe em cache local, antes de consultar a origem.
    // Descarta meses futuros (ex.: cache antigo de testes anteriores) — eles ainda não existem.
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
      // Mês já em cache (mesmo vazio) e não é o mês corrente: não precisa rebuscar
      if (cachedSet.has(m) && !isCurrentMonth) continue
      pending.push(m)
    }

    // Falhas costumam ser bloqueios temporários da origem; tenta de novo
    // rapidamente (8s, 16s) antes de cair no laço periódico de 5 minutos.
    for (let attempt = 0; pending.length > 0 && attempt < 3; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, attempt * 8000))
      pending = await syncMonths(y, pending)
    }
  }, [currentYear, syncMonths, station.id])

  useEffect(() => {
    updateCacheStats()
    fetchData(year)
  }, [year, fetchData, updateCacheStats, station.id])

  // Repete periodicamente a consulta do mês corrente (que pode ganhar
  // lançamentos novos) e de qualquer mês que tenha falhado por instabilidade
  // da origem, até conseguir buscar com sucesso — sempre mostrando o status.
  useEffect(() => {
    const interval = setInterval(() => {
      const months = new Set(failedMonths)
      if (year === currentYear) months.add(new Date().getMonth() + 1)
      if (months.size > 0) syncMonths(year, [...months])
    }, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [year, currentYear, failedMonths, syncMonths])

  // Gerenciar exclusão
  const handleDelete = useCallback(() => {
    if (!deleteConfirm) return

    if (deleteConfirm.type === 'month' && deleteConfirm.month !== undefined) {
      const targetMonth = deleteConfirm.month
      clearMonth(deleteConfirm.year || year, targetMonth, station.id)
      setData(prev => prev ? {
        ...prev,
        launches: prev.launches.filter(l => l.month !== targetMonth),
        count: prev.count - prev.launches.filter(l => l.month === targetMonth).length,
      } : null)
      updateCacheStats()
      setDeleteConfirm(null)
      syncMonths(year, [targetMonth])
      return
    } else if (deleteConfirm.type === 'year') {
      clearYear(deleteConfirm.year || year, deleteConfirm.station || station.id)
    } else if (deleteConfirm.type === 'station' && deleteConfirm.station) {
      clearStation(deleteConfirm.station)
    } else if (deleteConfirm.type === 'all') {
      clearAllCache()
    }

    updateCacheStats()
    setDeleteConfirm(null)
    fetchData(year)
  }, [deleteConfirm, year, updateCacheStats, station.id, fetchData, syncMonths])

  // Exportar cache
  const handleExport = useCallback(() => {
    const json = exportCache()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `sondas_cache_${new Date().toISOString().split('T')[0]}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [])

  // Importar cache de arquivo JSON
  const handleImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const text = ev.target?.result as string
      const result = importCache(text)
      if (result.success) {
        updateCacheStats()
        fetchData(year)
      }
      alert(result.message)
    }
    reader.readAsText(file)
    e.target.value = ''
  }, [updateCacheStats, fetchData, year])

  // Sincroniza sequencialmente todos os anos do intervalo escolhido
  const handleBulkSync = useCallback(async () => {
    const yearsToSync: number[] = []
    for (let y = bulkSyncFrom; y <= currentYear; y++) yearsToSync.push(y)
    for (const y of yearsToSync) {
      setBulkSyncStatus(`Sincronizando ${y}…`)
      try {
        await fetch(`/api/sounding?action=year&station=${station.id}&year=${y}`)
      } catch {
        // ignora falhas pontuais — próximo run retentará
      }
    }
    setBulkSyncStatus(null)
    updateCacheStats()
    fetchData(year)
  }, [bulkSyncFrom, currentYear, station.id, updateCacheStats, fetchData, year])

  // Group launches by month
  const byMonth: Record<number, Launch[]> = {}
  if (data) {
    for (const l of data.launches) {
      if (!byMonth[l.month]) byMonth[l.month] = []
      byMonth[l.month].push(l)
    }
  }

  // Chart data
  const chartData = MONTHS.map((name, idx) => {
    const m = idx + 1
    const launches = byMonth[m] ?? []
    const days = new Set(launches.map(l => l.date)).size
    return { name, lançamentos: launches.length, dias: days }
  })

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload?.length) {
      return (
        <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-md p-3 text-xs">
          <p className="text-white font-medium mb-1">{label}</p>
          {payload.map((p: any, i: number) => (
            <p key={i} style={{ color: p.color }}>
              {p.name}: <span className="font-mono font-bold">{p.value}</span>
            </p>
          ))}
        </div>
      )
    }
    return null
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
              className="flex items-center gap-2 px-3 py-2 bg-[#1a1a1a] border border-[#2a2a2a] rounded-md text-sm text-white hover:border-[#3a3a3a] transition-all max-w-[180px]"
            >
              <Radio size={14} className="text-blue-400 flex-shrink-0" />
              <span className="truncate">{station.name}</span>
            </button>
            <select
              value={year}
              onChange={e => setYear(Number(e.target.value))}
              className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-md text-sm text-white px-3 py-2 outline-none focus:border-blue-500 cursor-pointer"
            >
              {years.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <button
              onClick={() => fetchData(year)}
              disabled={syncing}
              className="flex items-center gap-2 px-3 py-2 bg-[#1a1a1a] border border-[#2a2a2a] rounded-md text-sm text-gray-400 hover:text-white hover:border-[#3a3a3a] transition-all"
            >
              <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={() => setShowCachePanel(!showCachePanel)}
              className="flex items-center gap-2 px-3 py-2 bg-[#1a1a1a] border border-[#2a2a2a] rounded-md text-sm text-gray-400 hover:text-white hover:border-[#3a3a3a] transition-all"
              title="Gerenciar cache"
            >
              <HardDrive size={14} />
            </button>
          </div>
        </div>

        {showStationPicker && (
          <div className="card p-4 mt-3">
            <div className="relative mb-2">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={stationQuery}
                onChange={e => setStationQuery(e.target.value)}
                placeholder="Buscar por nome ou STNM (ex.: Natal, 82599, Buenos Aires)…"
                autoFocus
                className="w-full bg-[#111111] border border-[#2a2a2a] rounded-md pl-9 pr-3 py-2 text-sm text-white outline-none focus:border-blue-500"
              />
            </div>
            <div className="max-h-56 overflow-y-auto border border-[#2a2a2a] rounded-md divide-y divide-[#2a2a2a]">
              {stationResults.length === 0 ? (
                <p className="text-xs text-gray-400 p-3">Nenhuma estação encontrada.</p>
              ) : (
                stationResults.map(s => {
                  const isSelected = s.id === station.id
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => changeStation(s)}
                      className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between gap-2 hover:bg-white/10 transition-colors cursor-pointer ${
                        isSelected ? 'bg-blue-500/15 text-blue-300' : 'text-gray-200'
                      }`}
                    >
                      <span className="flex items-center gap-1.5">
                        {isSelected && <Check size={12} className="text-blue-400 flex-shrink-0" />}
                        {s.name}
                      </span>
                      <span className="mono text-gray-400 flex-shrink-0">{s.id}</span>
                    </button>
                  )
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* Ao vivo: primeira coisa visível, independente do histórico do ano já ter carregado.
          Combina a Wyoming (horário oficial do lançamento) com o radiosondy.info (detecta o
          voo quase em tempo real, antes da Wyoming publicar, e mantém dado mesmo após pousar). */}
      {(() => {
        const hadFlightToday = todayData?.launched_today || todayFlights.length > 0
        const count = Math.max(todayData?.count ?? 0, todayFlights.length)
        const todayMonth = todayData?.today
          ? parseInt(todayData.today.split('-')[1], 10)
          : new Date().getMonth() + 1
        return (
          <div
            onClick={() => setExpandedMonth(todayMonth)}
            title="Ver este mês no histórico"
            className={`relative card p-5 mb-6 border-2 ring-2 ring-blue-500/30 shadow-lg shadow-blue-500/10 bg-blue-500/[0.04] cursor-pointer ${
              todayLoading ? 'border-[#2a2a2a]' : hadFlightToday ? 'border-green-500/40' : 'border-red-500/25'
            }`}
          >
            <span className="absolute -top-2 left-3 px-1.5 py-0.5 rounded-full bg-blue-600 text-[9px] font-semibold text-white tracking-wide uppercase">
              Ao vivo
            </span>
            <div className="text-xs text-gray-400 mb-1 flex items-center gap-1.5">
              {todayLoading ? <Clock size={12} /> : hadFlightToday
                ? <CheckCircle2 size={12} className="text-green-400" />
                : <XCircle size={12} className="text-red-400" />}
              Hoje
            </div>
            {todayLoading ? (
              <div className="text-3xl font-bold text-gray-400 mono">—</div>
            ) : (
              <>
                <div className="text-3xl font-bold text-white mono">{count}</div>
                {todayData?.launched_today ? (
                  <div className="flex flex-wrap gap-x-2 gap-y-1 mt-1">
                    {todayData.launches.map((l, i) => (
                      <button
                        key={i}
                        onClick={e => {
                          e.stopPropagation()
                          setExpandedMonth(l.month)
                          setShowYearMap(false)
                          setSelectedLaunch(prev => (sameLaunch(prev, l) ? null : l))
                        }}
                        title="Ver no mapa a posição mais próxima após o lançamento"
                        className={`text-xs mono font-medium hover:underline flex items-center gap-1 ${
                          isDaytime(l.time_local) ? 'text-amber-400' : 'text-indigo-400'
                        }`}
                      >
                        {isDaytime(l.time_local) ? <Sun size={10} /> : <Moon size={10} />}
                        {l.time_local}
                      </button>
                    ))}
                  </div>
                ) : !hadFlightToday ? (
                  <div className="text-xs text-gray-400 mt-1">Nenhum lançamento</div>
                ) : null}
                {(hadFlightToday || !liveFlightChecked) && (
                  <div className="mt-2 pt-2 border-t border-[#2a2a2a] flex flex-col gap-1.5">
                    {!liveFlightChecked ? (
                      <span className="text-xs text-gray-400 flex items-center gap-1">
                        <Loader2 size={10} className="animate-spin" /> Verificando voo…
                      </span>
                    ) : todayFlights.length > 0 ? (
                      todayFlights.map(f => (
                        <div key={f.sondeNumber} className="flex flex-col">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`text-xs font-semibold flex items-center gap-1 ${
                              f.isLive ? 'text-red-400' : 'text-green-400'
                            }`}>
                              <Wind size={11} />
                              {f.isLive
                                ? (f.climbing >= 0 ? 'Em voo (subindo)' : 'Em voo (descendo)')
                                : 'Pousada'}
                            </span>
                            <span className="text-xs text-emerald-400 mono font-medium">
                              {Math.round(f.altitude).toLocaleString('pt-BR')} m
                            </span>
                            <span className="text-xs text-amber-400 mono font-medium">{f.sondeNumber}</span>
                            <a
                              href={sondeHubUrl(f.sondeNumber, f.lat, f.lon)}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={e => e.stopPropagation()}
                              className="text-xs text-indigo-400 hover:underline"
                            >
                              Ver no SondeHub
                            </a>
                          </div>
                          <span className="text-[11px] text-violet-400/80 mono" title="Último report (GMT-3)">
                            {formatGmt3(f.lastReportUtc)}
                          </span>
                        </div>
                      ))
                    ) : (
                      <span className="text-xs text-gray-400">Sem dados de voo do radiosondy.info ainda</span>
                    )}
                  </div>
                )}
                {lastFetchAt && (
                  <p className="text-[10px] text-gray-400 mt-2">
                    Última busca pelo app: {lastFetchAt.toLocaleTimeString('pt-BR', { hour12: false })}
                  </p>
                )}
              </>
            )}
          </div>
        )
      })()}

      {error && (
        <div className="card p-4 mb-6 border-red-500/20 bg-red-500/5 flex items-start gap-3">
          <AlertCircle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-red-400 font-medium">Erro ao carregar dados</p>
            <p className="text-xs text-gray-400 mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* Cache management panel */}
      {showCachePanel && (
        <div className="card p-5 mb-6 border-blue-500/20 bg-blue-500/5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <HardDrive size={14} className="text-blue-400" />
              Gerenciamento de Cache
            </h2>
            <button onClick={() => setShowCachePanel(false)} className="text-gray-400 hover:text-white text-lg">×</button>
          </div>

          {/* Resumo */}
          {cacheStats && (
            <div className="flex flex-wrap gap-4 mb-4 text-xs">
              <div>
                <span className="text-gray-400">Uso: </span>
                <span className="text-white font-bold mono">
                  {cacheSizeBytes < 1024 * 1024
                    ? `${(cacheSizeBytes / 1024).toFixed(1)} KB`
                    : `${(cacheSizeBytes / 1024 / 1024).toFixed(2)} MB`}
                </span>
                <span className="text-gray-500"> / ~5 MB</span>
              </div>
              <div><span className="text-gray-400">Meses: </span><span className="text-white font-bold mono">{cacheStats.totalMonths}</span></div>
              <div><span className="text-gray-400">Lançamentos: </span><span className="text-white font-bold mono">{cacheStats.totalLaunches}</span></div>
            </div>
          )}

          {/* Tabela por estação */}
          {cacheStatsByStation.length > 0 && (
            <div className="mb-4 space-y-2">
              {cacheStatsByStation.map(st => (
                <div key={st.station} className="border border-[#2a2a2a] rounded bg-[#111]">
                  <div className="flex items-center justify-between px-3 py-2">
                    <button
                      className="flex items-center gap-2 text-xs text-gray-300 hover:text-white flex-1 text-left"
                      onClick={() => setExpandedCacheStations(prev => {
                        const next = new Set(prev)
                        next.has(st.station) ? next.delete(st.station) : next.add(st.station)
                        return next
                      })}
                    >
                      <ChevronDown size={12} className={`transition-transform ${expandedCacheStations.has(st.station) ? 'rotate-180' : ''}`} />
                      <span className="mono font-medium">{st.station}</span>
                      <span className="text-gray-500">— {st.months} meses, {st.launches} lançamentos</span>
                    </button>
                    <button
                      onClick={() => setDeleteConfirm({ type: 'station', station: st.station })}
                      className="text-red-400 hover:text-red-300 ml-2"
                      title="Apagar estação"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                  {expandedCacheStations.has(st.station) && (
                    <div className="border-t border-[#2a2a2a] px-3 py-2 space-y-1">
                      {st.years.map(yr => (
                        <div key={yr.year} className="flex items-center justify-between text-xs">
                          <span className="mono text-gray-400 w-12">{yr.year}</span>
                          <span className="text-gray-500 flex-1">{MONTHS.filter((_, i) => yr.months.includes(i + 1)).join(', ')}</span>
                          <span className="text-gray-500 mr-3">{yr.launches} lançamentos</span>
                          <button
                            onClick={() => setDeleteConfirm({ type: 'year', year: yr.year, station: st.station })}
                            className="text-red-400 hover:text-red-300"
                            title={`Apagar ${yr.year}`}
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Sincronizar intervalo de anos */}
          <div className="mb-4 p-3 bg-[#111] border border-[#2a2a2a] rounded">
            <p className="text-xs text-gray-400 mb-2">Sincronizar histórico com a Wyoming (1 mês por request)</p>
            <div className="flex items-center gap-2 flex-wrap">
              <label className="text-xs text-gray-400">De</label>
              <select
                value={bulkSyncFrom}
                onChange={e => setBulkSyncFrom(Number(e.target.value))}
                className="bg-[#1a1a1a] border border-[#2a2a2a] rounded text-xs text-white px-2 py-1 outline-none focus:border-blue-500"
              >
                {Array.from({ length: 10 }, (_, i) => currentYear - 9 + i).map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
              <label className="text-xs text-gray-400">até {currentYear}</label>
              <button
                onClick={handleBulkSync}
                disabled={!!bulkSyncStatus}
                className="flex items-center gap-1.5 px-3 py-1 bg-blue-600/20 border border-blue-500/30 rounded text-xs text-blue-400 hover:bg-blue-600/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {bulkSyncStatus
                  ? <><Loader2 size={11} className="animate-spin" />{bulkSyncStatus}</>
                  : <><RefreshCw size={11} />Sincronizar</>}
              </button>
            </div>
          </div>

          {/* Ações */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleExport}
              className="flex items-center gap-2 px-3 py-1.5 bg-blue-600/20 border border-blue-500/30 rounded text-xs text-blue-400 hover:bg-blue-600/30 transition-all"
            >
              <Download size={12} />
              Exportar JSON
            </button>
            <label className="flex items-center gap-2 px-3 py-1.5 bg-blue-600/20 border border-blue-500/30 rounded text-xs text-blue-400 hover:bg-blue-600/30 transition-all cursor-pointer">
              <Download size={12} className="rotate-180" />
              Importar JSON
              <input type="file" accept=".json" className="hidden" onChange={handleImport} />
            </label>
            <button
              onClick={() => setDeleteConfirm({ type: 'all' })}
              className="flex items-center gap-2 px-3 py-1.5 bg-red-600/20 border border-red-500/30 rounded text-xs text-red-400 hover:bg-red-600/30 transition-all"
            >
              <Trash2 size={12} />
              Limpar tudo
            </button>
          </div>
        </div>
      )}

      {/* Delete confirmation — exclusão de mês é confirmada inline, na própria linha do mês */}
      {deleteConfirm && deleteConfirm.type !== 'month' && (
        <div className="card p-4 mb-6 border-yellow-500/20 bg-yellow-500/5 flex items-start gap-3">
          <AlertTriangle size={18} className="text-yellow-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-yellow-400 font-medium">
              {deleteConfirm.type === 'year'
                ? `Remover ${deleteConfirm.year}${deleteConfirm.station ? ` (${deleteConfirm.station})` : ''}?`
                : deleteConfirm.type === 'station'
                  ? `Remover todos os dados de ${deleteConfirm.station}?`
                  : 'Remover TODO o cache?'}
            </p>
            <div className="flex gap-2 mt-3">
              <button
                onClick={handleDelete}
                className="px-3 py-1 bg-red-600 text-xs text-white rounded hover:bg-red-700 transition-all"
              >
                Confirmar exclusão
              </button>
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-3 py-1 bg-[#2a2a2a] text-xs text-gray-400 rounded hover:text-white transition-all"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Status da extração em andamento */}
      {statusMsg && (
        <div className="card p-3 mb-6 border-blue-500/20 bg-blue-500/5 flex items-center gap-2.5">
          <Loader2 size={14} className="text-blue-400 animate-spin flex-shrink-0" />
          <p className="text-xs text-blue-300">{statusMsg}</p>
        </div>
      )}

      {data ? (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div className="card p-5">
              <div className="text-xs text-gray-400 mb-1 flex items-center gap-1.5"><BarChart3 size={12} /> Total de sondagens</div>
              <div className="text-3xl font-bold text-white mono">{data.count}</div>
            </div>
            <div className="card p-5">
              <div className="text-xs text-gray-400 mb-1 flex items-center gap-1.5"><Calendar size={12} /> Dias com lançamento</div>
              <div className="text-3xl font-bold text-white mono">
                {new Set(data.launches.map(l => l.date)).size}
              </div>
            </div>
            <div className="card p-5">
              <div className="text-xs text-gray-400 mb-1 flex items-center gap-1.5"><TrendingUp size={12} /> Média por mês</div>
              <div className="text-3xl font-bold text-white mono">
                {data.count > 0 ? (data.count / Object.keys(byMonth).length).toFixed(1) : '0'}
              </div>
            </div>
          </div>

          {/* Chart */}
          <div className="card p-5 mb-6">
            <h2 className="text-sm font-semibold text-white mb-5 flex items-center gap-2">
              <BarChart3 size={15} className="text-blue-400" />
              Lançamentos por mês — {year}
            </h2>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} barGap={4}>
                <XAxis
                  dataKey="name"
                  tick={{ fill: '#9ca3af', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: '#9ca3af', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={28}
                />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                <Bar dataKey="lançamentos" radius={[3, 3, 0, 0]}>
                  {chartData.map((_, i) => (
                    <Cell
                      key={i}
                      fill={chartData[i].lançamentos > 0 ? '#3b82f6' : '#2a2a2a'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Month accordion with delete buttons */}
          <div className="card overflow-hidden mb-6">
            <div className="px-5 py-4 border-b border-[#2a2a2a] flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <Wind size={15} className="text-blue-400" />
                Detalhe por mês
              </h2>
              <button
                onClick={() => {
                  setShowYearMap(prev => !prev)
                  setSelectedLaunch(null)
                }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#1a1a1a] border border-[#2a2a2a] rounded-md text-xs text-green-400 hover:text-white hover:border-[#3a3a3a] transition-all"
                title="Ver no mapa todas as sondas do ano"
              >
                <MapIcon size={13} />
                {showYearMap ? 'Fechar mapa do ano' : 'Ver mapa do ano'}
              </button>
            </div>

            {showYearMap && (
              <div className="px-5 pt-4 bg-[#111111]">
                <YearMap
                  year={year}
                  station={station.id}
                  monthsWithData={Object.keys(byMonth).map(Number)}
                  onClose={() => setShowYearMap(false)}
                />
              </div>
            )}

            <div className="divide-y divide-[#1f1f1f]">
              {MONTHS.map((mon, idx) => {
                const m = idx + 1
                const launches = byMonth[m] ?? []
                const days = new Set(launches.map(l => l.date)).size
                const isOpen = expandedMonth === m

                return (
                  <div key={m}>
                    <div className="flex items-center px-5 py-3 hover:bg-white/[0.02] transition-colors gap-2">
                      <button
                        onClick={() => setExpandedMonth(isOpen ? null : m)}
                        className="flex-1 flex items-center gap-3 text-left"
                      >
                        <div className="w-10 text-xs text-gray-400 mono font-medium">{mon}</div>
                        <div className="flex-1 text-sm text-gray-300">{MONTHS_FULL[idx]}</div>
                        {launches.length > 0 ? (
                          <>
                            <span className="badge badge-info mono text-xs">{launches.length}</span>
                            <span className="text-xs text-gray-400">{days} dia{days !== 1 ? 's' : ''}</span>
                          </>
                        ) : (
                          <span className="text-xs text-gray-400">sem dados</span>
                        )}
                        <ChevronDown
                          size={14}
                          className={`text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                        />
                      </button>
                      {launches.length > 0 && (
                        deleteConfirm?.type === 'month' && deleteConfirm.month === m ? (
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <span className="text-xs text-yellow-400">Remover mês?</span>
                            <button
                              onClick={handleDelete}
                              className="px-2 py-1 bg-red-600 text-xs text-white rounded hover:bg-red-700 transition-all"
                            >
                              Confirmar
                            </button>
                            <button
                              onClick={() => setDeleteConfirm(null)}
                              className="px-2 py-1 bg-[#2a2a2a] text-xs text-gray-400 rounded hover:text-white transition-all"
                            >
                              Cancelar
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setDeleteConfirm({ type: 'month', month: m, year })}
                            className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded transition-all"
                            title="Deletar mês"
                          >
                            <Trash2 size={14} />
                          </button>
                        )
                      )}
                    </div>

                    {isOpen && launches.length > 0 && (
                      <div className="px-5 pb-4 bg-[#111111]">
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mt-3">
                          {Object.entries(
                            launches.reduce((acc: Record<string, Launch[]>, l) => {
                              (acc[l.date] ??= []).push(l)
                              return acc
                            }, {})
                          )
                            .sort(([a], [b]) => a.localeCompare(b))
                            .map(([date, dayLaunches]) => (
                              <div
                                key={date}
                                className={`p-3 bg-[#1a1a1a] border rounded text-xs ${
                                  selectedLaunch?.date === date ? 'border-red-500' : 'border-[#2a2a2a]'
                                }`}
                              >
                                <div className="text-gray-400 text-[11px] mb-1.5">
                                  {new Date(date + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'short', day: 'numeric' })}
                                </div>
                                <div className="flex flex-wrap gap-x-2 gap-y-1">
                                  {[...dayLaunches]
                                    .sort((a, b) => a.time_local.localeCompare(b.time_local))
                                    .map((l, i) => {
                                      const noMatch = l.radiosondyMatch === 'no' || noMatchLaunches.has(launchKey(l))
                                      const sourceLabel = l.source === 'sondehub' ? 'sondehub.org' : 'radiosondy.info'
                                      const title = l.approx
                                        ? station.wyomingSupported === false
                                          ? `Horário aproximado via ${sourceLabel} — Wyoming não cobre esta estação`
                                          : `Horário aproximado via ${sourceLabel} — Wyoming ainda não publicou este lançamento`
                                        : noMatch
                                          ? 'Sem correspondência no radiosondy.info'
                                          : 'Ver no mapa a posição mais próxima após o lançamento'
                                      return (
                                        <button
                                          key={i}
                                          onClick={() => {
                                            if (noMatch && !l.position) {
                                              const pad = (n: number) => String(n).padStart(2, '0')
                                              const hourUtc = l.time_utc.slice(0, 2).padStart(2, '0')
                                              const dt = `${l.year}-${pad(l.month)}-${pad(l.day)} ${hourUtc}:00:00`
                                              setNoMatchNotice({
                                                date: l.date,
                                                time_local: l.time_local,
                                                wyomingUrl: `https://weather.uwyo.edu/wsgi/sounding?src=FM35&datetime=${dt.replace(' ', '%20')}&id=${station.id}&type=TEXT:LIST`,
                                              })
                                              return
                                            }
                                            setNoMatchNotice(null)
                                            setShowYearMap(false)
                                            setSelectedLaunch(prev => (sameLaunch(prev, l) ? null : l))
                                          }}
                                          title={title}
                                          className={`mono font-semibold flex items-center gap-1 hover:underline ${
                                            noMatch ? 'text-gray-400' : isDaytime(l.time_local) ? 'text-amber-400' : 'text-indigo-400'
                                          }`}
                                        >
                                          {isDaytime(l.time_local) ? <Sun size={10} /> : <Moon size={10} />}
                                          {l.approx && '~'}{l.time_local}
                                          <span className={`text-[9px] font-bold leading-none px-0.5 rounded ${
                                            l.source === 'sondehub' ? 'text-violet-400'
                                            : l.source === 'radiosondy' ? 'text-emerald-400'
                                            : 'text-sky-400'
                                          }`} title={
                                            l.source === 'sondehub' ? 'sondehub.org'
                                            : l.source === 'radiosondy' ? 'radiosondy.info'
                                            : 'University of Wyoming'
                                          }>
                                            {l.source === 'sondehub' ? 'S' : l.source === 'radiosondy' ? 'R' : 'W'}
                                          </span>
                                        </button>
                                      )
                                    })}
                                </div>
                              </div>
                            ))}
                        </div>

                        {noMatchNotice && !selectedLaunch && (
                          <div className="mt-3 border border-[#2a2a2a] rounded px-4 py-3 flex items-center gap-3 flex-wrap bg-[#1a1a1a] text-sm text-gray-400">
                            <span>
                              Lançamento {noMatchNotice.date.split('-').reverse().join('/')} às {noMatchNotice.time_local} — sem correspondência no radiosondy.info.
                            </span>
                            <a
                              href={noMatchNotice.wyomingUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sky-400 hover:underline text-xs flex-shrink-0"
                            >
                              Ver sondagem na Wyoming ↗
                            </a>
                            <button
                              onClick={() => setNoMatchNotice(null)}
                              className="ml-auto text-gray-600 hover:text-gray-300 text-xs"
                            >
                              ✕
                            </button>
                          </div>
                        )}

                        {selectedLaunch && selectedLaunch.month === m && (
                          <LaunchMap
                            launch={selectedLaunch}
                            station={station.id}
                            onClose={() => setSelectedLaunch(null)}
                            onResult={found => {
                              setNoMatchLaunches(prev => {
                                const key = launchKey(selectedLaunch)
                                const has = prev.has(key)
                                if (found && has) {
                                  const next = new Set(prev); next.delete(key); return next
                                }
                                if (!found && !has) {
                                  const next = new Set(prev); next.add(key); return next
                                }
                                return prev
                              })
                            }}
                          />
                        )}
                      </div>
                    )}
                    {isOpen && launches.length === 0 && (
                      <div className="px-5 pb-4 bg-[#111111]">
                        <p className="text-xs text-gray-400 py-2">Nenhum lançamento registrado neste mês.</p>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Delete year button */}
          {data.count > 0 && (
            <div className="flex gap-2">
              <button
                onClick={() => setDeleteConfirm({ type: 'year', year })}
                className="flex items-center gap-2 px-4 py-2 bg-red-600/20 border border-red-500/30 rounded-md text-sm text-red-400 hover:bg-red-600/30 transition-all"
              >
                <Trash2 size={14} />
                Deletar ano inteiro
              </button>
            </div>
          )}
        </>
      ) : null}
    </div>
  )
}
