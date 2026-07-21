'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { GMT3 } from '@/app/lib/types'
import { MAX_SILENT_MS, shouldRecordBattReading, type BattVoltageEntry } from '@/app/lib/powerState'

export function localBattDayKey(utcMs: number): string {
  const local = new Date(utcMs + GMT3)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`
}

export { MAX_SILENT_MS }
export type { BattVoltageEntry }

const MAX_ENTRIES   = 5000
const MAX_AGE_MS    = 7 * 24 * 60 * 60 * 1000

function storageKey(receiverKey: string): string {
  return `sondas_batt_${receiverKey}`
}

function readHistory(receiverKey: string): BattVoltageEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(storageKey(receiverKey))
    const arr = raw ? JSON.parse(raw) : []
    if (!Array.isArray(arr)) return []
    return arr.filter((e): e is BattVoltageEntry =>
      e && typeof e.at === 'number' && typeof e.v === 'number' && isFinite(e.v))
  } catch { return [] }
}

function writeLocalHistory(receiverKey: string, entries: BattVoltageEntry[]) {
  try { localStorage.setItem(storageKey(receiverKey), JSON.stringify(entries)) } catch { }
}

function pruneHistory(entries: BattVoltageEntry[]): BattVoltageEntry[] {
  const cutoff = Date.now() - MAX_AGE_MS
  const pruned = entries.filter(e => e.at >= cutoff)
  return pruned.length > MAX_ENTRIES ? pruned.slice(pruned.length - MAX_ENTRIES) : pruned
}

// Só usada pela exclusão explícita de um dia — a escrita passiva de novas
// leituras não vai mais pro R2 daqui, é responsabilidade exclusiva do
// poller do servidor (ver mesmo comentário em usePowerStateHistory.ts).
async function syncToR2(receiverKey: string, data: BattVoltageEntry[]) {
  try {
    await fetch(
      `/api/receiver-history?key=${encodeURIComponent(receiverKey)}&type=batt`,
      { method: 'PUT', body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } }
    )
  } catch { /* R2 indisponível — localStorage tem os dados */ }
}

async function loadFromR2(receiverKey: string): Promise<BattVoltageEntry[]> {
  try {
    const res = await fetch(`/api/receiver-history?key=${encodeURIComponent(receiverKey)}&type=batt`)
    if (!res.ok) return []
    const arr = await res.json()
    return Array.isArray(arr) ? arr.filter((e): e is BattVoltageEntry =>
      e && typeof e.at === 'number' && typeof e.v === 'number') : []
  } catch { return [] }
}

export interface UseBatteryHistoryResult {
  history:   BattVoltageEntry[]
  deleteDay: (dayKey: string) => void
}

export function useBatteryHistory(
  ttgoBattV:     number | null,
  mqttConnected: boolean,
  receiverKey:   string,
): UseBatteryHistoryResult {
  // Inicializa sempre vazio para evitar mismatch de hidratação (SSR não tem localStorage).
  // O useEffect abaixo carrega do localStorage / R2 logo após o mount.
  const [history, setHistory] = useState<BattVoltageEntry[]>([])
  const lastRef     = useRef<{ at: number; v: number } | null>(null)
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

  // Gravação de nova leitura (cache local — o R2 é escrito pelo poller do servidor)
  useEffect(() => {
    if (!mqttConnected || ttgoBattV === null) return
    const now  = Date.now()
    const last = lastRef.current
    if (!shouldRecordBattReading(last, ttgoBattV, now)) return
    lastRef.current = { at: now, v: ttgoBattV }
    setHistory(prev => {
      const next = pruneHistory([...prev, { at: now, v: ttgoBattV }])
      writeLocalHistory(receiverKey, next)
      return next
    })
  }, [ttgoBattV, mqttConnected, receiverKey])

  const deleteDay = useCallback((dayKey: string) => {
    setHistory(prev => {
      const next = pruneHistory(prev.filter(e => localBattDayKey(e.at) !== dayKey))
      writeLocalHistory(receiverKey, next)
      syncToR2(receiverRef.current, next)
      return next
    })
  }, [receiverKey])

  return { history, deleteDay }
}
