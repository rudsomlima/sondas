/**
 * Tipos e parsing dos JSONs de telemetria que o firmware rdzTTGOsonde
 * reporta via HTTP direto (RX_FSK/src/conn-report.cpp) — bateria, deep sleep
 * e estado de energia. MQTT foi removido do projeto por completo (histórico:
 * este arquivo se chamava mqtt.ts porque esses mesmos JSONs eram publicados
 * em tópicos MQTT antes da migração); a config remota completa também virou
 * HTTP (ver conn-cfg.cpp, app/lib/cfgAuth.ts, useFirmwareConfig.ts). Módulo
 * puro, sem 'use client'.
 */

// {"V_Batt": 3.987} no TTGO sem PMU; com PMU AXP vêm também I_Batt/V_Vbus/I_Vbus/T_sys.
export interface RdzPmu {
  vBatt: number
}

// Deep sleep v2 do fork: {"sleep_until": <epoch s>, "reason": "...", "V_Batt": 3.81, "boot": 42}
// sleep_until=0 = acordado.
export interface RdzSleep {
  sleepUntil: number // epoch em segundos; 0 = acordado
  reason?: string
  vBatt?: number
  boot?: number
}

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && isFinite(v) ? v : undefined

export function parseRdzPmu(payload: string): RdzPmu | null {
  let raw: Record<string, unknown>
  try { raw = JSON.parse(payload) } catch { return null }
  if (typeof raw !== 'object' || raw === null) return null
  const vBatt = num(raw.V_Batt)
  if (vBatt === undefined) return null
  return { vBatt }
}

// Tópico {prefix}power (retained, publicado só quando muda — não é
// heartbeat): estado de energia do deep sleep v2 (RX_FSK/src/sleep.cpp).
// {"eco": true, "cpu_mhz": 80, "wifi": "modem_sleep"}
export interface RdzPower {
  eco: boolean // modo economia por bateria crítica (sleep.vcrit) ativo
  cpuMhz: number // 80 ou 240
  wifi: 'on' | 'modem_sleep' | 'off'
}

export function parseRdzPower(payload: string): RdzPower | null {
  let raw: Record<string, unknown>
  try { raw = JSON.parse(payload) } catch { return null }
  if (typeof raw !== 'object' || raw === null) return null
  const cpuMhz = num(raw.cpu_mhz)
  const wifi = raw.wifi
  if (cpuMhz === undefined || (wifi !== 'on' && wifi !== 'modem_sleep' && wifi !== 'off')) return null
  return { eco: raw.eco === true, cpuMhz, wifi }
}

export function parseRdzSleep(payload: string): RdzSleep | null {
  let raw: Record<string, unknown>
  try { raw = JSON.parse(payload) } catch { return null }
  if (typeof raw !== 'object' || raw === null) return null
  const sleepUntil = num(raw.sleep_until)
  if (sleepUntil === undefined) return null
  return {
    sleepUntil,
    reason: typeof raw.reason === 'string' ? raw.reason : undefined,
    vBatt: num(raw.V_Batt),
    boot: num(raw.boot),
  }
}
