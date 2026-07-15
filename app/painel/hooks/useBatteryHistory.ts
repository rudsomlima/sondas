'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { GMT3 } from '@/app/lib/types'

export interface BattVoltageEntry {
  at: number // epoch ms
  v:  number // tensão (V)
}

const STORAGE_KEY    = 'sondas_batt_history'
const MAX_ENTRIES    = 5000
const MAX_AGE_MS     = 7 * 24 * 60 * 60 * 1000
const MIN_DELTA_V    = 0.01   // só grava se a tensão mudou pelo menos isso
const MAX_SILENT_MS  = 5 * 60 * 1000 // ou se passou 5 min sem registro (captura tendência estável)

export function localBattDayKey(utcMs: number): string {
  const local = new Date(utcMs + GMT3)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`
}

function readHistory(): BattVoltageEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const arr = raw ? JSON.parse(raw) : []
    if (!Array.isArray(arr)) return []
    return arr.filter((e): e is BattVoltageEntry =>
      e && typeof e.at === 'number' && typeof e.v === 'number' && isFinite(e.v))
  } catch { return [] }
}

function writeHistory(entries: BattVoltageEntry[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)) } catch { }
}

function pruneHistory(entries: BattVoltageEntry[]): BattVoltageEntry[] {
  const cutoff = Date.now() - MAX_AGE_MS
  const pruned = entries.filter(e => e.at >= cutoff)
  return pruned.length > MAX_ENTRIES ? pruned.slice(pruned.length - MAX_ENTRIES) : pruned
}

export interface UseBatteryHistoryResult {
  history:   BattVoltageEntry[]
  deleteDay: (dayKey: string) => void
}

export function useBatteryHistory(
  ttgoBattV:     number | null,
  mqttConnected: boolean,
): UseBatteryHistoryResult {
  const [history, setHistory] = useState<BattVoltageEntry[]>(() => readHistory())
  const lastRef = useRef<{ at: number; v: number } | null>(null)

  useEffect(() => {
    if (!mqttConnected || ttgoBattV === null) return
    const now  = Date.now()
    const last = lastRef.current
    const shouldRecord = !last
      || Math.abs(ttgoBattV - last.v) >= MIN_DELTA_V
      || now - last.at >= MAX_SILENT_MS
    if (!shouldRecord) return
    lastRef.current = { at: now, v: ttgoBattV }
    setHistory(prev => {
      const next = pruneHistory([...prev, { at: now, v: ttgoBattV }])
      writeHistory(next)
      return next
    })
  }, [ttgoBattV, mqttConnected])

  const deleteDay = useCallback((dayKey: string) => {
    setHistory(prev => {
      const next = pruneHistory(prev.filter(e => localBattDayKey(e.at) !== dayKey))
      writeHistory(next)
      return next
    })
  }, [])

  return { history, deleteDay }
}
