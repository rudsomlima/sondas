'use client'

import { useEffect, useState } from 'react'

/**
 * Preferências de EXIBIÇÃO do mapa — hoje só o liga/desliga do agrupamento
 * de sondas pousadas por proximidade em pixels (ver markerClustering.ts).
 *
 * Diferente de app/lib/appSettings.ts (Wyoming): isto é puro display, nunca
 * afeta o que é buscado nem precisa do servidor — só localStorage
 * (`sondas_map_display_v1`), espelhado com o mesmo padrão de evento pra
 * valer NA HORA em toda aba com um mapa aberto (e nas outras abas, via
 * `storage`), sem precisar recarregar a página.
 *
 * Escopo: só sondas POUSADAS (balões). Reaparecimentos e estações
 * receptoras continuam agrupados normalmente — são problemas de
 * sobreposição diferentes, com soluções próprias (hub+setas, "+N"), e
 * desligá-los não foi pedido.
 */

const STORAGE_KEY = 'sondas_map_display_v1'
const EVENT = 'sondas:map-display'

export interface MapDisplaySettings {
  clusterLandedSondes: boolean
}

const DEFAULTS: MapDisplaySettings = { clusterLandedSondes: true }

let current: MapDisplaySettings | null = null
let storageListener = false

function notify() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT))
}

function load(): MapDisplaySettings {
  if (typeof window !== 'undefined' && !storageListener) {
    storageListener = true
    window.addEventListener('storage', e => {
      if (e.key !== STORAGE_KEY) return
      current = null
      notify()
    })
  }
  if (current) return current
  current = { ...DEFAULTS }
  if (typeof window !== 'undefined') {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
      if (raw && typeof raw.clusterLandedSondes === 'boolean') current.clusterLandedSondes = raw.clusterLandedSondes
    } catch { /* inválido: padrão */ }
  }
  return current
}

/** Valor atual, síncrono (pra código fora de componente/efeito de desenho). */
export function isLandedSondeClusteringEnabled(): boolean {
  return load().clusterLandedSondes
}

export function setLandedSondeClusteringEnabled(enabled: boolean): void {
  const next = { ...load(), clusterLandedSondes: enabled }
  current = next
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* sem storage */ }
  notify()
}

/**
 * Hook reativo — os três mapas (YearMap, LaunchMap, MissionMap) usam isto
 * pra saber se devem chamar `clusterByPixel` de verdade ou desenhar cada
 * sonda individualmente, e pra reagir na hora se o usuário mudar em
 * Configurações com o mapa já aberto.
 */
export function useLandedSondeClusteringEnabled(): boolean {
  const [enabled, setEnabled] = useState(DEFAULTS.clusterLandedSondes)
  useEffect(() => {
    const sync = () => setEnabled(load().clusterLandedSondes)
    window.addEventListener(EVENT, sync)
    sync()
    return () => window.removeEventListener(EVENT, sync)
  }, [])
  return enabled
}
