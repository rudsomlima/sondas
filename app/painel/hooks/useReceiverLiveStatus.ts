'use client'

import { useEffect, useRef, useState } from 'react'
import type { RdzPmu, RdzSleep, RdzPower } from '@/app/lib/mqtt'

const DEFAULT_POLL_MS = 20_000
// Não faz sentido bater no servidor bem mais rápido do que o receptor
// consegue reportar — mas também não vale deixar passar muito de um minuto
// pra não parecer travado se o usuário configurar um report_interval enorme.
const MIN_POLL_MS = 5_000
const MAX_POLL_MS = 60_000

export interface ReceiverLiveStatusState {
  connected:         boolean // último poll ao servidor teve sucesso (não significa que há dado)
  lastLiveMessageAt: number | null // epoch do último report conhecido (pmu/sleep/power)
  ttgoBattV:         number | null
  sleepState:        RdzSleep | null
  powerState:        RdzPower | null
}

/**
 * Substitui, pro card "Meu receptor" em /painel, o que antes vinha ao vivo
 * via tópicos MQTT pmu/sleep/power (branch mqtt-cfg-only: MQTT ficou restrito
 * à configuração remota, ver useFirmwareConfig.ts). Faz polling de
 * /api/receiver-live-status — o firmware grava esse snapshot a cada report
 * HTTP direto (conn-report.cpp), então a latência aqui é a do próprio
 * cadenciamento de report do receptor (mqtt.report_interval), não ~1s como o
 * MQTT antigo — aceitável: bateria/sleep/power não mudam a cada segundo.
 */
// reportIntervalMs: cadência real do receptor (mqtt.report_interval, em ms),
// quando conhecida — ver meu-receptor/page.tsx, que lê isso da config
// completa já carregada e repassa pra cá. Sem isso (ex.: /painel, que não
// carrega a config completa), cai no default.
export function useReceiverLiveStatus(receiverKey: string, reportIntervalMs?: number): ReceiverLiveStatusState {
  const [state, setState] = useState<ReceiverLiveStatusState>({
    connected: false, lastLiveMessageAt: null, ttgoBattV: null, sleepState: null, powerState: null,
  })
  const keyRef = useRef(receiverKey)
  keyRef.current = receiverKey

  const pollMs = reportIntervalMs
    ? Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, reportIntervalMs))
    : DEFAULT_POLL_MS

  useEffect(() => {
    let cancelled = false
    const poll = () => {
      fetch(`/api/receiver-live-status?receiver=${encodeURIComponent(keyRef.current)}`)
        .then(r => r.json())
        .then((d: { ok: boolean; status?: { pmu?: RdzPmu; sleep?: RdzSleep; power?: RdzPower; updatedAt: number } | null }) => {
          if (cancelled) return
          const s = d.status
          setState({
            connected: true,
            lastLiveMessageAt: s?.updatedAt ?? null,
            ttgoBattV: s?.pmu?.vBatt ?? null,
            sleepState: s?.sleep ?? null,
            powerState: s?.power ?? null,
          })
        })
        .catch(() => { if (!cancelled) setState(prev => ({ ...prev, connected: false })) })
    }
    poll()
    const id = setInterval(poll, pollMs)
    return () => { cancelled = true; clearInterval(id) }
  }, [receiverKey, pollMs])

  return state
}
