/**
 * Camada MQTT do "meu receptor": tipos e parsing dos JSONs que o firmware
 * rdzTTGOsonde publica (RX_FSK/src/conn-mqtt.cpp + json.cpp, verificados no
 * fonte). Papel espelho de sondehub.ts — módulo puro, sem 'use client'.
 *
 * O firmware publica com QoS 1 RETAINED em dois tópicos sob mqtt.prefix:
 *  - `{prefix}packet` a cada frame decodificado (JSON de sonde2json);
 *  - `{prefix}uptime` a cada 60s ({uptime, user, rxlat?, rxlon?, SW, VER}).
 * Retained = ao assinar recebe-se o ÚLTIMO valor mesmo antigo — frescor deve
 * vir do campo `time` (unix, do GPS da sonda) / da flag retain, nunca da mera
 * chegada da mensagem.
 *
 * O broker é público e sem auth (limitação: o firmware só fala TCP puro, sem
 * TLS, o que exclui os free tiers TLS-only) — todo payload passa por parsing
 * defensivo antes de entrar no app.
 */
import type { NearbySonde } from './sondehub'
import type { RdzConfig } from './rdzConfig'
import { parseConfigJson } from './rdzConfig'

// Campos do sonde2json (todos opcionais no wire; floats NaN são omitidos).
export interface RdzPacket {
  lat: number
  lon: number
  alt?: number
  vs?: number // m/s vertical
  climb?: number // alias legado de vs
  hs?: number
  dir?: number
  temp?: number
  humidity?: number
  pressure?: number
  type?: string
  id?: string
  ser?: string
  frame?: number
  time: number // unix (s), do GPS da sonda
  sats?: number
  freq?: number // MHz
  rssi?: number // cru do firmware; ver rdzRssiToDbm
  afc?: number
  batt?: number // bateria DA SONDA (V)
  launchsite?: string
}

export interface RdzUptime {
  uptimeMs: number // normalizado para millis desde o boot do TTGO
  user?: string
  rxlat?: number
  rxlon?: number
  SW?: string
  VER?: string
  batt?: number // bateria DO TTGO (V) — firmwares antigos patchados; no dev2 vem no tópico pmu
  ip?: string // IP local (LAN) do TTGO — só alcançável se o app rodar na mesma rede
  // Campo `time` (UTC) do dev2 — quando a MENSAGEM foi de fato publicada pelo
  // firmware, diferente de MqttUptimeState.receivedAt (quando NÓS a recebemos,
  // que numa mensagem retained é só o momento em que a aba conectou/assinou,
  // não tem relação com quando o TTGO realmente publicou). É o que permite
  // mostrar "visto pela última vez" correto mesmo abrindo a aba já com o
  // receptor dormindo (retained), sem precisar de outra sonda no ar.
  publishedUtc?: string
}

const IPV4_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/

// Tópico {prefix}pmu (dev2, retained): {"V_Batt": 3.987} no TTGO sem PMU;
// com PMU AXP vêm também I_Batt/V_Vbus/I_Vbus/T_sys.
export interface RdzPmu {
  vBatt: number
}

// Tópico {prefix}sleep (deep sleep v2 do nosso fork, retained):
// {"sleep_until": <epoch s>, "reason": "...", "V_Batt": 3.81, "boot": 42}
// sleep_until=0 = acordado (limpa o estado no broker).
export interface RdzSleep {
  sleepUntil: number // epoch em segundos; 0 = acordado
  reason?: string
  vBatt?: number
  boot?: number
}

// uptime chega a cada 60s; 90s de tolerância = 1 perda antes de "offline".
export const UPTIME_ONLINE_MS = 90_000
// MQTT considerado fonte primária enquanto chegou mensagem live há < 90s.
export const MQTT_FRESH_MS = 90_000

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && isFinite(v) ? v : undefined

// Aceita só packets plausíveis: broker público → o tópico pode receber lixo
// ou JSON de terceiros. Exige serial, lat/lon finitos e time unix entre 2020
// e agora+1h; qualquer outra coisa é descartada em silêncio.
export function parseRdzPacket(payload: string): RdzPacket | null {
  let raw: Record<string, unknown>
  try { raw = JSON.parse(payload) } catch { return null }
  if (typeof raw !== 'object' || raw === null) return null

  const ser = typeof raw.ser === 'string' && raw.ser.trim() ? raw.ser.trim()
    : typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : null
  const lat = num(raw.lat)
  const lon = num(raw.lon)
  const time = num(raw.time)
  if (!ser || lat === undefined || lon === undefined || time === undefined) return null
  if (time < 1577836800 /* 2020-01-01 */ || time * 1000 > Date.now() + 3600_000) return null

  return {
    lat, lon, time, ser,
    id: typeof raw.id === 'string' ? raw.id : undefined,
    alt: num(raw.alt),
    vs: num(raw.vs),
    climb: num(raw.climb),
    hs: num(raw.hs),
    dir: num(raw.dir),
    temp: num(raw.temp),
    humidity: num(raw.humidity),
    pressure: num(raw.pressure),
    type: typeof raw.type === 'string' ? raw.type : undefined,
    frame: num(raw.frame),
    sats: num(raw.sats),
    freq: num(raw.freq),
    rssi: num(raw.rssi),
    afc: num(raw.afc),
    batt: num(raw.batt),
    launchsite: typeof raw.launchsite === 'string' ? raw.launchsite : undefined,
  }
}

export function parseRdzUptime(payload: string): RdzUptime | null {
  let raw: Record<string, unknown>
  try { raw = JSON.parse(payload) } catch { return null }
  if (typeof raw !== 'object' || raw === null) return null
  const uptime = num(raw.uptime)
  if (uptime === undefined) return null
  // dev2 publica `uptime` em SEGUNDOS e traz o campo `time` (string UTC);
  // o master antigo publicava millis e não tem `time`. O campo `time` é o
  // discriminador confiável (a faixa numérica sozinha é ambígua).
  const isSeconds = typeof raw.time === 'string'
  return {
    uptimeMs: isSeconds ? uptime * 1000 : uptime,
    user: typeof raw.user === 'string' ? raw.user : undefined,
    rxlat: num(raw.rxlat),
    rxlon: num(raw.rxlon),
    SW: typeof raw.SW === 'string' ? raw.SW : undefined,
    VER: typeof raw.VER === 'string' ? raw.VER : undefined,
    batt: num(raw.batt) ?? num(raw.vbatt),
    ip: typeof raw.ip === 'string' && IPV4_RE.test(raw.ip) ? raw.ip : undefined,
    publishedUtc: typeof raw.time === 'string' ? raw.time : undefined,
  }
}

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

// O firmware guarda o RSSI cru do SX127x, onde dBm = -raw/2 (é assim que o
// display do TTGO exibe). VERIFICAR com payload real no primeiro voo (passo
// de verificação do plano) — se o valor cru já vier negativo, é dBm direto.
export function rdzRssiToDbm(raw: number): number {
  return raw > 0 ? -raw / 2 : raw
}

// Tópicos de config completa (novos, ver docs/DEEP_SLEEP_V2_GUIDE.md e
// conn-mqtt.cpp do firmware) — request/response, NÃO retidos de propósito:
// um {prefix}config retido ficaria "fantasma" assim que alguém editasse a
// config pelo canal HTTP local (que não passa por MQTT), sem nenhum sinal
// visível de que o valor mostrado no app já não é o real. Cada requisição
// carrega um `reqId` (correlaciona a resposta) gerado no momento do pedido —
// nunca reusar um reqId entre requisições.
export function cfgGetTopic(prefix: string): string { return `${prefix}cfg/get` }
export function cfgGetRespTopic(prefix: string): string { return `${prefix}cfg/getresp` }
export function cfgSetTopic(prefix: string): string { return `${prefix}cfg/set` }
export function cfgSetRespTopic(prefix: string): string { return `${prefix}cfg/setresp` }

export interface CfgGetResp {
  reqId: string
  config: RdzConfig | null
  error?: string
}

export interface CfgSetResp {
  reqId: string
  ok: boolean
  error?: string
  rebooting?: boolean
}

export function parseCfgGetResp(payload: string): CfgGetResp | null {
  let raw: Record<string, unknown>
  try { raw = JSON.parse(payload) } catch { return null }
  if (typeof raw !== 'object' || raw === null) return null
  const reqId = typeof raw.reqId === 'string' ? raw.reqId : null
  if (!reqId) return null
  return {
    reqId,
    config: parseConfigJson(raw.config),
    error: typeof raw.error === 'string' ? raw.error : undefined,
  }
}

export function parseCfgSetResp(payload: string): CfgSetResp | null {
  let raw: Record<string, unknown>
  try { raw = JSON.parse(payload) } catch { return null }
  if (typeof raw !== 'object' || raw === null) return null
  const reqId = typeof raw.reqId === 'string' ? raw.reqId : null
  if (!reqId || typeof raw.ok !== 'boolean') return null
  return {
    reqId,
    ok: raw.ok,
    error: typeof raw.error === 'string' ? raw.error : undefined,
    rebooting: raw.rebooting === true,
  }
}

// HMAC-SHA256(cfgsecret, reqId+"|"+JSON(changes)) truncado a 16 hex — prova
// de posse do segredo configurado localmente no firmware (Config → mqtt via
// HTTP na LAN) sem nunca colocar o segredo em si no wire do broker público.
// Web Crypto (SubtleCrypto) só existe em contexto seguro (https/localhost),
// o que já é verdade sempre que MQTT-over-WSS também está disponível.
export async function computeCfgAuth(secret: string, reqId: string, changesJson: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${reqId}|${changesJson}`))
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
}

// Converte um packet MQTT pro shape que o pipeline sticky/merge já consome.
// Por construção o tópico é do usuário, então uploaderCallsign = callsign dele.
export function rdzPacketToSonde(p: RdzPacket, callsign: string): NearbySonde {
  return {
    serial: (p.ser ?? p.id)!,
    lat: p.lat,
    lon: p.lon,
    alt: p.alt ?? 0,
    vel_v: p.climb ?? p.vs ?? 0,
    datetime: new Date(p.time * 1000).toISOString(),
    frequency: p.freq,
    type: p.type,
    uploaderCallsign: callsign,
    rssi: p.rssi !== undefined ? rdzRssiToDbm(p.rssi) : undefined,
    battV: p.batt,
  }
}
