'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, Trash2, Download, Loader2, RefreshCw, AlertTriangle, HardDrive } from 'lucide-react'
import {
  clearMonth, clearYear, clearAllCache, clearStation,
  getCacheStats, getCacheSizeBytes, getCacheStatsByStation, exportCache, importCache,
  StationCacheStats,
} from '@/app/lib/cache'
import { MONTHS, formatBytes } from '@/app/lib/launchUtils'

interface LocalCachePanelProps {
  stationId: string
  // Chamado após qualquer mutação de cache para o dono re-buscar dados.
  onMutate?: () => void
}

type DeleteConfirm = { type: 'month' | 'year' | 'all' | 'station'; month?: number; year?: number; station?: string }

// Painel do cache localStorage: resumo, tabela por estação/ano, sync em massa,
// export/import JSON e exclusões.
export default function LocalCachePanel({ stationId, onMutate }: LocalCachePanelProps) {
  const currentYear = new Date().getFullYear()
  const [cacheStats, setCacheStats] = useState<any>(null)
  const [cacheStatsByStation, setCacheStatsByStation] = useState<StationCacheStats[]>([])
  const [cacheSizeBytes, setCacheSizeBytes] = useState(0)
  const [expandedStations, setExpandedStations] = useState<Set<string>>(new Set())
  const [bulkSyncFrom, setBulkSyncFrom] = useState(currentYear - 4)
  const [bulkSyncStatus, setBulkSyncStatus] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirm | null>(null)

  const refresh = useCallback(() => {
    setCacheStats(getCacheStats())
    setCacheStatsByStation(getCacheStatsByStation())
    setCacheSizeBytes(getCacheSizeBytes())
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const handleDelete = useCallback(() => {
    if (!deleteConfirm) return
    if (deleteConfirm.type === 'month' && deleteConfirm.month !== undefined) {
      clearMonth(deleteConfirm.year ?? currentYear, deleteConfirm.month, deleteConfirm.station ?? stationId)
    } else if (deleteConfirm.type === 'year') {
      clearYear(deleteConfirm.year ?? currentYear, deleteConfirm.station ?? stationId)
    } else if (deleteConfirm.type === 'station' && deleteConfirm.station) {
      clearStation(deleteConfirm.station)
    } else if (deleteConfirm.type === 'all') {
      clearAllCache()
    }
    setDeleteConfirm(null)
    refresh()
    onMutate?.()
  }, [deleteConfirm, currentYear, stationId, refresh, onMutate])

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

  const handleImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const text = ev.target?.result as string
      const result = importCache(text)
      if (result.success) {
        refresh()
        onMutate?.()
      }
      alert(result.message)
    }
    reader.readAsText(file)
    e.target.value = ''
  }, [refresh, onMutate])

  const handleBulkSync = useCallback(async () => {
    for (let y = bulkSyncFrom; y <= currentYear; y++) {
      setBulkSyncStatus(`Sincronizando ${y}…`)
      try {
        await fetch(`/api/sounding?action=year&station=${stationId}&year=${y}`)
      } catch {
        // falha pontual — próximo run retentará
      }
    }
    setBulkSyncStatus(null)
    refresh()
    onMutate?.()
  }, [bulkSyncFrom, currentYear, stationId, refresh, onMutate])

  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-300 flex items-center gap-2 mb-3">
        <HardDrive size={13} className="text-blue-400" />
        Cache do navegador (localStorage)
      </h3>

      {cacheStats && (
        <div className="flex flex-wrap gap-4 mb-4 text-xs">
          <div>
            <span className="text-gray-400">Uso: </span>
            <span className="text-white font-bold mono">{formatBytes(cacheSizeBytes)}</span>
            <span className="text-gray-500"> / ~5 MB</span>
          </div>
          <div><span className="text-gray-400">Meses: </span><span className="text-white font-bold mono">{cacheStats.totalMonths}</span></div>
          <div><span className="text-gray-400">Lançamentos: </span><span className="text-white font-bold mono">{cacheStats.totalLaunches}</span></div>
        </div>
      )}

      {cacheStatsByStation.length > 0 && (
        <div className="mb-4 space-y-2">
          {cacheStatsByStation.map(st => (
            <div key={st.station} className="border border-border rounded bg-bg">
              <div className="flex items-center justify-between px-3 py-2">
                <button
                  className="flex items-center gap-2 text-xs text-gray-300 hover:text-white flex-1 text-left"
                  onClick={() => setExpandedStations(prev => {
                    const next = new Set(prev)
                    next.has(st.station) ? next.delete(st.station) : next.add(st.station)
                    return next
                  })}
                >
                  <ChevronDown size={12} className={`transition-transform ${expandedStations.has(st.station) ? 'rotate-180' : ''}`} />
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
              {expandedStations.has(st.station) && (
                <div className="border-t border-border px-3 py-2 space-y-1">
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

      <div className="mb-4 p-3 bg-bg border border-border rounded">
        <p className="text-xs text-gray-400 mb-2">Sincronizar histórico com a Wyoming (1 mês por request)</p>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-xs text-gray-400">De</label>
          <select
            value={bulkSyncFrom}
            onChange={e => setBulkSyncFrom(Number(e.target.value))}
            className="bg-surface border border-border rounded text-xs text-white px-2 py-1 outline-none focus:border-blue-500"
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

      {deleteConfirm && (
        <div className="mt-3 p-3 border border-yellow-500/30 rounded bg-yellow-500/5 flex items-start gap-3">
          <AlertTriangle size={16} className="text-yellow-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-xs text-yellow-400 font-medium">
              {deleteConfirm.type === 'year'
                ? `Remover ${deleteConfirm.year}${deleteConfirm.station ? ` (${deleteConfirm.station})` : ''}?`
                : deleteConfirm.type === 'station'
                  ? `Remover todos os dados de ${deleteConfirm.station}?`
                  : deleteConfirm.type === 'month'
                    ? `Remover mês ${deleteConfirm.month}/${deleteConfirm.year}?`
                    : 'Remover TODO o cache?'}
            </p>
            <div className="flex gap-2 mt-2">
              <button
                onClick={handleDelete}
                className="px-3 py-1 bg-red-600 text-xs text-white rounded hover:bg-red-700 transition-all"
              >
                Confirmar exclusão
              </button>
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-3 py-1 bg-surface-2 text-xs text-gray-400 rounded hover:text-white transition-all"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
