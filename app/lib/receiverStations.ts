/**
 * Estações receptoras (quem sobe telemetria de sonda pro SondeHub) — posição,
 * antena, software e último contato — guardadas no R2 em
 * `sondas/receiver-stations.json` e desenhadas em todos os mapas que têm
 * sondas que elas receberam.
 *
 * Duas fontes (sondeSources.ts):
 *  - SondeHub `/listeners/telemetry` — estações ATIVAS (último contato,
 *    posição, antena, software);
 *  - os quadros de cada sonda (`uploader_position` por quadro) — cobre
 *    também estações que já não estão ativas.
 *
 * Módulo puro: tipos e mesclagem.
 */

export type ReceiverStationSource = 'sondehub-listener' | 'sondehub-frame'

export interface ReceiverStation {
  callsign: string
  lat: number
  lon: number
  alt?: number
  antenna?: string
  software?: string // "rdzTTGOsonde dev20260916.1"
  lastSeenAt?: string // ISO UTC — último contato conhecido
  sources: ReceiverStationSource[]
  updatedAt: number
}

export interface ReceiverStationsFile {
  updatedAt: number
  // Última consulta ao /listeners/telemetry (epoch ms) — o cron só repete
  // depois de algumas horas (a resposta tem ~400 KB, o mundo todo).
  listenersCheckedAt?: number
  stations: Record<string, ReceiverStation> // chave: callsign em maiúsculas
}

export function stationKey(callsign: string): string {
  return callsign.trim().toUpperCase()
}

function ms(iso?: string): number {
  const t = iso ? new Date(iso).getTime() : NaN
  return Number.isFinite(t) ? t : 0
}

/**
 * Mescla aditiva: posição/antena/software do dado com último contato mais
 * recente; campos vazios nunca apagam um valor conhecido.
 */
export function mergeStations(a: ReceiverStation | undefined, b: ReceiverStation): ReceiverStation {
  if (!a) return { ...b, sources: [...b.sources] }
  const newer = ms(b.lastSeenAt) >= ms(a.lastSeenAt) ? b : a
  const older = newer === b ? a : b
  return {
    callsign: a.callsign,
    lat: newer.lat,
    lon: newer.lon,
    alt: newer.alt ?? older.alt,
    antenna: newer.antenna || older.antenna,
    software: newer.software || older.software,
    lastSeenAt: newer.lastSeenAt ?? older.lastSeenAt,
    sources: [...new Set([...a.sources, ...b.sources])],
    updatedAt: Math.max(a.updatedAt, b.updatedAt),
  }
}

export function sameStation(a: ReceiverStation | undefined, b: ReceiverStation): boolean {
  if (!a) return false
  return JSON.stringify({ ...a, updatedAt: 0 }) === JSON.stringify({ ...b, updatedAt: 0 })
}

/** "-5.83578,-35.2238" ou [lat, lon, alt] (o SondeHub usa os dois formatos). */
export function parseUploaderPosition(value: unknown): { lat: number; lon: number; alt?: number } | null {
  let lat: number, lon: number, alt: number | undefined
  if (Array.isArray(value)) {
    [lat, lon, alt] = value.map(Number)
  } else if (typeof value === 'string') {
    [lat, lon, alt] = value.split(',').map(v => parseFloat(v))
  } else return null
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  if (lat === 0 && lon === 0) return null
  return { lat, lon, alt: Number.isFinite(alt) ? alt : undefined }
}
