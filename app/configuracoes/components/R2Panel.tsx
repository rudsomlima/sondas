'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, Trash2, Loader2, RefreshCw, AlertTriangle, Server, FileJson, Radio } from 'lucide-react'
import { formatBytes } from '@/app/lib/launchUtils'
import { getSettings } from '@/app/lib/settings'

interface R2HistFile {
  key: string
  station: string
  year: number
  sizeBytes: number
  lastModified: string
}

interface R2ReceiverFile {
  key:          string
  receiverKey:  string
  type:         'power' | 'batt'
  sizeBytes:    number
  lastModified: string
}

interface R2AnyFile {
  key: string
  sizeBytes: number
  lastModified: string
}

interface R2Metrics {
  configured: boolean
  missing?: string[]
  error?: string
  period?: { start: string; end: string }
  operations?: { classA: number; classB: number; unclassified: number }
  bandwidth?: { uploadBytes: number; downloadBytes: number }
  storage?: { bytes: number; objects: number }
  estimate?: { classA: number; classB: number; total: number }
  buckets?: Array<{
    name: string; classA: number; classB: number; unclassified: number
    uploadBytes: number; downloadBytes: number; storageBytes: number; objects: number
  }>
}

type DeleteTarget =
  | { type: 'history-year';    station: string; year: number }
  | { type: 'history-station'; station: string }
  | { type: 'receiver';        receiverKey: string }
  | { type: 'file';            key: string }
  | { type: 'all' }

function fileBasename(key: string): string {
  return key.split('/').pop() ?? key
}

function fmtDate(iso: string): string {
  return iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'
}

function fmtUsd(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD' }).format(value)
}

function fmtNumber(value: number): string {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(value)
}

function MetricCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded border border-border bg-surface px-2.5 py-2 min-w-0">
      <p className="text-[10px] text-gray-500 truncate">{label}</p>
      <p className="text-sm font-semibold text-white mono truncate mt-0.5">{value}</p>
      <p className="text-[9px] text-gray-600 truncate mt-0.5">{hint}</p>
    </div>
  )
}

const FILE_DESCRIPTIONS: Record<string, string> = {
  'sondas/sync-status.json': 'Status do antigo cron radiosondy-sync (removido — pode apagar)',
}

const TYPE_LABELS: Record<'power' | 'batt', string> = {
  power: 'Power/sleep history',
  batt:  'Bateria history',
}

export default function R2Panel() {
  const [files,          setFiles]          = useState<R2HistFile[]>([])
  const [receiverFiles,  setReceiverFiles]  = useState<R2ReceiverFile[]>([])
  const [otherFiles,     setOtherFiles]     = useState<R2AnyFile[]>([])
  const [totalBytes,     setTotalBytes]     = useState(0)
  const [loading,        setLoading]        = useState(false)
  const [loaded,         setLoaded]         = useState(false)
  const [configured,     setConfigured]     = useState(true)
  const [deleteTarget,   setDeleteTarget]   = useState<DeleteTarget | null>(null)
  const [deleting,       setDeleting]       = useState(false)
  const [expandedSt,     setExpandedSt]     = useState<Set<string>>(new Set())
  const [metrics,        setMetrics]        = useState<R2Metrics | null>(null)
  const [metricsError,   setMetricsError]   = useState<string | null>(null)
  const [metricsLoading, setMetricsLoading] = useState(false)

  // Nomes amigáveis dos receptores (de knownReceivers no settings)
  const [receiverNames, setReceiverNames] = useState<Record<string, string>>({})
  useEffect(() => {
    const s = getSettings()
    const names: Record<string, string> = {}
    for (const kr of s.knownReceivers) {
      // Importa a função de chave de forma inline para não criar dep circular
      const k = kr.prefix.trim().replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '') || 'default'
      names[k] = kr.displayName
    }
    setReceiverNames(names)
  }, [])

  const fetchMetrics = useCallback(async () => {
    setMetricsLoading(true)
    try {
      const res = await fetch('/api/r2-metrics', { cache: 'no-store' })
      const json = await res.json()
      setMetrics(json)
      setMetricsError(res.ok ? null : json.error ?? 'Falha ao carregar métricas do Cloudflare.')
    } catch {
      setMetricsError('Falha de conexão ao carregar o uso do R2.')
    } finally {
      setMetricsLoading(false)
    }
  }, [])

  useEffect(() => { void fetchMetrics() }, [fetchMetrics])

  const fetchFiles = useCallback(async () => {
    setLoading(true)
    try {
      const filesRes = await fetch('/api/r2-admin')
      const json = await filesRes.json()
      if (filesRes.ok) {
        setConfigured(json.configured !== false)
        setFiles(json.files ?? [])
        setReceiverFiles(json.receiverFiles ?? [])
        setOtherFiles(json.otherFiles ?? [])
        setTotalBytes(json.totalBytes ?? 0)
        setLoaded(true)
      }
      await fetchMetrics()
    } catch {
      setMetricsError('Falha de conexão ao carregar os arquivos do R2.')
    } finally {
      setLoading(false)
    }
  }, [fetchMetrics])

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
      } else if (deleteTarget.type === 'receiver') {
        params.set('receiver', deleteTarget.receiverKey)
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

  // Agrupa arquivos de receptor por receiverKey
  const receiverGroups = receiverFiles.reduce<Record<string, R2ReceiverFile[]>>((acc, f) => {
    ;(acc[f.receiverKey] ??= []).push(f)
    return acc
  }, {})

  const totalFiles = files.length + receiverFiles.length + otherFiles.length

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

      <section className="mt-4 rounded border border-border bg-bg p-3">
        <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
          <div>
            <h4 className="text-xs font-semibold text-gray-200">Tráfego e cobrança do R2</h4>
            <p className="text-[10px] text-gray-500 mt-0.5">Uso da conta Cloudflare no ciclo atual, atualizado ao carregar.</p>
          </div>
          {metrics?.period && (
            <span className="text-[10px] text-gray-500">
              {new Date(metrics.period.start).toLocaleDateString('pt-BR', { timeZone: 'UTC' })} até agora (UTC)
            </span>
          )}
        </div>

        {metricsError && <p className="text-xs text-red-300">{metricsError}</p>}
        {metricsLoading && !metrics && <p className="text-xs text-gray-500">Consultando métricas do Cloudflare…</p>}
        {metrics && !metrics.configured && (
          <div className="text-xs text-gray-400 space-y-1">
            <p>Para consultar os dados reais, configure no servidor <code>CLOUDFLARE_API_TOKEN</code> com permissão somente de leitura <b>Account Analytics: Read</b>.</p>
            <p>O token fica apenas no servidor. O ID da conta já vem de <code>R2_ACCOUNT_ID</code>.</p>
            <a className="text-blue-400 hover:underline" href="https://developers.cloudflare.com/analytics/graphql-api/getting-started/authentication/api-token-auth/" target="_blank" rel="noreferrer">Como criar o token de Analytics</a>
          </div>
        )}
        {metrics?.configured && !metricsError && metrics.operations && metrics.bandwidth && metrics.storage && metrics.estimate && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
              <MetricCard label="Classe A" value={fmtNumber(metrics.operations.classA)} hint="franquia 1 milhão" />
              <MetricCard label="Classe B" value={fmtNumber(metrics.operations.classB)} hint="franquia 10 milhões" />
              <MetricCard label="Enviado / recebido" value={`${formatBytes(metrics.bandwidth.uploadBytes)} / ${formatBytes(metrics.bandwidth.downloadBytes)}`} hint="transferência no ciclo" />
              <MetricCard label="Armazenamento atual" value={formatBytes(metrics.storage.bytes)} hint={`${fmtNumber(metrics.storage.objects)} objetos`} />
              <MetricCard label="Estimativa de operações" value={fmtUsd(metrics.estimate.total)} hint={`A ${fmtUsd(metrics.estimate.classA)} · B ${fmtUsd(metrics.estimate.classB)}`} />
            </div>
            <p className="text-[10px] text-gray-500 mt-2">
              Estimativa das operações Standard após as franquias grátis, arredondada por milhão; armazenamento e acesso infrequente não estão incluídos. Confira a <a className="text-blue-400 hover:underline" href="https://developers.cloudflare.com/r2/pricing/" target="_blank" rel="noreferrer">tarifa oficial</a>; a fatura pode variar.
              {metrics.operations.unclassified > 0 && ` ${fmtNumber(metrics.operations.unclassified)} operações sem classificação foram excluídas da estimativa.`}
            </p>
            {!!metrics.buckets?.length && (
              <div className="mt-3 border-t border-border pt-2">
                <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">Por bucket</p>
                <div className="space-y-1">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-x-3 text-[9px] text-gray-600 uppercase">
                    <span>Bucket</span><span>Classe A</span><span>Classe B</span><span>Armazenado</span>
                  </div>
                  {metrics.buckets.map(bucket => (
                    <div key={bucket.name} className="border-t border-border/50 py-1">
                      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-x-3 text-[10px] text-gray-400">
                        <span className="truncate text-gray-300">{bucket.name}</span>
                        <span>{fmtNumber(bucket.classA)}</span>
                        <span>{fmtNumber(bucket.classB)}</span>
                        <span>{formatBytes(bucket.storageBytes)}</span>
                      </div>
                      <p className="text-[9px] text-gray-600 mt-0.5">
                        Enviado {formatBytes(bucket.uploadBytes)} · recebido {formatBytes(bucket.downloadBytes)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {totalFiles > 0 && (
        <>
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

          {/* ── Histórico de receptores ── */}
          {Object.keys(receiverGroups).length > 0 && (
            <div className="mb-4">
              <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-1.5">Histórico de receptores</p>
              <div className="space-y-1">
                {Object.entries(receiverGroups).map(([rKey, rFiles]) => {
                  const displayName = receiverNames[rKey] || rKey
                  const totalSize = rFiles.reduce((s, f) => s + f.sizeBytes, 0)
                  const lastMod = rFiles.map(f => f.lastModified).sort().pop() ?? ''
                  return (
                    <div key={rKey} className="border border-border rounded bg-bg px-3 py-2 flex items-center gap-2">
                      <Radio size={12} className="text-cyan-400 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-gray-300 font-medium">{displayName}</p>
                        <div className="flex flex-wrap gap-3 mt-0.5">
                          {rFiles.map(f => (
                            <span key={f.type} className="text-[10px] text-gray-600">
                              {TYPE_LABELS[f.type]}: {formatBytes(f.sizeBytes)}
                            </span>
                          ))}
                        </div>
                        <p className="text-[9px] text-gray-700 mono mt-0.5">{rKey}</p>
                      </div>
                      <span className="text-[10px] text-gray-600 flex-shrink-0">{formatBytes(totalSize)}</span>
                      <span className="text-[10px] text-gray-600 flex-shrink-0 hidden sm:block">{fmtDate(lastMod)}</span>
                      <button
                        onClick={() => setDeleteTarget({ type: 'receiver', receiverKey: rKey })}
                        className="text-red-400 hover:text-red-300 flex-shrink-0"
                        title={`Apagar histórico de ${displayName}`}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  )
                })}
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
                    : deleteTarget.type === 'receiver'
                      ? `Apagar todo o histórico de ${receiverNames[deleteTarget.receiverKey] || deleteTarget.receiverKey}?`
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
