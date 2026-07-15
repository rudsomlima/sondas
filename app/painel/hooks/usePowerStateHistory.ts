'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { RdzPower } from '@/app/lib/mqtt'
import { GMT3 } from '@/app/lib/types'

function localDayKey(utcMs: number): string {
  const local = new Date(utcMs + GMT3)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`
}

export type PowerHistoryState = 'awake' | 'sleeping' | 'listening' | 'eco'

export interface PowerHistoryEntry {
  at: number // epoch ms de quando o app percebeu a transição
  state: PowerHistoryState
  reason?: string
  cpuMhz?: number
  wifi?: string
}

const MAX_ENTRIES = 2000
const MAX_AGE_MS  = 14 * 24 * 60 * 60 * 1000
const R2_DEBOUNCE = 20_000

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
 * (`receiverKey`). Usa localStorage como cache rápido e sincroniza
 * periodicamente com o R2 para durabilidade entre dispositivos/sessões.
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
  const r2Timer     = useRef<ReturnType<typeof setTimeout> | null>(null)
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
    const state: PowerHistoryState = sleeping ? 'sleeping' : waitingLate ? 'listening' : power?.eco ? 'eco' : 'awake'
    const reason = sleeping?.reason ?? waitingLate?.reason
    const key = `${state}|${reason ?? ''}`

    setHistory(prev => {
      const last = prev[prev.length - 1]
      const lastKey = last ? `${last.state}|${last.reason ?? ''}` : null
      if (lastKey === key) return prev
      const next = pruneHistory([...prev, { at: Date.now(), state, reason, cpuMhz: power?.cpuMhz, wifi: power?.wifi }])
      writeLocalHistory(receiverKey, next)
      if (r2Timer.current) clearTimeout(r2Timer.current)
      r2Timer.current = setTimeout(() => syncToR2(receiverRef.current, next), R2_DEBOUNCE)
      return next
    })
  }, [sleeping, waitingLate, power, mqttConnected, receiverKey])

  const deleteDay = useCallback((dayKey: string) => {
    setHistory(prev => {
      const next = pruneHistory(prev.filter(e => localDayKey(e.at) !== dayKey))
      writeLocalHistory(receiverKey, next)
      if (r2Timer.current) clearTimeout(r2Timer.current)
      r2Timer.current = setTimeout(() => syncToR2(receiverRef.current, next), R2_DEBOUNCE)
      return next
    })
  }, [receiverKey])

  return { history, deleteDay }
}
