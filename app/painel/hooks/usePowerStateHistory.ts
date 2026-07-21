'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { RdzPower } from '@/app/lib/mqtt'
import { GMT3 } from '@/app/lib/types'
import { derivePowerHistoryState, powerHistoryKey, type PowerHistoryState, type PowerHistoryEntry } from '@/app/lib/powerState'

function localDayKey(utcMs: number): string {
  const local = new Date(utcMs + GMT3)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`
}

export type { PowerHistoryState, PowerHistoryEntry }

const MAX_ENTRIES = 2000
const MAX_AGE_MS  = 14 * 24 * 60 * 60 * 1000

// Marca de presença enquanto a aba fica aberta com MQTT conectado, mesmo sem
// mudança de estado — sem isso, o timeline (PowerTimeline.tsx) não tinha como
// distinguir "estado observado continuamente" de "app fechado por horas e o
// último valor observado (ex. 'awake') foi apenas assumido até agora". Ver
// MAX_ASSUME_MS em PowerTimeline.tsx, que deve ficar > este intervalo.
export const HEARTBEAT_MS = 4 * 60 * 1000

function storageKey(receiverKey: string): string {
  return `sondas_power_${receiverKey}`
}

function readHistory(receiverKey: string): PowerHistoryEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(storageKey(receiverKey))
    const arr = raw ? JSON.parse(raw) : []
    if (!Array.isArray(arr)) return []
    return arr.filter((e): e is PowerHistoryEntry =>
      e && typeof e.at === 'number' &&
      (e.state === 'awake' || e.state === 'sleeping' || e.state === 'listening' || e.state === 'eco'))
  } catch { return [] }
}

function writeLocalHistory(receiverKey: string, entries: PowerHistoryEntry[]) {
  try { localStorage.setItem(storageKey(receiverKey), JSON.stringify(entries)) } catch { }
}

function pruneHistory(entries: PowerHistoryEntry[]): PowerHistoryEntry[] {
  const cutoff = Date.now() - MAX_AGE_MS
  const pruned = entries.filter(e => e.at >= cutoff)
  return pruned.length > MAX_ENTRIES ? pruned.slice(pruned.length - MAX_ENTRIES) : pruned
}

// Só usado pela exclusão explícita de um dia (ação do usuário) — a escrita
// passiva de novas leituras não vai mais pro R2 daqui: isso agora é
// responsabilidade exclusiva do poller do servidor (app/lib/mqttServerPoll.ts,
// rodando via /api/poll), pra não ter dois escritores brigando pelo mesmo
// arquivo. Este hook fica só como cache local rápido + leitura inicial do R2.
async function syncToR2(receiverKey: string, data: PowerHistoryEntry[]) {
  try {
    await fetch(
      `/api/receiver-history?key=${encodeURIComponent(receiverKey)}&type=power`,
      { method: 'PUT', body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } }
    )
  } catch { }
}

async function loadFromR2(receiverKey: string): Promise<PowerHistoryEntry[]> {
  try {
    const res = await fetch(`/api/receiver-history?key=${encodeURIComponent(receiverKey)}&type=power`)
    if (!res.ok) return []
    const arr = await res.json()
    return Array.isArray(arr) ? arr.filter((e): e is PowerHistoryEntry =>
      e && typeof e.at === 'number' &&
      (e.state === 'awake' || e.state === 'sleeping' || e.state === 'listening' || e.state === 'eco')) : []
  } catch { return [] }
}

export interface UsePowerStateHistoryResult {
  history:   PowerHistoryEntry[]
  deleteDay: (dayKey: string) => void
}

/**
 * Histórico de transições de power/deep-sleep, isolado por receptor
 * (`receiverKey`). Usa localStorage como cache rápido pra exibição imediata
 * enquanto a aba está aberta; a fonte de verdade durável no R2 é escrita
 * pelo poller do servidor (não por este hook — ver comentário em syncToR2).
 */
export function usePowerStateHistory(
  sleeping:      { reason?: string } | null,
  waitingLate:   { reason?: string } | null,
  power:         RdzPower | null,
  mqttConnected: boolean,
  receiverKey:   string,
): UsePowerStateHistoryResult {
  // Inicializa sempre vazio — evita mismatch de hidratação (SSR ≠ cliente com localStorage).
  const [history, setHistory] = useState<PowerHistoryEntry[]>([])
  const receiverRef = useRef(receiverKey)

  // Carrega histórico inicial do localStorage; se vazio, tenta R2
  useEffect(() => {
    const local = readHistory(receiverKey)
    if (local.length > 0) { setHistory(local); return }
    loadFromR2(receiverKey).then(r2data => {
      if (r2data.length === 0) return
      const pruned = pruneHistory(r2data)
      writeLocalHistory(receiverKey, pruned)
      setHistory(pruned)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // só no mount — receiverKey não muda sem reload de página

  useEffect(() => {
    if (!mqttConnected) return
    const { state, reason } = derivePowerHistoryState(sleeping, waitingLate, power)
    const key = powerHistoryKey(state, reason)

    setHistory(prev => {
      const last = prev[prev.length - 1]
      const lastKey = last ? powerHistoryKey(last.state, last.reason) : null
      if (lastKey === key) return prev
      const next = pruneHistory([...prev, { at: Date.now(), state, reason, cpuMhz: power?.cpuMhz, wifi: power?.wifi }])
      writeLocalHistory(receiverKey, next)
      return next
    })
  }, [sleeping, waitingLate, power, mqttConnected, receiverKey])

  // Heartbeat: refs sempre atualizadas pra não recriar o setInterval a cada
  // mudança de props (o que reiniciaria a cadência).
  const liveRef = useRef({ sleeping, waitingLate, power })
  useEffect(() => { liveRef.current = { sleeping, waitingLate, power } })

  useEffect(() => {
    if (!mqttConnected) return
    const id = setInterval(() => {
      const { sleeping, waitingLate, power } = liveRef.current
      const { state, reason } = derivePowerHistoryState(sleeping, waitingLate, power)
      setHistory(prev => {
        const next = pruneHistory([...prev, { at: Date.now(), state, reason, cpuMhz: power?.cpuMhz, wifi: power?.wifi }])
        writeLocalHistory(receiverKey, next)
        return next
      })
    }, HEARTBEAT_MS)
    return () => clearInterval(id)
  }, [mqttConnected, receiverKey])

  const deleteDay = useCallback((dayKey: string) => {
    setHistory(prev => {
      const next = pruneHistory(prev.filter(e => localDayKey(e.at) !== dayKey))
      writeLocalHistory(receiverKey, next)
      syncToR2(receiverRef.current, next)
      return next
    })
  }, [receiverKey])

  return { history, deleteDay }
}
