/**
 * Envio de aviso de lançamento/pouso no Telegram — regra única usada por
 * /api/telegram-notify (detecção no navegador) e pelo cron /api/poll
 * (detecção no servidor, sem ninguém com o app aberto). O dedup em R2
 * (markNotifiedIfNew) garante uma só mensagem por evento mesmo com as duas
 * fontes detectando a mesma transição. Servidor-only.
 */
import { readTelegramSettings, readGeofences, markNotifiedIfNew } from './blobStore'
import { sendTelegramMessage, sendTelegramPhoto } from './telegramClient'
import { findMatchingGeofence } from './geofence'
import { lookupLandingPlace, renderStaticMapPng, type MapMarker } from './staticMap'
import { buildEventText, type EventMessageParams } from './telegramMessage'
import { fetchSondeHubRawFrames } from './sondehub'

export type EventNotifyResult =
  | { ok: true; sent: boolean; reason?: string }
  | { ok: false; error: string }

const FIRST_FRAME_TIMEOUT_MS = 4000
const FIRST_FRAME_WINDOW_MS = 6 * 60 * 60_000 // ignora quadros soltos de voos antigos da mesma sonda

/**
 * Primeiro quadro do voo no SondeHub. Melhor esforço: qualquer falha ou
 * demora devolve null e o aviso sai sem essa linha (nunca atrasa o aviso).
 */
async function fetchFirstFrame(
  serial: string, lastReportUtc: string | undefined, currentAlt: number | undefined,
): Promise<Pick<EventMessageParams, 'firstAltitude' | 'firstFrameUtc' | 'firstReceiver'> | null> {
  try {
    const frames = await Promise.race([
      fetchSondeHubRawFrames(serial),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), FIRST_FRAME_TIMEOUT_MS)),
    ])
    const refMs = lastReportUtc
      ? new Date(lastReportUtc.replace(/z$/i, '').replace(' ', 'T') + 'Z').getTime()
      : Date.now()
    const recent = frames
      .map(f => ({ f, ms: new Date(f.datetime).getTime() }))
      .filter(x => !isNaN(x.ms) && Math.abs(refMs - x.ms) <= FIRST_FRAME_WINDOW_MS)
      .sort((a, b) => a.ms - b.ms)
    const first = recent[0]
    if (!first) return null
    if (typeof currentAlt === 'number' && Math.abs(first.f.alt - currentAlt) < 1) return null // é o próprio quadro atual
    const iso = new Date(first.ms).toISOString() // 2026-09-24T11:31:20.000Z
    return {
      firstAltitude: first.f.alt,
      firstFrameUtc: `${iso.slice(0, 10)} ${iso.slice(11, 19)}z`,
      firstReceiver: first.f.uploaderCallsign !== '?' ? first.f.uploaderCallsign : undefined,
    }
  } catch {
    return null
  }
}

export async function notifyFlightEvent(p: EventMessageParams): Promise<EventNotifyResult> {
  const settings = await readTelegramSettings()
  if (!settings?.enabled || !settings.botToken || !settings.chatId) {
    return { ok: true, sent: false, reason: 'telegram desativado ou não configurado' }
  }
  if (p.event === 'launch' && settings.notifyLaunch === false) return { ok: true, sent: false }
  if (p.event === 'landing' && settings.notifyLanding === false) return { ok: true, sent: false }

  const { lat, lon, stationLat, stationLon } = p
  const hasPos = typeof lat === 'number' && typeof lon === 'number'
  const hasStationPos = typeof stationLat === 'number' && typeof stationLon === 'number'

  // Pouso: com "avisar em qualquer lugar" desligado, só notifica se caiu
  // DENTRO de alguma área de interesse cadastrada — resolve isso ANTES do
  // dedup pra não "queimar" o evento sem nunca ter mandado a mensagem.
  const geofencesFile = p.event === 'landing' && hasPos ? await readGeofences() : null
  const match = geofencesFile && hasPos ? findMatchingGeofence(lat, lon, geofencesFile.areas ?? []) : null
  if (p.event === 'landing' && settings.notifyAnywhere === false && !match) {
    return { ok: true, sent: false, reason: 'fora das áreas de interesse cadastradas' }
  }

  const isNew = await markNotifiedIfNew(p.sondeNumber, p.event)
  if (!isNew) return { ok: true, sent: false, reason: 'já notificado' }

  const first = p.event === 'launch' ? await fetchFirstFrame(p.sondeNumber, p.lastReportUtc, p.altitude) : null
  const landingPlace = p.event === 'landing' && hasPos ? await lookupLandingPlace(lat, lon) : null
  const text = buildEventText({ ...p, ...first, city: landingPlace?.city, areaName: match?.name }, settings.messageTemplates)

  let sendResult: { ok: boolean; error?: string }
  if (hasPos) {
    const markers: MapMarker[] = [{ lat, lon, color: p.event === 'launch' ? '#22c55e' : '#ef4444', label: p.event === 'landing' ? landingPlace?.city : undefined }]
    if (hasStationPos) markers.push({ lat: stationLat, lon: stationLon, color: '#3b82f6' })
    const png = await renderStaticMapPng({ centerLat: lat, centerLon: lon, markers, ...(landingPlace?.atSea ? { zoom: 3 } : {}) })
    sendResult = png
      ? await sendTelegramPhoto(settings.botToken, settings.chatId, png, text)
      : await sendTelegramMessage(settings.botToken, settings.chatId, text)
    // Foto rejeitada pelo Telegram — tenta texto puro antes de desistir.
    if (!sendResult.ok && png) sendResult = await sendTelegramMessage(settings.botToken, settings.chatId, text)
  } else {
    sendResult = await sendTelegramMessage(settings.botToken, settings.chatId, text)
  }

  if (!sendResult.ok) return { ok: false, error: sendResult.error ?? 'falha ao enviar' }
  return { ok: true, sent: true }
}
