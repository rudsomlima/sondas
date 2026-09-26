import { NextResponse } from 'next/server'
import { readTelegramSettings } from '@/app/lib/blobStore'
import { sendTelegramMessage, sendTelegramPhoto } from '@/app/lib/telegramClient'
import { lookupLandingPlace, renderStaticMapPng } from '@/app/lib/staticMap'
import { buildEventText, buildReceiverAlertText } from '@/app/lib/telegramMessage'
import { DEFAULT_STATION } from '@/app/lib/stations'
import type { TelegramMessageTemplateKey, TelegramMessageTemplates } from '@/app/lib/telegramTypes'

// Bounding box aproximado do Rio Grande do Norte (Brasil), usado para sortear
// o ponto do teste de lançamento. O teste de pouso usa um ponto fixo urbano
// validado para sempre demonstrar o rótulo de município no mapa.
const RN_LAT_MIN = -6.98, RN_LAT_MAX = -4.83
const RN_LON_MIN = -38.35, RN_LON_MAX = -34.97
const RN_LANDING_TEST_POINT = { lat: -5.91, lon: -35.25 }

function randomRNPoint(): { lat: number; lon: number } {
  return {
    lat: RN_LAT_MIN + Math.random() * (RN_LAT_MAX - RN_LAT_MIN),
    lon: RN_LON_MIN + Math.random() * (RN_LON_MAX - RN_LON_MIN),
  }
}

async function sendTestEvent(
  botToken: string, chatId: string, event: 'launch' | 'landing', templates?: TelegramMessageTemplates,
): Promise<{ ok: boolean; error?: string; withPhoto: boolean }> {
  const station = DEFAULT_STATION
  const pos = event === 'landing' ? RN_LANDING_TEST_POINT : randomRNPoint()
  const place = event === 'landing' ? await lookupLandingPlace(pos.lat, pos.lon) : null
  const city = event === 'landing' ? place?.city ?? 'Parnamirim-RN' : undefined

  const text = buildEventText({
    event, sondeNumber: 'W12345 [teste]',
    lat: pos.lat, lon: pos.lon,
    altitude: event === 'launch' ? 850 : 320,
    climbing: event === 'launch' ? 5.2 : -1.1,
    frequencyMHz: 403.2,
    source: 'sondehub',
    city,
    lastReportUtc: new Date().toISOString().slice(0, 19).replace('T', ' ') + 'z',
    stationId: station.id, stationName: station.name, stationLat: station.lat, stationLon: station.lon,
    areaName: event === 'landing' ? 'Área de exemplo' : undefined,
  }, templates)

  const png = await renderStaticMapPng({
    centerLat: pos.lat, centerLon: pos.lon,
    markers: [
      { lat: pos.lat, lon: pos.lon, color: event === 'launch' ? '#22c55e' : '#ef4444', label: city },
      { lat: station.lat, lon: station.lon, color: '#3b82f6' },
    ],
    ...(place?.atSea ? { zoom: 3 } : {}),
  })

  const result = png
    ? await sendTelegramPhoto(botToken, chatId, png, text)
    : await sendTelegramMessage(botToken, chatId, text)
  return { ...result, withPhoto: !!png }
}

// Manda as DUAS mensagens de teste (lançamento + pouso), cada uma num ponto
// aleatório do Rio Grande do Norte, no formato EXATO (texto + mapa com pino)
// que /api/telegram-notify manda de verdade — confirma bot, chat ID e a
// geração da imagem de uma vez. As duas rodam em paralelo (cada uma busca
// ~30-40 tiles do OpenStreetMap e monta a imagem com sharp antes de subir
// pro Telegram — por isso demora alguns segundos, é normal).
async function processTest(req: Request) {
  const s = await readTelegramSettings()
  if (!s?.botToken || !s?.chatId) {
    return NextResponse.json({ error: 'Configure o bot token e o chat ID antes de testar.' }, { status: 400 })
  }
  let body: { templateKey?: TelegramMessageTemplateKey; template?: string } = {}
  try { body = await req.json() } catch { /* botão de teste antigo sem corpo: padrão = lançamento */ }
  const allowed: TelegramMessageTemplateKey[] = ['launch', 'landing', 'receiverOffline', 'receiverOnline', 'lowBattery', 'batteryOk']
  const templateKey = allowed.includes(body.templateKey as TelegramMessageTemplateKey) ? body.templateKey! : 'launch'
  const templates: TelegramMessageTemplates = { ...(s.messageTemplates ?? {}) }
  if (typeof body.template === 'string') templates[templateKey] = body.template.slice(0, 4000)

  if (templateKey === 'launch' || templateKey === 'landing') {
    const result = await sendTestEvent(s.botToken, s.chatId, templateKey, templates)
    if (!result.ok) return NextResponse.json({ error: result.error || 'Falha ao enviar a mensagem de teste' }, { status: 502 })
    return NextResponse.json({ ok: true, withPhoto: result.withPhoto })
  }

  const alertKind = templateKey === 'receiverOffline' ? 'offline'
    : templateKey === 'receiverOnline' ? 'online'
      : templateKey === 'lowBattery' ? 'lowBattery' : 'batteryOk'
  const text = buildReceiverAlertText(alertKind, 'RX-CASA', { minutesSilent: 32, vBatt: 3.42 }, templates)
  const result = await sendTelegramMessage(s.botToken, s.chatId, text)
  if (!result.ok) return NextResponse.json({ error: result.error || 'Falha ao enviar a mensagem de teste' }, { status: 502 })
  return NextResponse.json({ ok: true, withPhoto: false })
}

export async function POST(req: Request) {
  try {
    return await processTest(req)
  } catch (e) {
    console.error('[telegram-test] falha inesperada:', e)
    return NextResponse.json({ error: 'Erro interno ao preparar ou enviar o teste. Verifique a configuração e tente novamente.' }, { status: 500 })
  }
}
