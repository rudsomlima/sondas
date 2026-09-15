'use client'

import { useCallback, useEffect, useState } from 'react'
import { Zap, Loader2, XCircle } from 'lucide-react'
import { getSettings } from '@/app/lib/settings'
import { computeCfgAuth, randomReqId } from '@/app/lib/cfgAuth'
import { formatGmt3 } from '@/app/lib/launchUtils'
import type { RdzPower } from '@/app/lib/mqtt'

interface BoostInfo {
  manualUntilEpoch: number
  manualRequestedAt: number | null
  autoEnabled: boolean
  autoRadiusKm: number
  autoHasPosition: boolean
  autoSonde: { serial: string; distanceKm: number; alt: number; lastFrameAt: number } | null
  autoUntilEpoch: number
}

interface PowerBoostPanelProps {
  power: RdzPower | null // estado reportado pelo receptor (o que ele de fato aplicou)
  reportMin: number | null // power.report_min — quanto pode demorar pra buscar no Silencioso/Pulsado
}

const POLL_MS = 30_000
const DURATIONS_MIN = [30, 60, 180]

const hhmm = (epochS: number) => formatGmt3(new Date(epochS * 1000).toISOString()).slice(11, 16)

/**
 * Turbo remoto: pede ao receptor pra ficar em Pleno por um tempo, ignorando o
 * nível do período (ver app/api/receiver-power/boost e checkPowerBoost no
 * firmware). O pedido é assinado com o mesmo segredo da config remota; o
 * receptor busca junto com a config pendente, então no Silencioso/Pulsado
 * pode levar até power.report_min pra pegar.
 */
export default function PowerBoostPanel({ power, reportMin }: PowerBoostPanelProps) {
  const [info, setInfo] = useState<BoostInfo | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nowS, setNowS] = useState(() => Math.floor(Date.now() / 1000))

  const refresh = useCallback(() => {
    const prefix = getSettings().mqttTopicPrefix
    if (!prefix) return
    fetch(`/api/receiver-power/boost?prefix=${encodeURIComponent(prefix)}`)
      .then(r => r.json())
      .then((d: { info?: BoostInfo }) => { if (d.info) setInfo(d.info) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    refresh()
    const id = setInterval(() => { refresh(); setNowS(Math.floor(Date.now() / 1000)) }, POLL_MS)
    return () => clearInterval(id)
  }, [refresh])

  const send = async (until: number) => {
    const s = getSettings()
    if (!s.rdzConfigSecret.trim()) {
      setError('Defina o segredo de gravação (mqtt.cfgsecret) em Meu Receptor antes de usar o turbo.')
      return
    }
    setSending(true)
    setError(null)
    try {
      const reqId = randomReqId()
      const auth = await computeCfgAuth(s.rdzConfigSecret, reqId, String(until))
      const res = await fetch('/api/receiver-power/boost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix: s.mqttTopicPrefix, reqId, auth, until }),
      })
      const d: { ok: boolean; error?: string } = await res.json()
      if (!d.ok) throw new Error(d.error ?? 'Falha ao enviar o turbo')
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao enviar o turbo')
    } finally {
      setSending(false)
    }
  }

  const appliedUntil = power?.boostUntil && power.boostUntil > nowS ? power.boostUntil : 0
  const requestedUntil = info && info.manualUntilEpoch > nowS ? info.manualUntilEpoch : 0
  const waitingPickup = requestedUntil > 0 && !(appliedUntil > 0 && power?.boost === 'manual')

  return (
    <div className="panel p-5 mb-6">
      <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-1">
        <Zap size={14} className="text-amber-400" /> Turbo
      </h2>
      <p className="text-[11px] text-faint mb-3">
        Deixa o receptor em Pleno por um tempo, independente do horário — útil quando você sabe que tem sonda subindo.
        {reportMin ? ` No Silencioso/Pulsado ele pode levar até ${reportMin} min pra receber o pedido.` : ''}
        {' '}No Sono profundo só recebe ao acordar.
      </p>

      {appliedUntil > 0 ? (
        <p className="text-xs text-amber-300 mb-3">
          ⚡ Turbo {power?.boost === 'auto' ? 'automático' : 'manual'} ativo até {hhmm(appliedUntil)}
        </p>
      ) : waitingPickup ? (
        <p className="text-xs text-amber-400/80 mb-3 flex items-center gap-1.5">
          <Loader2 size={11} className="animate-spin" /> Pedido até {hhmm(requestedUntil)} — aguardando o receptor buscar
        </p>
      ) : (
        <p className="text-xs text-gray-400 mb-3">Nenhum turbo ativo.</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {DURATIONS_MIN.map(min => (
          <button
            key={min}
            type="button"
            disabled={sending}
            onClick={() => send(Math.floor(Date.now() / 1000) + min * 60)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600/20 border border-amber-500/40 rounded-md text-xs text-amber-200 hover:bg-amber-600/30 disabled:opacity-50"
          >
            <Zap size={11} /> {min < 60 ? `${min} min` : `${min / 60} h`}
          </button>
        ))}
        {(requestedUntil > 0 || appliedUntil > 0) && (
          <button
            type="button"
            disabled={sending}
            onClick={() => send(0)}
            className="px-3 py-1.5 bg-surface border border-border rounded-md text-xs text-gray-300 hover:text-white disabled:opacity-50"
          >
            Cancelar
          </button>
        )}
        {sending && <Loader2 size={12} className="animate-spin text-gray-400" />}
      </div>

      {info && (
        <p className="text-[11px] text-faint mt-3">
          Automático:{' '}
          {!info.autoEnabled ? 'desligado (ative na seção Energia da configuração).'
            : !info.autoHasPosition ? 'ligado, mas o receptor não tem posição fixa (rxlat/rxlon) — não dá pra medir distância.'
            : info.autoSonde
              ? <span className="text-amber-300">sonda {info.autoSonde.serial} no ar a {info.autoSonde.distanceKm} km ({info.autoSonde.alt} m) — turbo até {hhmm(info.autoUntilEpoch)}.</span>
              : `ligado, nenhuma sonda no ar a até ${info.autoRadiusKm} km agora.`}
          {info.autoEnabled && ' Cancelar derruba o turbo, mas ele volta se a sonda continuar no ar.'}
        </p>
      )}

      {error && (
        <p className="text-[11px] text-red-400 mt-2 flex items-center gap-1"><XCircle size={11} /> {error}</p>
      )}
    </div>
  )
}
