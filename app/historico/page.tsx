'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  History, RefreshCw, ChevronDown, TrendingUp, Calendar,
  AlertCircle, Wind, BarChart3, Trash2, Download, HardDrive, AlertTriangle,
  CheckCircle2, XCircle, Clock, Sun, Moon, Loader2
} from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import {
  readCache, writeCache, clearMonth, clearYear, clearAllCache,
  getCacheStats, exportCache, CacheEntry
} from '@/app/lib/cache'
import LaunchMap from './LaunchMap'

interface Launch {
  date: string
  time_local: string
  time_utc: string
  day: number
  month: number
  year: number
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

export default function HistoricoPage() {
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(currentYear)
  const [data, setData] = useState<YearData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expandedMonth, setExpandedMonth] = useState<number | null>(null)
  const [cacheStats, setCacheStats] = useState<any>(null)
  const [showCachePanel, setShowCachePanel] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'month' | 'year' | 'all'; month?: number; year?: number } | null>(null)
  const [todayData, setTodayData] = useState<TodayData | null>(null)
  const [todayLoading, setTodayLoading] = useState(true)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [failedMonths, setFailedMonths] = useState<Set<number>>(new Set())
  const [selectedLaunch, setSelectedLaunch] = useState<Launch | null>(null)

  const years = Array.from({ length: 5 }, (_, i) => currentYear - i)

  const fetchToday = useCallback(async () => {
    setTodayLoading(true)
    try {
      const res = await fetch('/api/sounding?action=today')
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
        station: '82599',
        launched_today: false,
        count: 0,
        launches: [],
      })
    } finally {
      setTodayLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchToday()
    const interval = setInterval(fetchToday, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [fetchToday])

  const updateCacheStats = useCallback(() => {
    setCacheStats(getCacheStats())
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
        const res = await fetch(`/api/sounding?action=month&year=${y}&month=${m}`)
        if (!res.ok) throw new Error(`Erro ${res.status}`)
        const json = await res.json()
        if (json.error) throw new Error(json.error)

        writeCache({ year: y, month: m, launches: json.launches, timestamp: Date.now(), version: 1 })

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
  }, [updateCacheStats, currentYear])

  const fetchData = useCallback(async (y: number) => {
    setError(null)
    setFailedMonths(new Set())

    const maxMonth = y === currentYear ? new Date().getMonth() + 1 : (y > currentYear ? 0 : 12)

    // Pinta imediatamente o que já existe em cache local, antes de consultar a origem.
    // Descarta meses futuros (ex.: cache antigo de testes anteriores) — eles ainda não existem.
    const cachedMonthsAll = readCache().filter(c => c.year === y)
    const cachedMonths = cachedMonthsAll.filter(c => c.month <= maxMonth)
    for (const stale of cachedMonthsAll) {
      if (stale.month > maxMonth) clearMonth(y, stale.month)
    }
    const launchesFromCache = cachedMonths.flatMap(c => c.launches)
    setData({ year: y, station: '82599', count: launchesFromCache.length, launches: launchesFromCache, errors: [] })

    const cachedSet = new Set(cachedMonths.map(c => c.month))
    let pending: number[] = []
    for (let m = 1; m <= maxMonth; m++) {
      const isCurrentMonth = y === currentYear && m === maxMonth
      // Mês já em cache e não é o mês corrente: não precisa rebuscar
      if (cachedSet.has(m) && !isCurrentMonth) continue
      pending.push(m)
    }

    // Falhas costumam ser bloqueios temporários da origem; tenta de novo
    // rapidamente (8s, 16s) antes de cair no laço periódico de 5 minutos.
    for (let attempt = 0; pending.length > 0 && attempt < 3; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, attempt * 8000))
      pending = await syncMonths(y, pending)
    }
  }, [currentYear, syncMonths])

  useEffect(() => {
    updateCacheStats()
    fetchData(year)
  }, [year, fetchData, updateCacheStats])

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
      clearMonth(deleteConfirm.year || year, deleteConfirm.month)
      setData(prev => prev ? {
        ...prev,
        launches: prev.launches.filter(l => l.month !== deleteConfirm.month),
        count: prev.count - prev.launches.filter(l => l.month === deleteConfirm.month).length,
      } : null)
    } else if (deleteConfirm.type === 'year') {
      clearYear(deleteConfirm.year || year)
      setData(null)
    } else if (deleteConfirm.type === 'all') {
      clearAllCache()
      setData(null)
    }

    updateCacheStats()
    setDeleteConfirm(null)
  }, [deleteConfirm, year, updateCacheStats])

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
            <p className="text-gray-500 text-sm mt-1">Radiossondagens da estação Natal</p>
          </div>
          <div className="flex items-center gap-2">
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
      </div>

      {error && (
        <div className="card p-4 mb-6 border-red-500/20 bg-red-500/5 flex items-start gap-3">
          <AlertCircle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-red-400 font-medium">Erro ao carregar dados</p>
            <p className="text-xs text-gray-500 mt-1">{error}</p>
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
            <button
              onClick={() => setShowCachePanel(false)}
              className="text-gray-500 hover:text-white text-lg"
            >
              ×
            </button>
          </div>

          {cacheStats && (
            <div className="grid gap-3 mb-4 sm:grid-cols-2">
              <div className="text-xs">
                <p className="text-gray-500">Meses em cache</p>
                <p className="text-lg font-bold text-white">{cacheStats.totalMonths}</p>
              </div>
              <div className="text-xs">
                <p className="text-gray-500">Lançamentos totais</p>
                <p className="text-lg font-bold text-white">{cacheStats.totalLaunches}</p>
              </div>
              {cacheStats.years.length > 0 && (
                <div className="text-xs col-span-2">
                  <p className="text-gray-500">Anos em cache</p>
                  <p className="text-sm text-white mono">{cacheStats.years.join(', ')}</p>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleExport}
              className="flex items-center gap-2 px-3 py-1.5 bg-blue-600/20 border border-blue-500/30 rounded text-xs text-blue-400 hover:bg-blue-600/30 transition-all"
            >
              <Download size={12} />
              Exportar JSON
            </button>
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

      {/* Delete confirmation */}
      {deleteConfirm && (
        <div className="card p-4 mb-6 border-yellow-500/20 bg-yellow-500/5 flex items-start gap-3">
          <AlertTriangle size={18} className="text-yellow-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-yellow-400 font-medium">
              {deleteConfirm.type === 'month' ? `Remover ${MONTHS_FULL[deleteConfirm.month! - 1]}/${deleteConfirm.year}?`
                : deleteConfirm.type === 'year' ? `Remover ano ${deleteConfirm.year}?`
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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            <div className={`relative card p-5 border-2 ring-2 ring-blue-500/30 shadow-lg shadow-blue-500/10 bg-blue-500/[0.04] ${
              todayLoading ? 'border-[#2a2a2a]' : todayData?.launched_today ? 'border-green-500/40' : 'border-red-500/25'
            }`}>
              <span className="absolute -top-2 left-3 px-1.5 py-0.5 rounded-full bg-blue-600 text-[9px] font-semibold text-white tracking-wide uppercase">
                Ao vivo
              </span>
              <div className="text-xs text-gray-500 mb-1 flex items-center gap-1.5">
                {todayLoading ? <Clock size={12} /> : todayData?.launched_today
                  ? <CheckCircle2 size={12} className="text-green-400" />
                  : <XCircle size={12} className="text-red-400" />}
                Hoje
              </div>
              {todayLoading ? (
                <div className="text-3xl font-bold text-gray-600 mono">—</div>
              ) : (
                <>
                  <div className="text-3xl font-bold text-white mono">{todayData?.count ?? 0}</div>
                  {todayData?.launched_today ? (
                    <div className="flex flex-wrap gap-x-2 gap-y-1 mt-1">
                      {todayData.launches.map((l, i) => (
                        <button
                          key={i}
                          onClick={() => {
                            setExpandedMonth(l.month)
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
                  ) : (
                    <div className="text-xs text-gray-600 mt-1">Nenhum lançamento</div>
                  )}
                </>
              )}
            </div>
            <div className="card p-5">
              <div className="text-xs text-gray-500 mb-1 flex items-center gap-1.5"><BarChart3 size={12} /> Total de sondagens</div>
              <div className="text-3xl font-bold text-white mono">{data.count}</div>
            </div>
            <div className="card p-5">
              <div className="text-xs text-gray-500 mb-1 flex items-center gap-1.5"><Calendar size={12} /> Dias com lançamento</div>
              <div className="text-3xl font-bold text-white mono">
                {new Set(data.launches.map(l => l.date)).size}
              </div>
            </div>
            <div className="card p-5">
              <div className="text-xs text-gray-500 mb-1 flex items-center gap-1.5"><TrendingUp size={12} /> Média por mês</div>
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
                  tick={{ fill: '#6b7280', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: '#6b7280', fontSize: 11 }}
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
            <div className="px-5 py-4 border-b border-[#2a2a2a]">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <Wind size={15} className="text-blue-400" />
                Detalhe por mês
              </h2>
            </div>
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
                        <div className="w-10 text-xs text-gray-600 mono font-medium">{mon}</div>
                        <div className="flex-1 text-sm text-gray-300">{MONTHS_FULL[idx]}</div>
                        {launches.length > 0 ? (
                          <>
                            <span className="badge badge-info mono text-xs">{launches.length}</span>
                            <span className="text-xs text-gray-600">{days} dia{days !== 1 ? 's' : ''}</span>
                          </>
                        ) : (
                          <span className="text-xs text-gray-700">sem dados</span>
                        )}
                        <ChevronDown
                          size={14}
                          className={`text-gray-600 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                        />
                      </button>
                      {launches.length > 0 && (
                        <button
                          onClick={() => setDeleteConfirm({ type: 'month', month: m, year })}
                          className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-red-500/10 rounded transition-all"
                          title="Deletar mês"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>

                    {isOpen && launches.length > 0 && (
                      <div className="px-5 pb-4 bg-[#111111]">
                        <div className="grid grid-cols-5 gap-3 mt-3">
                          {Object.entries(
                            launches.reduce((acc: Record<string, Launch[]>, l) => {
                              (acc[l.date] ??= []).push(l)
                              return acc
                            }, {})
                          )
                            .sort(([a], [b]) => a.localeCompare(b))
                            .map(([date, dayLaunches]) => (
                              <div key={date} className="p-3 bg-[#1a1a1a] border border-[#2a2a2a] rounded text-xs">
                                <div className="text-gray-500 text-[11px] mb-1.5">
                                  {new Date(date + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'short', day: 'numeric' })}
                                </div>
                                <div className="flex flex-wrap gap-x-2 gap-y-1">
                                  {[...dayLaunches]
                                    .sort((a, b) => a.time_local.localeCompare(b.time_local))
                                    .map((l, i) => (
                                      <button
                                        key={i}
                                        onClick={() => setSelectedLaunch(prev => (sameLaunch(prev, l) ? null : l))}
                                        title="Ver no mapa a posição mais próxima após o lançamento"
                                        className={`mono font-semibold flex items-center gap-1 hover:underline ${
                                          isDaytime(l.time_local) ? 'text-amber-400' : 'text-indigo-400'
                                        }`}
                                      >
                                        {isDaytime(l.time_local) ? <Sun size={10} /> : <Moon size={10} />}
                                        {l.time_local}
                                      </button>
                                    ))}
                                </div>
                              </div>
                            ))}
                        </div>

                        {selectedLaunch && selectedLaunch.month === m && (
                          <LaunchMap launch={selectedLaunch} onClose={() => setSelectedLaunch(null)} />
                        )}
                      </div>
                    )}
                    {isOpen && launches.length === 0 && (
                      <div className="px-5 pb-4 bg-[#111111]">
                        <p className="text-xs text-gray-600 py-2">Nenhum lançamento registrado neste mês.</p>
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
