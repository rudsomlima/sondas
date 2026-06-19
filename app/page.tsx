'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Radio, CheckCircle2, XCircle, Clock, RefreshCw,
  TrendingUp, Calendar, AlertCircle, Wind
} from 'lucide-react'

interface Launch {
  date: string
  time_local: string
  time_utc: string
  day: number
  month: number
  year: number
}

interface TodayData {
  today: string
  station: string
  launched_today: boolean
  count: number
  launches: Launch[]
  all_this_month: Launch[]
}

function useSettings() {
  if (typeof window === 'undefined') return { stationId: '82599', region: 'naconf' }
  try {
    const s = localStorage.getItem('sondas_settings')
    return s ? JSON.parse(s) : { stationId: '82599', region: 'naconf' }
  } catch { return { stationId: '82599', region: 'naconf' } }
}

export default function HomePage() {
  const [data, setData] = useState<TodayData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/sounding?action=today')
      if (!res.ok) throw new Error(`Erro ${res.status}`)
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      setData(json)
      setLastUpdated(new Date())
    } catch (e: any) {
      setError(e.message || 'Erro ao carregar dados')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 10 * 60 * 1000)
    return () => clearInterval(interval)
  }, [fetchData])

  // Stats for the month
  const monthDays = data?.all_this_month
    ? [...new Set(data.all_this_month.map(l => l.date))].length
    : 0
  const totalLaunches = data?.all_this_month?.length ?? 0

  // Format today's date nicely
  const todayFormatted = data?.today
    ? new Date(data.today + 'T12:00:00').toLocaleDateString('pt-BR', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
      })
    : '—'

  return (
    <div className="p-6 max-w-4xl mx-auto">

      {/* Page header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Radio size={22} className="text-blue-400" />
              Status do Dia
            </h1>
            <p className="text-gray-500 text-sm mt-1 capitalize">{todayFormatted}</p>
          </div>
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 bg-[#1a1a1a] border border-[#2a2a2a] rounded-md text-sm text-gray-400 hover:text-white hover:border-[#3a3a3a] transition-all"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Atualizar
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="card p-4 mb-6 flex items-start gap-3 border-red-500/20 bg-red-500/5">
          <AlertCircle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-red-400 font-medium">Erro ao carregar dados</p>
            <p className="text-xs text-gray-500 mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* Main status card */}
      {loading && !data ? (
        <div className="card p-10 flex flex-col items-center justify-center gap-3">
          <RefreshCw size={28} className="text-gray-600 animate-spin" />
          <p className="text-gray-500 text-sm">Consultando University of Wyoming…</p>
        </div>
      ) : data ? (
        <>
          {/* Status hero */}
          <div className={`card p-6 mb-6 border-2 transition-colors ${
            data.launched_today
              ? 'border-green-500/40 bg-green-500/5'
              : 'border-red-500/30 bg-red-500/5'
          }`}>
            <div className="flex items-center gap-4">
              <div className={`w-16 h-16 rounded-full flex items-center justify-center flex-shrink-0 ${
                data.launched_today ? 'bg-green-500/20' : 'bg-red-500/15'
              }`}>
                {data.launched_today
                  ? <CheckCircle2 size={32} className="text-green-400" />
                  : <XCircle size={32} className="text-red-400" />
                }
              </div>
              <div className="flex-1">
                <div className="text-lg font-semibold text-white">
                  {data.launched_today
                    ? `${data.count} lançamento${data.count > 1 ? 's' : ''} confirmado${data.count > 1 ? 's' : ''}`
                    : 'Nenhum lançamento encontrado'
                  }
                </div>
                <div className="text-sm text-gray-400 mt-0.5">
                  {data.launched_today
                    ? `Radiossondagem realizada hoje na estação ${data.station}`
                    : `Sem dados de radiossondagem para hoje na estação ${data.station}`
                  }
                </div>
                {lastUpdated && (
                  <div className="flex items-center gap-1.5 mt-2 text-xs text-gray-600">
                    <Clock size={11} />
                    Atualizado às {lastUpdated.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} (GMT-3)
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Launches today */}
          {data.launched_today && (
            <div className="card p-5 mb-6">
              <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                <Clock size={15} className="text-blue-400" />
                Horários de hoje
              </h2>
              <div className="grid gap-3">
                {data.launches.map((l, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-4 p-3 bg-[#111111] rounded-md border border-[#2a2a2a]"
                  >
                    <div className="w-2 h-2 bg-green-400 rounded-full flex-shrink-0" />
                    <div className="flex-1">
                      <span className="mono text-white font-medium text-sm">{l.time_local}</span>
                      <span className="text-gray-600 text-xs ml-2">GMT-3</span>
                    </div>
                    <span className="badge badge-info mono">{l.time_utc}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Month summary cards */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="card p-5">
              <div className="flex items-center gap-2 text-gray-500 text-xs mb-2">
                <Calendar size={13} />
                Dias com lançamento no mês
              </div>
              <div className="text-3xl font-bold text-white mono">{monthDays}</div>
            </div>
            <div className="card p-5">
              <div className="flex items-center gap-2 text-gray-500 text-xs mb-2">
                <TrendingUp size={13} />
                Total de sondagens no mês
              </div>
              <div className="text-3xl font-bold text-white mono">{totalLaunches}</div>
            </div>
          </div>

          {/* Recent days this month */}
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
              <Wind size={15} className="text-blue-400" />
              Lançamentos deste mês
            </h2>
            {data.all_this_month.length === 0 ? (
              <p className="text-gray-500 text-sm">Nenhum lançamento encontrado para este mês.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-600 border-b border-[#2a2a2a]">
                      <th className="text-left pb-2 font-medium">Data</th>
                      <th className="text-left pb-2 font-medium">Hora (GMT-3)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.all_this_month.map((l, i) => (
                      <tr
                        key={i}
                        className={`border-b border-[#1f1f1f] ${
                          l.date === data.today ? 'bg-blue-500/5' : ''
                        }`}
                      >
                        <td className="py-2 text-gray-300">
                          {new Date(l.date + 'T12:00:00').toLocaleDateString('pt-BR')}
                          {l.date === data.today && (
                            <span className="ml-2 badge badge-info text-[10px] py-0">hoje</span>
                          )}
                        </td>
                        <td className="py-2 mono text-white font-medium">{l.time_local}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  )
}
