'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  History, RefreshCw, ChevronDown, TrendingUp, Calendar,
  AlertCircle, Wind, BarChart3, Trash2, Download, HardDrive, AlertTriangle
} from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import {
  readCache, writeCache, clearMonth, clearYear, clearAllCache,
  getCacheStats, exportCache, CacheEntry
} from '@/app/lib/cache'

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

const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const MONTHS_FULL = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

export default function HistoricoPage() {
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(currentYear)
  const [data, setData] = useState<YearData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedMonth, setExpandedMonth] = useState<number | null>(null)
  const [cacheStats, setCacheStats] = useState<any>(null)
  const [showCachePanel, setShowCachePanel] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'month' | 'year' | 'all'; month?: number; year?: number } | null>(null)

  const years = Array.from({ length: 5 }, (_, i) => currentYear - i)

  const updateCacheStats = useCallback(() => {
    setCacheStats(getCacheStats())
  }, [])

  const fetchData = useCallback(async (y: number) => {
    setLoading(true)
    setError(null)
    setData(null)

    try {
      // Tenta ler do cache primeiro
      const cachedMonths = readCache().filter(c => c.year === y)
      const launchesFromCache = cachedMonths.flatMap(c => c.launches)

      // Se tem cache completo, usa
      const maxMonth = y === currentYear ? new Date().getMonth() + 1 : 12
      if (cachedMonths.length >= maxMonth) {
        setData({
          year: y,
          station: '82599',
          count: launchesFromCache.length,
          launches: launchesFromCache,
          errors: [],
        })
        return
      }

      // Caso contrário, faz fetch
      const res = await fetch(`/api/sounding?action=year&year=${y}`)
      if (!res.ok) throw new Error(`Erro ${res.status}`)
      const json = await res.json()
      if (json.error) throw new Error(json.error)

      setData(json)

      // Salva no cache por mês
      const byMonth: Record<number, Launch[]> = {}
      for (const l of json.launches) {
        if (!byMonth[l.month]) byMonth[l.month] = []
        byMonth[l.month].push(l)
      }
      for (const [m, launches] of Object.entries(byMonth)) {
        writeCache({
          year: y,
          month: parseInt(m),
          launches,
          timestamp: Date.now(),
          version: 1,
        })
      }

      updateCacheStats()
    } catch (e: any) {
      setError(e.message || 'Erro ao carregar dados')
    } finally {
      setLoading(false)
    }
  }, [currentYear, updateCacheStats])

  useEffect(() => {
    updateCacheStats()
    fetchData(year)
  }, [year, fetchData, updateCacheStats])

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
            <p className="text-gray-500 text-sm mt-1">Radiossondagens da estação Natal (82599) com cache persistente</p>
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
              disabled={loading}
              className="flex items-center gap-2 px-3 py-2 bg-[#1a1a1a] border border-[#2a2a2a] rounded-md text-sm text-gray-400 hover:text-white hover:border-[#3a3a3a] transition-all"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
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

      {loading && !data ? (
        <div className="card p-10 flex flex-col items-center justify-center gap-3">
          <RefreshCw size={28} className="text-gray-600 animate-spin" />
          <p className="text-gray-500 text-sm">Carregando {year}… isso pode levar alguns segundos</p>
        </div>
      ) : data ? (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
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
            <div className="card p-5 col-span-2 sm:col-span-1">
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
                        <div className="grid grid-cols-3 gap-3 mt-3">
                          {launches.map((l, i) => (
                            <div key={i} className="p-3 bg-[#1a1a1a] border border-[#2a2a2a] rounded text-xs">
                              <div className="text-gray-500 text-[11px] mb-1">
                                {new Date(l.date + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'short', day: 'numeric' })}
                              </div>
                              <div className="mono text-white font-semibold">{l.time_local}</div>
                            </div>
                          ))}
                        </div>
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
