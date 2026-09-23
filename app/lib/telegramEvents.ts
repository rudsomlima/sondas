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
import { renderStaticMapPng } from './staticMap'
import { buildEventText, type EventMessageParams } from './telegramMessage'

export type EventNotifyResult =
  | { ok: true; sent: boolean; reason?: string }
  | { ok: false; error: string }

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

  const text = buildEventText({ ...p, areaName: match?.name })

  let sendResult: { ok: boolean; error?: string }
  if (hasPos) {
    const markers = [{ lat, lon, color: p.event === 'launch' ? '#22c55e' : '#ef4444' }]
    if (hasStationPos) markers.push({ lat: stationLat, lon: stationLon, color: '#3b82f6' })
    const png = await renderStaticMapPng({ centerLat: lat, centerLon: lon, markers })
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
