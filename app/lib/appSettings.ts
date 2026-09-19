'use client'

import { useEffect, useState } from 'react'

/**
 * Configurações GLOBAIS do app no navegador — hoje só o liga/desliga da
 * consulta à University of Wyoming.
 *
 * Fonte de verdade no R2 (`/api/app-settings`, vale pra todos os aparelhos),
 * espelhada aqui (memória + localStorage `sondas_app_settings_v1`) pra valer
 * **na hora**: mudar o valor avisa todos os componentes montados (evento
 * interno) e as outras abas (evento `storage`), e cada seção refaz as suas
 * consultas sem recarregar a página.
 *
 * Wyoming desligada significa, em TODO o app:
 *  - nenhuma chamada ao site da Wyoming (o navegador manda `wyoming=0` pra
 *    /api/sounding, que aí usa só radiosondy.info e SondeHub);
 *  - nenhum dado vindo dela é mostrado (lançamentos, selo W, contagens,
 *    links), e os lançamentos passam a vir só das sondas rastreadas;
 *  - o cache local do histórico fica separado (`cacheStationKey`), pra não
 *    misturar dados com e sem Wyoming.
 */

const STORAGE_KEY = 'sondas_app_settings_v1'
const EVENT = 'sondas:app-settings'

export interface AppGlobalSettings {
  wyomingEnabled: boolean
}

const DEFAULTS: AppGlobalSettings = { wyomingEnabled: true }

let current: AppGlobalSettings | null = null
let serverState: 'idle' | 'loading' | 'done' = 'idle'
let storageListener = false

function notify() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT))
}

function load(): AppGlobalSettings {
  if (typeof window !== 'undefined' && !storageListener) {
    // Outra aba mudou a opção: relê e avisa os componentes desta aba — mesmo
    // que nenhum esteja usando o hook agora (isWyomingEnabled() fica certo).
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
      if (raw && typeof raw.wyomingEnabled === 'boolean') current.wyomingEnabled = raw.wyomingEnabled
    } catch { /* inválido: padrão */ }
  }
  return current
}

function apply(next: AppGlobalSettings) {
  const prev = load()
  current = next
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* sem storage */ }
  if (prev.wyomingEnabled !== next.wyomingEnabled) notify()
}

/** Valor atual, síncrono (pra código fora de componente). */
export function isWyomingEnabled(): boolean {
  return load().wyomingEnabled
}

/** Parâmetro a anexar em toda chamada a /api/sounding. */
export function wyomingQuery(): string {
  return `&wyoming=${isWyomingEnabled() ? 1 : 0}`
}

/**
 * Chave de estação pro cache local do histórico (app/lib/cache.ts): com a
 * Wyoming desligada, os meses ficam num espaço separado — senão o cache com
 * dados da Wyoming apareceria (ou seria sobrescrito por dados sem ela).
 */
export function cacheStationKey(stationId: string): string {
  return isWyomingEnabled() ? stationId : `${stationId}~sem-wyoming`
}

export async function setWyomingEnabled(enabled: boolean): Promise<void> {
  apply({ ...load(), wyomingEnabled: enabled })
  try {
    const res = await fetch('/api/app-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wyomingEnabled: enabled }),
    })
    if (!res.ok) throw new Error(`o servidor respondeu ${res.status}`)
  } catch (e: any) {
    // Local já vale; o servidor fica com o valor antigo até a próxima troca.
    throw new Error(`Aplicado neste navegador, mas não salvo no servidor (${e?.message ?? 'sem conexão'}).`)
  }
}

function syncFromServer() {
  if (serverState !== 'idle' || typeof window === 'undefined') return
  serverState = 'loading'
  fetch('/api/app-settings', { cache: 'no-store' })
    .then(r => r.ok ? r.json() : null)
    .then((j: { wyomingEnabled?: boolean } | null) => {
      if (j && typeof j.wyomingEnabled === 'boolean') apply({ ...load(), wyomingEnabled: j.wyomingEnabled })
    })
    .catch(() => { /* fica com o espelho local */ })
    .finally(() => { serverState = 'done'; notify() })
}

/**
 * Hook reativo: re-renderiza quando o valor muda (nesta aba, em outra aba ou
 * vindo do servidor). A 1ª renderização usa o padrão (igual ao HTML do
 * servidor, sem erro de hidratação) e o valor salvo entra logo em seguida.
 * Quem faz consulta deve ler `wyomingQuery()`/`isWyomingEnabled()` na hora da
 * chamada (sempre o valor real) e usar este hook só como dependência pra
 * refazer a consulta quando o valor mudar.
 */
export function useWyomingEnabled(): boolean {
  return useWyomingSetting().enabled
}

/**
 * Igual ao useWyomingEnabled, mais `ready`: só fica true depois de conhecido
 * o valor real (local + servidor). Um controle de liga/desliga deve ficar
 * bloqueado até lá — antes disso ele mostra o padrão, e um clique inverteria
 * o valor errado.
 */
export function useWyomingSetting(): { enabled: boolean; ready: boolean } {
  const [state, setState] = useState({ enabled: DEFAULTS.wyomingEnabled, ready: false })
  useEffect(() => {
    const sync = () => setState({ enabled: load().wyomingEnabled, ready: serverState === 'done' })
    window.addEventListener(EVENT, sync)
    sync()
    syncFromServer()
    return () => window.removeEventListener(EVENT, sync)
  }, [])
  return state
}
