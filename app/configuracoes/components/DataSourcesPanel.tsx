'use client'

import { useState } from 'react'
import { CheckCircle2, Globe, Loader2, XCircle } from 'lucide-react'
import { setWyomingEnabled, useWyomingSetting } from '@/app/lib/appSettings'

/**
 * Fontes de dados: liga/desliga da consulta à University of Wyoming (ver
 * app/lib/appSettings.ts). Aplica NA HORA em todas as seções abertas (e em
 * outras abas) e vale pra todos os aparelhos — fica salvo no servidor.
 */
export default function DataSourcesPanel() {
  const { enabled: wyomingOn, ready } = useWyomingSetting()
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  async function toggle() {
    const next = !wyomingOn
    setSaving(true)
    setMessage(null)
    try {
      await setWyomingEnabled(next)
      setMessage({ ok: true, text: next ? 'Wyoming ligada em todo o app.' : 'Wyoming desligada em todo o app.' })
    } catch (e: any) {
      setMessage({ ok: false, text: e?.message ?? 'Falha ao salvar.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="panel p-5 mb-6">
      <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-4">
        <Globe size={14} className="text-blue-400" />
        Fontes de dados
      </h2>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-white">University of Wyoming</p>
          <p className="text-[11px] text-faint mt-1 leading-relaxed">
            Arquivo oficial de sondagens: horários sinóticos (00Z/12Z) e confirmação de que o
            lançamento aconteceu. Desligada, o app não consulta mais o site e esconde tudo que veio
            dele (lançamentos, selo <span className="text-src-wyoming font-semibold">W</span>,
            contagens, links) em todas as seções — os lançamentos passam a vir só das sondas
            rastreadas no radiosondy.info e no SondeHub. Vale na hora, em todos os aparelhos.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={wyomingOn}
          aria-label="Consultar a University of Wyoming"
          onClick={toggle}
          // Bloqueado até saber o valor real (senão o 1º clique inverteria o padrão).
          disabled={saving || !ready}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full border transition-colors disabled:opacity-60 ${
            wyomingOn ? 'bg-blue-600 border-blue-500' : 'bg-surface-2 border-border-strong'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
              wyomingOn ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      <div className="mt-3 flex items-center gap-2 text-[11px] min-h-[16px]">
        {saving ? (
          <span className="text-dim flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" /> Salvando…</span>
        ) : message ? (
          <span className={`flex items-center gap-1.5 ${message.ok ? 'text-emerald-400' : 'text-yellow-400'}`}>
            {message.ok ? <CheckCircle2 size={11} /> : <XCircle size={11} />} {message.text}
          </span>
        ) : !ready ? (
          <span className="text-dim flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" /> Lendo a configuração…</span>
        ) : (
          <span className={wyomingOn ? 'text-emerald-400' : 'text-faint'}>
            {wyomingOn ? 'Ligada — consultando a Wyoming.' : 'Desligada — sem consulta à Wyoming.'}
          </span>
        )}
      </div>
    </div>
  )
}
