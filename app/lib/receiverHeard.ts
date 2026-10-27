/**
 * Aviso de lançamento vindo DIRETO do receptor do usuário: quando o rdzTTGOsonde
 * decodifica uma sonda nova, ele manda `heard` em /api/receiver-report e o
 * aviso sai em segundos, sem esperar o próximo ciclo do cron (/api/poll) nem o
 * atraso dos feeds do SondeHub/radiosondy.info.
 *
 * Mesma regra de envio do cron: `notifyFlightEvent` com o dedup
 * `markNotifiedIfNew` (sonda+evento, 24 h), então quem chegar primeiro avisa e o
 * outro não repete. Só vale pra estações monitoradas (`watchedStationIds`) e dentro
 * do raio configurado, igual ao cron.
 */
import { readTelegramSettings } from './blobStore'
import { SOUTH_AMERICA_STATIONS, DEFAULT_STATION } from './stations'
import { DEFAULT_WATCH_RADIUS_KM } from './telegramTypes'
import { haversineKm } from './geo'
import { notifyFlightEvent } from './telegramEvents'

export interface HeardSonde {
  serial: string
  lat: number
  lon: number
  alt: number
  freq?: number
  climb?: number
}

const SERIAL_RE = /^[A-Za-z0-9_-]{4,20}$/

/** Valida o objeto `heard` vindo do firmware; null se algo não faz sentido. */
export function parseHeard(raw: unknown): HeardSonde | null {
  const o = raw as Record<string, unknown> | null
  if (!o || typeof o !== 'object') return null
  const serial = typeof o.serial === 'string' ? o.serial.trim() : ''
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
  const lat = num(o.lat), lon = num(o.lon), alt = num(o.alt)
  if (!SERIAL_RE.test(serial) || lat == null || lon == null || alt == null) return null
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return null
  if (alt < -500 || alt > 60000) return null
  return { serial, lat, lon, alt, freq: num(o.freq), climb: num(o.climb) }
}

/** Avisa o lançamento se a sonda está no raio de alguma estação monitorada. Nunca lança. */
export async function notifyHeardSonde(h: HeardSonde): Promise<{ sent: boolean; reason?: string }> {
  try {
    const settings = await readTelegramSettings()
    if (!settings?.enabled) return { sent: false, reason: 'telegram desativado' }
    const watched = settings.watchedStationIds ?? [DEFAULT_STATION.id]
    const station = SOUTH_AMERICA_STATIONS
      .filter(s => watched.includes(s.id))
      .map(s => ({ s, d: haversineKm(s.lat, s.lon, h.lat, h.lon), r: settings.stationRadiusKm?.[s.id] ?? DEFAULT_WATCH_RADIUS_KM }))
      .filter(x => x.d <= x.r)
      .sort((a, b) => a.d - b.d)[0]?.s
    if (!station) return { sent: false, reason: 'fora das estações monitoradas' }
    const r = await notifyFlightEvent({
      event: 'launch', sondeNumber: h.serial, lat: h.lat, lon: h.lon, altitude: h.alt, climbing: h.climb,
      frequencyMHz: h.freq, source: 'receptor', lastReportUtc: new Date().toISOString().slice(0, 19).replace('T', ' ') + 'z',
      stationId: station.id, stationName: station.name, stationLat: station.lat, stationLon: station.lon,
    })
    if (!r.ok) console.error('[receiverHeard] aviso Telegram falhou:', r.error)
    return { sent: r.ok && r.sent === true, reason: 'reason' in r ? r.reason : undefined }
  } catch (e) {
    console.error('[receiverHeard] falhou:', e)
    return { sent: false, reason: 'erro' }
  }
}
