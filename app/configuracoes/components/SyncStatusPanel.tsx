'use client'

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Loader2, Radio, CheckCircle2, Clock, XCircle } from 'lucide-react'
import type { SyncStatus } from '@/app/lib/types'

function formatWhen(ts: number): string {
  const diffMs = Date.now() - ts
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'agora mesmo'
  if (diffMin < 60) return `há ${diffMin} min`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `há ${diffH}h`
  return new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

// Mostra o que aconteceu na última execução do cron radiosondy-sync — os
// "bastidores" da checagem multi-fonte (radiosondy.info / sondehub.org) que
// roda em segundo plano (Vercel Cron, diariamente às 06:00 UTC / 03:00 GMT-3)
// e resolve os lançamentos que a Wyoming já publicou, mas ainda sem posição.
export default function SyncStatusPanel() {
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [configured, setConfigured] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)

  const fetchStatus = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/sync-status')
      if (res.ok) {
        const json = await res.json()
        setConfigured(json.configured !== false)
        setStatus(json.status ?? null)
        setLoaded(true)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchStatus() }, [fetchStatus])

  const runNow = useCallback(async () => {
    setRunning(true)
    try {
      await fetch('/api/radiosondy-sync')
      await fetchStatus()
    } finally {
      setRunning(false)
    }
  }, [fetchStatus])

  const totals = status
    ? Object.values(status.stations).reduce(
        (acc, s) => ({ checked: acc.checked + s.checked, yes: acc.yes + s.yes, no: acc.no + s.no, pending: acc.pending + s.pending }),
        { checked: 0, yes: 0, no: 0, pending: 0 }
      )
    : null

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-gray-300 flex items-center gap-2">
          <Radio size={13} className="text-emerald-400" />
          Sincronização multi-fonte (bastidores)
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={runNow}
            disabled={running || !configured}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-600/20 border border-emerald-500/30 rounded text-xs text-emerald-400 hover:bg-emerald-600/30 transition-all disabled:opacity-50"
            title="Roda agora a checagem de radiosondy.info/sondehub.org para lançamentos sem posição"
          >
            {running ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            Forçar agora
          </button>
          <button
            onClick={fetchStatus}
            disabled={loading}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-surface-2 border border-border rounded text-xs text-gray-400 hover:text-white transition-all disabled:opacity-50"
          >
            {loading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
          </button>
        </div>
      </div>

      <p className="text-[11px] text-faint mb-3">
        Um job (Vercel Cron, diariamente às 06:00 UTC / 03:00 GMT-3) cruza cada
        lançamento já publicado pela Wyoming — mas ainda sem posição — com o
        radiosondy.info (recuperação física) e, se não achar nada, com o
        arquivo do sondehub.org (telemetria RF). Enquanto isso não roda para um
        lançamento específico, ele aparece como <b>aguardando</b> nos badges
        de confiança.
      </p>

      {!loaded ? (
        <p className="text-xs text-dim">Carregando…</p>
      ) : !configured ? (
        <p className="text-xs text-gray-500">R2 não configurado — variáveis de ambiente ausentes (esperado em dev local).</p>
      ) : !status ? (
        <p className="text-xs text-gray-500">Ainda sem nenhuma execução registrada.</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-4 text-xs">
            <div className="flex items-center gap-1.5 text-dim">
              <Clock size={12} />
              Última execução: <span className="text-white mono">{formatWhen(status.lastRunAt)}</span>
            </div>
            <div className="text-dim">
              Duração: <span className="text-white mono">{(status.durationMs / 1000).toFixed(1)}s</span>
            </div>
            <div className="text-dim">Ano: <span className="text-white mono">{status.year}</span></div>
          </div>

          {totals && (
            <div className="flex flex-wrap gap-4 text-xs pt-2 border-t border-border">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 size={12} className="text-green-400" />
                <span className="text-white font-bold mono">{totals.yes}</span>
                <span className="text-dim">confirmados</span>
              </div>
              <div className="flex items-center gap-1.5">
                <XCircle size={12} className="text-red-400" />
                <span className="text-white font-bold mono">{totals.no}</span>
                <span className="text-dim">sem correspondência</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Clock size={12} className="text-yellow-400" />
                <span className="text-white font-bold mono">{totals.pending}</span>
                <span className="text-dim">ainda aguardando</span>
              </div>
            </div>
          )}

          {Object.keys(status.stations).length > 0 ? (
            <div className="space-y-1">
              {Object.entries(status.stations).map(([stationId, s]) => (
                <div key={stationId} className="flex items-center justify-between text-xs px-2.5 py-1.5 bg-bg border border-border rounded">
                  <span className="mono text-gray-300">{stationId}</span>
                  <div className="flex items-center gap-3 mono text-[11px]">
                    <span className="text-green-400">{s.yes} ok</span>
                    <span className="text-red-400">{s.no} sem</span>
                    <span className="text-yellow-400">{s.pending} aguard.</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-500">
              Nenhum lançamento pendente na última execução — tudo que a Wyoming publicou já foi checado.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
