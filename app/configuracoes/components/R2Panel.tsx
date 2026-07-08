'use client'

import { useCallback, useState } from 'react'
import { ChevronDown, Trash2, Loader2, RefreshCw, AlertTriangle, Server } from 'lucide-react'
import { formatBytes } from '@/app/lib/launchUtils'

interface R2File {
  key: string
  station: string
  year: number
  sizeBytes: number
  lastModified: string
}

type R2DeleteConfirm = { station?: string; year?: number; all?: boolean }

// Painel do armazenamento R2 (servidor): lista arquivos por estação/ano,
// tamanho total e exclusões com confirmação.
export default function R2Panel() {
  const [files, setFiles] = useState<R2File[]>([])
  const [totalBytes, setTotalBytes] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [configured, setConfigured] = useState(true)
  const [deleteConfirm, setDeleteConfirm] = useState<R2DeleteConfirm | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [expandedStations, setExpandedStations] = useState<Set<string>>(new Set())

  const fetchFiles = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/r2-admin')
      if (res.ok) {
        const json = await res.json()
        setConfigured(json.configured !== false)
        setFiles(json.files ?? [])
        setTotalBytes(json.totalBytes ?? 0)
        setLoaded(true)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  const handleDelete = useCallback(async () => {
    if (!deleteConfirm) return
    setDeleting(true)
    try {
      const params = new URLSearchParams()
      if (deleteConfirm.all) { params.set('all', '1') }
      else if (deleteConfirm.station && deleteConfirm.year) {
        params.set('station', deleteConfirm.station)
        params.set('year', String(deleteConfirm.year))
      } else if (deleteConfirm.station) {
        params.set('station', deleteConfirm.station)
      }
      await fetch(`/api/r2-admin?${params}`, { method: 'DELETE' })
      setDeleteConfirm(null)
      await fetchFiles()
    } finally {
      setDeleting(false)
    }
  }, [deleteConfirm, fetchFiles])

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-gray-300 flex items-center gap-2">
          <Server size={13} className="text-orange-400" />
          Armazenamento no servidor (R2)
        </h3>
        <button
          onClick={fetchFiles}
          disabled={loading}
          className="flex items-center gap-1.5 px-2.5 py-1 bg-orange-600/20 border border-orange-500/30 rounded text-xs text-orange-400 hover:bg-orange-600/30 transition-all disabled:opacity-50"
        >
          {loading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
          {!loaded && !loading ? 'Carregar' : 'Atualizar'}
        </button>
      </div>

      {loaded && !configured && (
        <p className="text-xs text-gray-500 mt-2">R2 não configurado — variáveis de ambiente ausentes.</p>
      )}

      {loaded && configured && files.length === 0 && (
        <p className="text-xs text-gray-500 mt-2">Nenhum arquivo encontrado no bucket R2.</p>
      )}

      {files.length > 0 && (
        <>
          <div className="flex flex-wrap gap-4 mb-3 text-xs">
            <div>
              <span className="text-gray-400">Uso total: </span>
              <span className="text-white font-bold mono">{formatBytes(totalBytes)}</span>
            </div>
            <div><span className="text-gray-400">Arquivos: </span><span className="text-white font-bold mono">{files.length}</span></div>
          </div>

          <div className="space-y-1 mb-3">
            {Object.entries(
              files.reduce<Record<string, R2File[]>>((acc, f) => {
                ;(acc[f.station] ??= []).push(f)
                return acc
              }, {})
            ).map(([st, stFiles]) => (
              <div key={st} className="border border-border rounded bg-bg">
                <div className="flex items-center justify-between px-3 py-2">
                  <button
                    className="flex items-center gap-2 text-xs text-gray-300 hover:text-white flex-1 text-left"
                    onClick={() => setExpandedStations(prev => {
                      const next = new Set(prev)
                      next.has(st) ? next.delete(st) : next.add(st)
                      return next
                    })}
                  >
                    <ChevronDown size={12} className={`transition-transform ${expandedStations.has(st) ? 'rotate-180' : ''}`} />
                    <span className="mono font-medium">{st}</span>
                    <span className="text-gray-500">— {stFiles.length} ano{stFiles.length !== 1 ? 's' : ''}</span>
                    <span className="text-gray-600 text-[10px]">
                      {(stFiles.reduce((s, f) => s + f.sizeBytes, 0) / 1024).toFixed(0)} KB
                    </span>
                  </button>
                  <button
                    onClick={() => setDeleteConfirm({ station: st })}
                    className="text-red-400 hover:text-red-300 ml-2"
                    title="Apagar estação do R2"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                {expandedStations.has(st) && (
                  <div className="border-t border-border px-3 py-2 space-y-1">
                    {stFiles.map(f => (
                      <div key={f.year} className="flex items-center justify-between text-xs">
                        <span className="mono text-gray-400 w-12">{f.year}</span>
                        <span className="text-gray-500 flex-1">{(f.sizeBytes / 1024).toFixed(0)} KB</span>
                        <span className="text-gray-600 mr-3 text-[10px]">{f.lastModified ? new Date(f.lastModified).toLocaleDateString('pt-BR') : ''}</span>
                        <button
                          onClick={() => setDeleteConfirm({ station: st, year: f.year })}
                          className="text-red-400 hover:text-red-300"
                          title={`Apagar ${f.year} do R2`}
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

          <button
            onClick={() => setDeleteConfirm({ all: true })}
            className="flex items-center gap-2 px-3 py-1.5 bg-red-600/20 border border-red-500/30 rounded text-xs text-red-400 hover:bg-red-600/30 transition-all"
          >
            <Trash2 size={12} />
            Apagar tudo do R2
          </button>
        </>
      )}

      {deleteConfirm && (
        <div className="mt-3 p-3 border border-yellow-500/30 rounded bg-yellow-500/5 flex items-start gap-3">
          <AlertTriangle size={16} className="text-yellow-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-xs text-yellow-400 font-medium">
              {deleteConfirm.all
                ? 'Apagar TODOS os arquivos do R2?'
                : deleteConfirm.year
                  ? `Apagar ${deleteConfirm.year} da estação ${deleteConfirm.station} no R2?`
                  : `Apagar todos os anos de ${deleteConfirm.station} no R2?`}
            </p>
            <p className="text-[11px] text-gray-500 mt-1">Esta ação não pode ser desfeita. O histórico precisará ser re-sincronizado da Wyoming.</p>
            <div className="flex gap-2 mt-2">
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-3 py-1 bg-red-600 text-xs text-white rounded hover:bg-red-700 disabled:opacity-50 transition-all flex items-center gap-1"
              >
                {deleting && <Loader2 size={10} className="animate-spin" />}
                Confirmar
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
