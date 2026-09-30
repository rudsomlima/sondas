'use client'

import { useEffect, useState } from 'react'
import { DEFAULT_STATION, SELECTED_STATIONS_EVENT, getSelectedStations, type Station } from './stations'

const INITIAL = [DEFAULT_STATION]

/**
 * Estações escolhidas em Configurações (a 1ª é a principal), atualizadas na
 * hora quando a lista muda nesta aba (evento interno) ou em outra (`storage`).
 *
 * No 1º render devolve o padrão (igual ao servidor, que não tem
 * localStorage); `ready` vira true depois de ler o valor real — quem dispara
 * consultas caras pode esperar por ele pra não buscar a estação padrão à toa.
 */
export function useSelectedStations(): { stations: Station[]; ready: boolean } {
  const [stations, setStations] = useState<Station[]>(INITIAL)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const read = () => {
      const next = getSelectedStations()
      // Mesma lista → mesma referência (não refaz consultas à toa).
      setStations(prev => prev.map(s => s.id).join(',') === next.map(s => s.id).join(',') ? prev : next)
    }
    read()
    setReady(true)
    const onStorage = (e: StorageEvent) => { if (!e.key || e.key.startsWith('sondas_station')) read() }
    window.addEventListener(SELECTED_STATIONS_EVENT, read)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(SELECTED_STATIONS_EVENT, read)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  return { stations, ready }
}
