'use client'

import { useEffect, useState } from 'react'
import { History, AlertTriangle, Loader2, RotateCw } from 'lucide-react'
import { ABNORMAL_RESET_REASONS, RESET_REASON_LABEL } from '@/app/lib/mqtt'
import { PanelTitle } from './Collapsible'

interface BootLogEntry {
  at:          number
  resetReason: number
  wake:        'timer' | 'power-on/reset'
  count?:      number
}

interface BootLogPanelProps {
  receiverKey: string // mesma chave de power/batt-history (receiverKey(mqtt.prefix))
}

const POLL_MS = 30_000

// Painel "Log de reinícios": todo boot reportado pelo firmware (reportBoot em
// conn-report.cpp, uma vez por boot em sleepLoop/awakeReported) vira uma linha
// aqui — não só os anormais (ver ABNORMAL_RESET_REASONS), pra dar visibilidade
// de todo o histórico, incluindo os esperados (ligou na tomada, acordou do
// sono). Fonte de verdade só no R2 (sondas/receivers/{key}/boot-history.json,
// gravado por recordCollected em receiverCollect.ts) — sem cache local, é um
// log raro e append-only, releitura simples é suficiente.
export default function BootLogPanel({ receiverKey }: BootLogPanelProps) {
  const [entries, setEntries] = useState<BootLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = (silent = false) => {
    if (!silent) setLoading(true)
    fetch(`/api/receiver-history?key=${encodeURIComponent(receiverKey)}&type=boot`)
      .then(r => r.json())
      .then(d => { setEntries(Array.isArray(d) ? d : []); setError(false) })
      .catch(() => setError(true))
      .finally(() => { if (!silent) setLoading(false) })
  }

  useEffect(() => {
    load()
    const id = setInterval(() => load(true), POLL_MS)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiverKey])

  const sorted = [...entries].sort((a, b) => b.at - a.at)

  return (
    <div className="panel p-5 mb-6">
      <PanelTitle className="mb-3" icon={<History size={14} className="text-blue-400" />}>
        Log de reinícios
      </PanelTitle>

      <p className="text-xs text-dim mb-3">
        Todo boot do receptor ({receiverKey}), com o motivo do reset reportado pelo firmware
        (<code className="text-[11px]">reportBoot</code>, uma vez por boot). Ligar na tomada e acordar do
        deep sleep são esperados; os outros motivos indicam o receptor caindo sozinho.
      </p>

      {loading ? (
        <p className="text-xs text-dim flex items-center gap-2">
          <Loader2 size={12} className="animate-spin" /> Carregando…
        </p>
      ) : error ? (
        <div className="text-xs text-red-400 flex items-center gap-2">
          <span>Erro ao carregar.</span>
          <button
            onClick={() => load()}
            className="flex items-center gap-1 px-2 py-1 rounded border border-border text-dim hover:text-white transition-colors"
          >
            <RotateCw size={11} /> Tentar de novo
          </button>
        </div>
      ) : sorted.length === 0 ? (
        <p className="text-xs text-faint">Nenhum reinício registrado ainda.</p>
      ) : (
        <ul className="text-xs mono space-y-1 max-h-80 overflow-y-auto pr-1">
          {sorted.map((e, i) => {
            const abnormal = !!ABNORMAL_RESET_REASONS[e.resetReason]
            const label = RESET_REASON_LABEL[e.resetReason] ?? `motivo desconhecido (${e.resetReason})`
            return (
              <li
                key={`${e.at}-${i}`}
                className={`flex items-center gap-2 px-2 py-1.5 rounded border ${
                  abnormal ? 'border-amber-900/50 bg-amber-950/20' : 'border-border'
                }`}
              >
                {abnormal && <AlertTriangle size={11} className="text-amber-400 flex-shrink-0" />}
                <span className="text-dim flex-shrink-0">{new Date(e.at).toLocaleString('pt-BR')}</span>
                <span className={abnormal ? 'text-amber-300' : 'text-white'}>{label}</span>
                <span className="text-faint">· wake: {e.wake}</span>
                {e.count != null && <span className="text-faint ml-auto">boot #{e.count}</span>}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
