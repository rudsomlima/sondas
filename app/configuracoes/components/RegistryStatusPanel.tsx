'use client'

import { useCallback, useEffect, useState } from 'react'
import { Antenna, Database, Loader2, Play, RefreshCw } from 'lucide-react'

/**
 * Bastidores do registro de sondas (R2) — substitui o antigo painel do cron
 * radiosondy-sync. Mostra quanto do registro da estação já está completo
 * (receptores, último sinal, 1º dado, dados de voo), o que ainda falta, as
 * estações receptoras conhecidas e o que a última passada do cron fez.
 */

interface RegistryStatus {
  year: number
  registry: {
    total: number; withReceivers: number; withLastSignal: number; withFirstFrame: number
    withFlight: number; complete: number; found: number; lost: number; pending: number; updatedAt: number
  }
  stations: { total: number; active: number; listenersCheckedAt: number }
  lastPoll: {
    lastRunAt: number; durationMs: number
    registry: { seeded: number; checked: string[]; listeners?: number; error?: string } | null
  } | null
}

function fmtWhen(ms: number): string {
  if (!ms) return '—'
  const d = new Date(ms)
  const mins = Math.round((Date.now() - ms) / 60000)
  const ago = mins < 1 ? 'agora' : mins < 60 ? `há ${mins} min` : mins < 48 * 60 ? `há ${Math.round(mins / 60)} h` : `há ${Math.round(mins / 1440)} dias`
  return `${d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · ${ago}`
}

function Stat({ label, value, of, hint }: { label: string; value: number; of?: number; hint?: string }) {
  return (
    <div className="rounded-md border border-border bg-bg px-2.5 py-2" title={hint}>
      <div className="text-[10px] text-faint">{label}</div>
      <div className="text-sm font-mono font-semibold text-white">
        {value.toLocaleString('pt-BR')}
        {of != null && <span className="text-[10px] text-faint font-normal"> / {of.toLocaleString('pt-BR')}</span>}
      </div>
    </div>
  )
}

export default function RegistryStatusPanel({ stationId }: { stationId: string }) {
  const [status, setStatus] = useState<RegistryStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [runMsg, setRunMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/sonde-registry/status?station=${encodeURIComponent(stationId)}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`o servidor respondeu ${res.status}`)
      setStatus(await res.json())
    } catch (e: any) {
      setError(e?.message ?? 'falha ao ler o status')
    } finally {
      setLoading(false)
    }
  }, [stationId])

  useEffect(() => { load() }, [load])

  async function runNow() {
    setRunning(true)
    setRunMsg(null)
    try {
      const res = await fetch('/api/sonde-registry/backfill', { method: 'POST' })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.error ?? `erro ${res.status}`)
      setRunMsg(j.checked?.length
        ? `Consultadas agora: ${j.checked.join(', ')}${j.seeded ? ` · ${j.seeded} novas no registro` : ''}.`
        : 'Nada pendente — o registro já está em dia.')
      await load()
    } catch (e: any) {
      setRunMsg(`Falhou: ${e?.message ?? 'erro'}`)
    } finally {
      setRunning(false)
    }
  }

  const r = status?.registry
  const pct = r && r.total > 0 ? Math.round((r.complete / r.total) * 100) : 0

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <h3 className="text-xs font-semibold text-gray-300 flex items-center gap-2">
          <Database size={13} className="text-emerald-400" />
          Registro de sondas (bastidores)
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={runNow}
            disabled={running}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-600/20 border border-emerald-500/30 rounded text-xs text-emerald-400 hover:bg-emerald-600/30 transition-all disabled:opacity-50"
            title="Consulta agora as fontes (radiosondy.info e SondeHub) pras próximas sondas incompletas"
          >
            {running ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
            Completar agora
          </button>
          <button onClick={load} disabled={loading} className="p-1 text-gray-400 hover:text-white disabled:opacity-50" title="Atualizar">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <p className="text-[11px] text-faint mb-3 leading-relaxed">
        Tudo que o radiosondy.info e o SondeHub dizem de cada sonda (quem recebeu, de quem foi o
        último sinal, 1º dado recebido, altitude de estouro, duração e deriva do voo, recuperação)
        fica guardado aqui e completa os mapas, o histórico e as análises. O cron (a cada poucos
        minutos, pelo /api/poll) completa algumas sondas por vez, mesmo com o app fechado.
      </p>

      {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
      {!status && !error && (
        <p className="text-xs text-dim flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" /> Lendo o registro…</p>
      )}

      {status && r && (
        <>
          <div className="mb-3">
            <div className="flex justify-between text-[11px] mb-1">
              <span className="text-gray-300">Sondas completas em {status.year}</span>
              <span className="mono text-white">{r.complete}/{r.total} · {pct}%</span>
            </div>
            <div className="h-2 rounded bg-surface-2 overflow-hidden">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
            <p className="text-[10px] text-faint mt-1">
              Completa = com receptores, último sinal, 1º dado e dados de voo.
              {r.pending > 0 ? ` ${r.pending} ainda vão ser consultadas.` : ' Nenhuma consulta pendente.'}
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
            <Stat label="Com receptores" value={r.withReceivers} of={r.total} />
            <Stat label="Com último sinal" value={r.withLastSignal} of={r.total} />
            <Stat label="Com 1º dado recebido" value={r.withFirstFrame} of={r.total} />
            <Stat label="Com dados de voo" value={r.withFlight} of={r.total} hint="Altitude de estouro, duração e deriva (usados em Análises)" />
            <Stat label="Recuperadas" value={r.found} />
            <Stat label="Perdidas" value={r.lost} />
          </div>

          <div className="space-y-1 text-[11px]">
            <div className="flex justify-between gap-2">
              <span className="text-dim flex items-center gap-1.5"><Antenna size={11} className="text-teal-400" /> Estações receptoras conhecidas</span>
              <span className="mono text-white">{status.stations.total} <span className="text-faint">({status.stations.active} ativas nas últimas 24 h)</span></span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-dim">Estações ativas atualizadas</span>
              <span className="mono text-gray-300">{fmtWhen(status.stations.listenersCheckedAt)}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-dim">Registro alterado</span>
              <span className="mono text-gray-300">{fmtWhen(r.updatedAt)}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-dim">Última passada do cron</span>
              <span className="mono text-gray-300">
                {status.lastPoll ? `${fmtWhen(status.lastPoll.lastRunAt)} · ${(status.lastPoll.durationMs / 1000).toFixed(0)} s` : '—'}
              </span>
            </div>
            {status.lastPoll?.registry && (
              <div className="flex justify-between gap-2">
                <span className="text-dim">O que ela fez</span>
                <span className="mono text-gray-300 text-right">
                  {status.lastPoll.registry.error
                    ? <span className="text-yellow-400">falhou: {status.lastPoll.registry.error}</span>
                    : `${status.lastPoll.registry.checked.length} consultada(s)` +
                      (status.lastPoll.registry.seeded ? ` · ${status.lastPoll.registry.seeded} nova(s)` : '') +
                      (status.lastPoll.registry.listeners != null ? ` · ${status.lastPoll.registry.listeners} estação(ões) ativas` : '')}
                </span>
              </div>
            )}
          </div>
          {runMsg && <p className="text-[11px] text-gray-300 mt-3">{runMsg}</p>}
        </>
      )}
    </div>
  )
}
