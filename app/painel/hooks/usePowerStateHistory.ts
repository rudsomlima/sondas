'use client'

import { useCallback, useEffect, useState } from 'react'
import type { RdzPower } from '@/app/lib/mqtt'
import { GMT3 } from '@/app/lib/types'

function localDayKey(utcMs: number): string {
  const local = new Date(utcMs + GMT3)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`
}

export type PowerHistoryState = 'awake' | 'sleeping' | 'listening' | 'eco'

export interface PowerHistoryEntry {
  at: number // epoch ms de quando o app percebeu a transição (não o instante exato no firmware)
  state: PowerHistoryState
  reason?: string
  cpuMhz?: number
  wifi?: string
}

const STORAGE_KEY = 'sondas_power_history'
const MAX_ENTRIES = 2000
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000

function readHistory(): PowerHistoryEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const arr = raw ? JSON.parse(raw) : []
    if (!Array.isArray(arr)) return []
    return arr.filter((e): e is PowerHistoryEntry =>
      e && typeof e.at === 'number' &&
      (e.state === 'awake' || e.state === 'sleeping' || e.state === 'listening' || e.state === 'eco'))
  } catch {
    return []
  }
}

function writeHistory(entries: PowerHistoryEntry[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)) } catch { /* localStorage cheio/indisponível — não crítico */ }
}

function pruneHistory(entries: PowerHistoryEntry[]): PowerHistoryEntry[] {
  const cutoff = Date.now() - MAX_AGE_MS
  const pruned = entries.filter(e => e.at >= cutoff)
  return pruned.length > MAX_ENTRIES ? pruned.slice(pruned.length - MAX_ENTRIES) : pruned
}

/**
 * Histórico local (localStorage, sem servidor — Vercel não sustenta uma
 * assinatura MQTT de longa duração) de transições de Deep Sleep / power
 * management, pra alimentar a linha do tempo em app/meu-receptor. Só
 * acrescenta uma entrada quando o estado REALMENTE muda em relação à última
 * já registrada (mesmo entre recarregamentos de página) — nunca duplica
 * "mesma coisa de novo" a cada render.
 *
 * `mqttConnected` evita gravar um "awake" espúrio no instante entre o mount
 * e a chegada da 1ª mensagem retida de sleep/power (que ainda não chegou,
 * então sleeping/waitingLate/power começam null e pareceriam "awake" por um
 * instante mesmo que o receptor esteja de fato dormindo).
 */
export interface UsePowerStateHistoryResult {
  history: PowerHistoryEntry[]
  deleteDay: (dayKey: string) => void
}

export function usePowerStateHistory(
  sleeping: { reason?: string } | null,
  waitingLate: { reason?: string } | null,
  power: RdzPower | null,
  mqttConnected: boolean,
): UsePowerStateHistoryResult {
  const [history, setHistory] = useState<PowerHistoryEntry[]>(() => readHistory())

  useEffect(() => {
    if (!mqttConnected) return
    const state: PowerHistoryState = sleeping ? 'sleeping' : waitingLate ? 'listening' : power?.eco ? 'eco' : 'awake'
    const reason = sleeping?.reason ?? waitingLate?.reason
    const key = `${state}|${reason ?? ''}`

    setHistory(prev => {
      const last = prev[prev.length - 1]
      const lastKey = last ? `${last.state}|${last.reason ?? ''}` : null
      if (lastKey === key) return prev
      const next = pruneHistory([...prev, { at: Date.now(), state, reason, cpuMhz: power?.cpuMhz, wifi: power?.wifi }])
      writeHistory(next)
      return next
    })
  }, [sleeping, waitingLate, power, mqttConnected])

  const deleteDay = useCallback((dayKey: string) => {
    setHistory(prev => {
      const next = pruneHistory(prev.filter(e => localDayKey(e.at) !== dayKey))
      writeHistory(next)
      return next
    })
  }, [])

  return { history, deleteDay }
}
