'use client'

import { useEffect, useState } from 'react'
import { stationKey, type ReceiverStation } from './receiverStations'
import { subscribeRegistry } from './sondeRegistryClient'

/**
 * Estações receptoras (R2, ver receiverStations.ts) no navegador: cache em
 * memória + localStorage (`sondas_receiver_stations_v1`) pra os mapas abrirem
 * já com as antenas, e releitura quando o registro de sondas muda (um
 * enriquecimento no servidor pode ter trazido estações novas).
 */

const STORAGE_KEY = 'sondas_receiver_stations_v1'
const MIN_REFETCH_MS = 60_000

let memory: Map<string, ReceiverStation> | null = null
let lastFetchAt = 0
let inFlight: Promise<Map<string, ReceiverStation>> | null = null
const listeners = new Set<() => void>()

function load(): Map<string, ReceiverStation> {
  if (memory) return memory
  memory = new Map()
  if (typeof window !== 'undefined') {
    try {
      const arr = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as ReceiverStation[]
      for (const st of arr) if (st?.callsign) memory.set(stationKey(st.callsign), st)
    } catch { /* cache inválido */ }
  }
  return memory
}

export function cachedReceiverStations(): Map<string, ReceiverStation> {
  return load()
}

export function fetchReceiverStations(force = false): Promise<Map<string, ReceiverStation>> {
  if (inFlight) return inFlight
  if (!force && Date.now() - lastFetchAt < MIN_REFETCH_MS) return Promise.resolve(load())
  lastFetchAt = Date.now()
  inFlight = fetch('/api/receiver-stations', { cache: 'no-store' })
    .then(r => r.ok ? r.json() : { stations: [] })
    .then((j: { stations?: ReceiverStation[] }) => {
      const next = new Map<string, ReceiverStation>()
      for (const st of j.stations ?? []) if (st?.callsign) next.set(stationKey(st.callsign), st)
      if (next.size > 0 || load().size === 0) {
        memory = next
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...next.values()])) } catch { /* cheio */ }
        for (const l of listeners) l()
      }
      return load()
    })
    .catch(() => load())
    .finally(() => { inFlight = null })
  return inFlight
}

/** Mapa callsign (maiúsculas) → estação. Atualiza sozinho. */
export function useReceiverStations(): Map<string, ReceiverStation> {
  const [stations, setStations] = useState<Map<string, ReceiverStation>>(() => load())
  useEffect(() => {
    const update = () => setStations(new Map(load()))
    listeners.add(update)
    fetchReceiverStations(true)
    // Registro mudou (enriquecimento trouxe dados) → pode haver estação nova.
    let t: ReturnType<typeof setTimeout> | null = null
    const unsub = subscribeRegistry(() => {
      if (t) return
      t = setTimeout(() => { t = null; fetchReceiverStations() }, 3000)
    })
    return () => { listeners.delete(update); unsub(); if (t) clearTimeout(t) }
  }, [])
  return stations
}
