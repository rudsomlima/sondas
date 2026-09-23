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

// Estado de energia (publicado só quando muda — não é heartbeat), ver
// RX_FSK/src/sleep.cpp:
// {"eco": true, "cpu_mhz": 80, "wifi": "off", "level": 2, "period": "idle", "report_s": 900}
// level/period/report_s só existem a partir dos níveis de energia (power.*);
// firmwares antigos mandam só eco/cpu_mhz/wifi.
export type RdzPowerPeriod = 'flight' | 'window' | 'wait' | 'idle'

export interface RdzPower {
  eco: boolean // bateria crítica (power.vcrit) ativa
  cpuMhz: number // 80 ou 240
  wifi: 'on' | 'modem_sleep' | 'off'
  level?: number // 0 Pleno, 1 Econômico, 2 Silencioso
  period?: RdzPowerPeriod
  reportS?: number // Silencioso: segundos entre as religadas do WiFi (0 = conectado direto)
  boostUntil?: number // turbo remoto em vigor até (epoch s); 0/ausente = nenhum
  boost?: 'manual' | 'auto'
}

const PERIODS: readonly string[] = ['flight', 'window', 'wait', 'idle']

export function parseRdzPower(payload: string): RdzPower | null {
  let raw: Record<string, unknown>
  try { raw = JSON.parse(payload) } catch { return null }
  if (typeof raw !== 'object' || raw === null) return null
  const cpuMhz = num(raw.cpu_mhz)
  const wifi = raw.wifi
  if (cpuMhz === undefined || (wifi !== 'on' && wifi !== 'modem_sleep' && wifi !== 'off')) return null
  return {
    eco: raw.eco === true,
    cpuMhz,
    wifi,
    level: num(raw.level),
    period: typeof raw.period === 'string' && PERIODS.includes(raw.period) ? raw.period as RdzPowerPeriod : undefined,
    reportS: num(raw.report_s),
    boostUntil: num(raw.boost_until),
    boost: raw.boost === 'manual' || raw.boost === 'auto' ? raw.boost : undefined,
  }
}

// Rede do receptor (report periódico, ver reportPmu em conn-report.cpp):
// {"ip":"192.168.0.50","pub":"177.x.x.x","rssi":-61}. O IP público vem do
// próprio receptor porque o reporte passa pelo relay HTTP→HTTPS — pro app a
// origem da requisição é sempre o relay.
export interface RdzNet {
  localIp?: string
  publicIp?: string
  rssi?: number // dBm do WiFi
}

const IP_RE = /^[0-9a-fA-F.:]{3,45}$/

export function parseRdzNet(payload: string): RdzNet | null {
  let raw: Record<string, unknown>
  try { raw = JSON.parse(payload) } catch { return null }
  if (typeof raw !== 'object' || raw === null) return null
  const ip = (v: unknown) => typeof v === 'string' && IP_RE.test(v) && v !== '0.0.0.0' ? v : undefined
  const net: RdzNet = { localIp: ip(raw.ip), publicIp: ip(raw.pub), rssi: num(raw.rssi) }
  return net.localIp || net.publicIp ? net : null
}

// Motivo do reset deste boot, reportado uma vez por boot (reportBoot em
// conn-report.cpp): {"reset_reason": 9, "wake": "timer"|"power-on/reset", "count": 42}
// esp_reset_reason_t: 1=power-on 3=software(ex. auto-OTA) 4=panic
// 5/6/7=watchdog 8=deep sleep 9=brownout(queda de tensão).
export interface RdzBoot {
  resetReason: number
  wake: 'timer' | 'power-on/reset'
  count?: number
}

// Resets que não são o esperado (ligar na tomada = power-on/1, acordar do
// deep sleep = wake:"timer"): indicam o receptor caindo sozinho no meio da
// operação — o sintoma relatado foi o display preso na tela de WiFi/IP por
// até 20s logo depois de um desses.
export const ABNORMAL_RESET_REASONS: Record<number, string> = {
  3: 'reinício por software (ex. auto-OTA)',
  4: 'pane (panic)',
  5: 'watchdog (tarefa travada)',
  6: 'watchdog (tarefa travada)',
  7: 'watchdog (int. travada)',
  9: 'queda de tensão (brownout)',
}

export function parseRdzBoot(payload: string): RdzBoot | null {
  let raw: Record<string, unknown>
  try { raw = JSON.parse(payload) } catch { return null }
  if (typeof raw !== 'object' || raw === null) return null
  const resetReason = num(raw.reset_reason)
  if (resetReason === undefined) return null
  const wake = raw.wake === 'timer' ? 'timer' : 'power-on/reset'
  return { resetReason, wake, count: num(raw.count) }
}

// Falha do auto-OTA (reportOtaFail em conn-ota.cpp/conn-report.cpp), enviada
// quando checkAutoOta() detecta versão diferente mas não consegue aplicar —
// antes só ia pro serial (Serial.printf "OTA: ..."), invisível sem cabo.
// stage: "version" (nem conseguiu checar a versão publicada) | "get"
// (download não veio) | "begin"/"write"/"end" (Update.* falhou — write é o
// mais comum: timeout no meio do download em sinal fraco).
export interface RdzOtaFail {
  stage: string
  httpCode?: number
  len?: number
  remote?: string
  at: number // epoch ms de quando o app recebeu o report (não vem do firmware)
}

export function parseRdzOtaFail(payload: string, at: number): RdzOtaFail | null {
  let raw: Record<string, unknown>
  try { raw = JSON.parse(payload) } catch { return null }
  if (typeof raw !== 'object' || raw === null) return null
  const stage = typeof raw.stage === 'string' ? raw.stage : ''
  if (!stage) return null
  return {
    stage,
    httpCode: num(raw.http_code),
    len: num(raw.len),
    remote: typeof raw.remote === 'string' && raw.remote ? raw.remote : undefined,
    at,
  }
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
