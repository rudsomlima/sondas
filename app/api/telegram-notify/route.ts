import { NextRequest, NextResponse } from 'next/server'
import { readTelegramSettings, readGeofences, markNotifiedIfNew } from '@/app/lib/blobStore'
import { sendTelegramMessage, sendTelegramPhoto } from '@/app/lib/telegramClient'
import { findMatchingGeofence } from '@/app/lib/geofence'
import { renderStaticMapPng } from '@/app/lib/staticMap'
import { buildEventText } from '@/app/lib/telegramMessage'

/**
 * Recebe um evento "lançamento"/"pouso" detectado no navegador (ver
 * app/painel/hooks/useLaunchLandingWatcher.ts) e decide se manda a mensagem
 * no Telegram: config precisa estar ligada + o evento correspondente
 * habilitado, e o dedup (R2) precisa aceitar (evita duplicar quando mais de
 * uma aba detecta a mesma transição). O bot token nunca sai do servidor.
 *
 * Mensagem sempre com foto quando dá: monta um mapa (tiles OSM + pino) em
 * app/lib/staticMap.ts, sem depender de nenhuma API de terceiro. Se o mapa
 * falhar (sem internet do lado do servidor, OSM fora do ar), cai pra texto
 * puro — melhor um aviso sem imagem do que nenhum aviso.
 */
export async function POST(req: NextRequest) {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const {
    event, sondeNumber, lat, lon, altitude, climbing, frequencyMHz, source, lastReceiver, lastReportUtc,
    stationId, stationName, stationLat, stationLon,
  } = body ?? {}
  if ((event !== 'launch' && event !== 'landing') || typeof sondeNumber !== 'string' || !sondeNumber) {
    return NextResponse.json({ error: 'evento inválido' }, { status: 400 })
  }

  const settings = await readTelegramSettings()
  if (!settings?.enabled || !settings.botToken || !settings.chatId) {
    return NextResponse.json({ ok: true, sent: false, reason: 'telegram desativado ou não configurado' })
  }
  if (event === 'launch' && settings.notifyLaunch === false) return NextResponse.json({ ok: true, sent: false })
  if (event === 'landing' && settings.notifyLanding === false) return NextResponse.json({ ok: true, sent: false })

  const hasPos = typeof lat === 'number' && typeof lon === 'number'
  const hasStationPos = typeof stationLat === 'number' && typeof stationLon === 'number'

  // Pouso: com "avisar em qualquer lugar" desligado, só notifica se caiu
  // DENTRO de alguma área de interesse cadastrada — resolve isso ANTES do
  // dedup pra não "queimar" o evento sem nunca ter mandado a mensagem.
  const geofencesFile = event === 'landing' && hasPos ? await readGeofences() : null
  const match = geofencesFile ? findMatchingGeofence(lat, lon, geofencesFile.areas ?? []) : null
  if (event === 'landing' && settings.notifyAnywhere === false && !match) {
    return NextResponse.json({ ok: true, sent: false, reason: 'fora das áreas de interesse cadastradas' })
  }

  const isNew = await markNotifiedIfNew(sondeNumber, event)
  if (!isNew) return NextResponse.json({ ok: true, sent: false, reason: 'já notificado' })

  const text = buildEventText({
    event, sondeNumber, lat, lon, altitude, climbing, frequencyMHz, source, lastReceiver, lastReportUtc,
    stationId, stationName, stationLat, stationLon, areaName: match?.name,
  })

  let sendResult: { ok: boolean; error?: string }
  if (hasPos) {
    const markers = [{ lat, lon, color: event === 'launch' ? '#22c55e' : '#ef4444' }]
    if (hasStationPos) markers.push({ lat: stationLat, lon: stationLon, color: '#3b82f6' })
    const png = await renderStaticMapPng({ centerLat: lat, centerLon: lon, markers })
    sendResult = png
      ? await sendTelegramPhoto(settings.botToken, settings.chatId, png, text)
      : await sendTelegramMessage(settings.botToken, settings.chatId, text)
    // Foto falhou por algum motivo do lado do Telegram (ex.: arquivo
    // rejeitado) — tenta como texto puro antes de desistir do aviso.
    if (!sendResult.ok && png) sendResult = await sendTelegramMessage(settings.botToken, settings.chatId, text)
  } else {
    sendResult = await sendTelegramMessage(settings.botToken, settings.chatId, text)
  }

  if (!sendResult.ok) return NextResponse.json({ error: sendResult.error }, { status: 502 })
  return NextResponse.json({ ok: true, sent: true })
}
