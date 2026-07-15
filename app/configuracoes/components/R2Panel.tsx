'use client'

import { useCallback, useState } from 'react'
import { ChevronDown, Trash2, Loader2, RefreshCw, AlertTriangle, Server, FileJson } from 'lucide-react'
import { formatBytes } from '@/app/lib/launchUtils'

interface R2HistFile {
  key: string
  station: string
  year: number
  sizeBytes: number
  lastModified: string
}

interface R2AnyFile {
  key: string
  sizeBytes: number
  lastModified: string
}

type DeleteTarget =
  | { type: 'history-year';    station: string; year: number }
  | { type: 'history-station'; station: string }
  | { type: 'file';            key: string }
  | { type: 'all' }

function fileBasename(key: string): string {
  return key.split('/').pop() ?? key
}

function fmtDate(iso: string): string {
  return iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'
}

// Descrições amigáveis para arquivos conhecidos
const FILE_DESCRIPTIONS: Record<string, string> = {
  'sondas/sync-status.json': 'Status do último cron de sincronização radiosondy',
}

export default function R2Panel() {
  const [files,       setFiles]       = useState<R2HistFile[]>([])
  const [otherFiles,  setOtherFiles]  = useState<R2AnyFile[]>([])
  const [totalBytes,  setTotalBytes]  = useState(0)
  const [loading,     setLoading]     = useState(false)
  const [loaded,      setLoaded]      = useState(false)
  const [configured,  setConfigured]  = useState(true)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [deleting,    setDeleting]    = useState(false)
  const [expandedSt,  setExpandedSt]  = useState<Set<string>>(new Set())

  const fetchFiles = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/r2-admin')
      if (res.ok) {
        const json = await res.json()
        setConfigured(json.configured !== false)
        setFiles(json.files ?? [])
        setOtherFiles(json.otherFiles ?? [])
        setTotalBytes(json.totalBytes ?? 0)
        setLoaded(true)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const params = new URLSearchParams()
      if (deleteTarget.type === 'all') {
        params.set('all', '1')
      } else if (deleteTarget.type === 'history-year') {
        params.set('station', deleteTarget.station)
        params.set('year', String(deleteTarget.year))
      } else if (deleteTarget.type === 'history-station') {
        params.set('station', deleteTarget.station)
      } else if (deleteTarget.type === 'file') {
        params.set('key', deleteTarget.key)
      }
      await fetch(`/api/r2-admin?${params}`, { method: 'DELETE' })
      setDeleteTarget(null)
      await fetchFiles()
    } finally {
      setDeleting(false)
    }
  }, [deleteTarget, fetchFiles])

  const toggleStation = (st: string) => setExpandedSt(prev => {
    const next = new Set(prev)
    next.has(st) ? next.delete(st) : next.add(st)
    return next
  })

  const totalFiles = files.length + otherFiles.length

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
      {loaded && configured && totalFiles === 0 && (
        <p className="text-xs text-gray-500 mt-2">Nenhum arquivo encontrado no bucket R2.</p>
      )}

      {totalFiles > 0 && (
        <>
          {/* Resumo */}
          <div className="flex flex-wrap gap-4 mb-3 text-xs">
            <span><span className="text-gray-400">Uso total: </span><span className="text-white font-bold mono">{formatBytes(totalBytes)}</span></span>
            <span><span className="text-gray-400">Arquivos: </span><span className="text-white font-bold mono">{totalFiles}</span></span>
          </div>

          {/* ── Histórico de lançamentos ── */}
          {files.length > 0 && (
            <div className="mb-4">
              <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-1.5">Histórico de lançamentos</p>
              <div className="space-y-1">
                {Object.entries(
                  files.reduce<Record<string, R2HistFile[]>>((acc, f) => {
                    ;(acc[f.station] ??= []).push(f)
                    return acc
                  }, {})
                ).map(([st, stFiles]) => (
                  <div key={st} className="border border-border rounded bg-bg">
                    <div className="flex items-center justify-between px-3 py-2">
                      <button
                        className="flex items-center gap-2 text-xs text-gray-300 hover:text-white flex-1 text-left"
                        onClick={() => toggleStation(st)}
                      >
                        <ChevronDown size={12} className={`transition-transform ${expandedSt.has(st) ? 'rotate-180' : ''}`} />
                        <span className="mono font-medium">Estação {st}</span>
                        <span className="text-gray-500">— {stFiles.length} ano{stFiles.length !== 1 ? 's' : ''}</span>
                        <span className="text-gray-600 text-[10px]">
                          {formatBytes(stFiles.reduce((s, f) => s + f.sizeBytes, 0))}
                        </span>
                      </button>
                      <button
                        onClick={() => setDeleteTarget({ type: 'history-station', station: st })}
                        className="text-red-400 hover:text-red-300 ml-2"
                        title="Apagar estação do R2"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                    {expandedSt.has(st) && (
                      <div className="border-t border-border px-3 py-2 space-y-1">
                        {stFiles.map(f => (
                          <div key={f.year} className="flex items-center justify-between text-xs">
                            <span className="mono text-gray-400 w-12">{f.year}</span>
                            <span className="text-gray-500 flex-1">{formatBytes(f.sizeBytes)}</span>
                            <span className="text-gray-600 mr-3 text-[10px]">{fmtDate(f.lastModified)}</span>
                            <button
                              onClick={() => setDeleteTarget({ type: 'history-year', station: st, year: f.year })}
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
            </div>
          )}

          {/* ── Outros arquivos ── */}
          {otherFiles.length > 0 && (
            <div className="mb-4">
              <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-1.5">Outros arquivos</p>
              <div className="space-y-1">
                {otherFiles.map(f => (
                  <div key={f.key} className="border border-border rounded bg-bg px-3 py-2 flex items-center gap-2">
                    <FileJson size={12} className="text-blue-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-300 mono truncate">{fileBasename(f.key)}</p>
                      {FILE_DESCRIPTIONS[f.key] && (
                        <p className="text-[10px] text-gray-600">{FILE_DESCRIPTIONS[f.key]}</p>
                      )}
                    </div>
                    <span className="text-[10px] text-gray-600 flex-shrink-0">{formatBytes(f.sizeBytes)}</span>
                    <span className="text-[10px] text-gray-600 flex-shrink-0 hidden sm:block">{fmtDate(f.lastModified)}</span>
                    <button
                      onClick={() => setDeleteTarget({ type: 'file', key: f.key })}
                      className="text-red-400 hover:text-red-300 flex-shrink-0"
                      title={`Apagar ${f.key}`}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={() => setDeleteTarget({ type: 'all' })}
            className="flex items-center gap-2 px-3 py-1.5 bg-red-600/20 border border-red-500/30 rounded text-xs text-red-400 hover:bg-red-600/30 transition-all"
          >
            <Trash2 size={12} />
            Apagar tudo do R2
          </button>
        </>
      )}

      {/* Confirmação de deleção */}
      {deleteTarget && (
        <div className="mt-3 p-3 border border-yellow-500/30 rounded bg-yellow-500/5 flex items-start gap-3">
          <AlertTriangle size={16} className="text-yellow-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-xs text-yellow-400 font-medium">
              {deleteTarget.type === 'all'
                ? 'Apagar TODOS os arquivos do R2?'
                : deleteTarget.type === 'history-year'
                  ? `Apagar ${deleteTarget.year} da estação ${deleteTarget.station}?`
                  : deleteTarget.type === 'history-station'
                    ? `Apagar todos os anos de ${deleteTarget.station}?`
                    : `Apagar ${fileBasename(deleteTarget.key)}?`}
            </p>
            <p className="text-[11px] text-gray-500 mt-1">Esta ação não pode ser desfeita.</p>
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
                onClick={() => setDeleteTarget(null)}
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
