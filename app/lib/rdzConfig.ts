/**
 * Schema/parsing da configuração completa do firmware rdzTTGOsonde
 * (config_list[] em RX_FSK/RX_FSK.ino, struct RDZConfig em RX_FSK/src/Sonde.h
 * do projeto rdz_ttgo_sonde). Módulo puro (sem 'use client'), compartilhado
 * pelos dois canais de acesso (HTTP local via /dlconfig, MQTT via
 * {prefix}cfg/getresp — ver app/lib/mqtt.ts) — os dois produzem/consomem o
 * mesmo formato `RdzConfig` definido aqui.
 *
 * O firmware grava a config como texto `chave=valor` (uma por linha, `#`
 * inicia comentário) em /config.txt — ver Sonde::setConfig em Sonde.cpp.
 * Tipos por campo (config_list[i].type): 0/-2/-3/-4 = inteiro; i>0 = string
 * de tamanho máximo i; -6 = lista de int8 separada por vírgula; -7 = double
 * (vazio ou "0" grava NaN no firmware — string vazia aqui significa "sem
 * valor definido", não numericamente zero).
 */

export type RdzConfigValue = string

// Mapa chave -> valor (sempre string, exatamente como no config.txt/no
// wire MQTT — a UI converte pro tipo certo por campo via rdzConfigSections.ts).
export type RdzConfig = Record<string, RdzConfigValue>

// Linhas do /config.txt: "chave = valor", '#' inicia comentário, linhas em
// branco ignoradas. Espelha o trim de Sonde::setConfig (Sonde.cpp:456-463).
export function parseConfigTxt(text: string): RdzConfig {
  const out: RdzConfig = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim()
    if (!key) continue
    out[key] = value
  }
  return out
}

// Reconstrói o config.txt completo (base + diff) pra reenviar via /ulconfig
// — sempre o arquivo inteiro, nunca só as linhas alteradas, porque o
// firmware substitui /config.txt por completo no upload (RX_FSK.ino,
// handleConfigUpload). Preserva a ordem original de `base` e acrescenta ao
// final quaisquer chaves novas presentes só em `changes` (não deveria
// acontecer na prática, já que o editor só edita chaves já carregadas).
export function configTxtFromChanges(base: RdzConfig, changes: Record<string, string>): string {
  const merged: RdzConfig = { ...base, ...changes }
  const keys = [...Object.keys(base), ...Object.keys(changes).filter(k => !(k in base))]
  return keys.map(k => `${k}=${merged[k] ?? ''}`).join('\n') + '\n'
}

// Parseia o payload JSON de {prefix}cfg/getresp (canal MQTT) — já vem como
// mapa chave->valor (valores sempre serializados como string pelo firmware,
// mesmo os numéricos, pra usar o mesmo `RdzConfig` dos dois canais). Parsing
// defensivo: broker público, payload pode ser lixo ou de outro dispositivo.
export function parseConfigJson(payload: unknown): RdzConfig | null {
  if (typeof payload !== 'object' || payload === null) return null
  const out: RdzConfig = {}
  for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v
    else if (typeof v === 'number' && isFinite(v)) out[k] = String(v)
    else continue // ignora chaves com valor de tipo inesperado
  }
  return out
}

// Campos que carregam credenciais — o app nunca deve tentar exibi-los em
// texto puro mesmo que um payload malformado os traga preenchidos (o
// firmware já redige isso no canal MQTT; esta é uma segunda camada no app).
export const SENSITIVE_KEYS = new Set(['mqtt.password', 'mqtt.username', 'mqtt.cfgsecret', 'passcode'])

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key)
}
