import { NextResponse } from 'next/server'
import { readTelegramSettings } from '@/app/lib/blobStore'
import { sendTelegramMessage, sendTelegramPhoto } from '@/app/lib/telegramClient'
import { renderStaticMapPng } from '@/app/lib/staticMap'
import { buildEventText } from '@/app/lib/telegramMessage'
import { DEFAULT_STATION } from '@/app/lib/stations'

// Bounding box aproximado do Rio Grande do Norte (Brasil) — só pra sortear
// um ponto plausível dentro do estado a cada teste, sem depender de nenhum
// voo real.
const RN_LAT_MIN = -6.98, RN_LAT_MAX = -4.83
const RN_LON_MIN = -38.35, RN_LON_MAX = -34.97

function randomRNPoint(): { lat: number; lon: number } {
  return {
    lat: RN_LAT_MIN + Math.random() * (RN_LAT_MAX - RN_LAT_MIN),
    lon: RN_LON_MIN + Math.random() * (RN_LON_MAX - RN_LON_MIN),
  }
}

async function sendTestEvent(
  botToken: string, chatId: string, event: 'launch' | 'landing',
): Promise<{ ok: boolean; error?: string; withPhoto: boolean }> {
  const station = DEFAULT_STATION
  const pos = randomRNPoint()

  const text = buildEventText({
    event, sondeNumber: 'W12345 [teste]',
    lat: pos.lat, lon: pos.lon,
    altitude: event === 'launch' ? 850 : 320,
    climbing: event === 'launch' ? 5.2 : -1.1,
    frequencyMHz: 403.2,
    source: 'sondehub',
    lastReportUtc: new Date().toISOString().slice(0, 19).replace('T', ' ') + 'z',
    stationId: station.id, stationName: station.name, stationLat: station.lat, stationLon: station.lon,
    areaName: event === 'landing' ? 'Área de exemplo' : undefined,
  })

  const png = await renderStaticMapPng({
    centerLat: pos.lat, centerLon: pos.lon,
    markers: [
      { lat: pos.lat, lon: pos.lon, color: event === 'launch' ? '#22c55e' : '#ef4444' },
      { lat: station.lat, lon: station.lon, color: '#3b82f6' },
    ],
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
export async function POST() {
  const s = await readTelegramSettings()
  if (!s?.botToken || !s?.chatId) {
    return NextResponse.json({ error: 'Configure o bot token e o chat ID antes de testar.' }, { status: 400 })
  }

  const [launch, landing] = await Promise.all([
    sendTestEvent(s.botToken, s.chatId, 'launch'),
    sendTestEvent(s.botToken, s.chatId, 'landing'),
  ])
  if (!launch.ok) return NextResponse.json({ error: launch.error || 'Falha ao enviar o teste de lançamento' }, { status: 502 })
  if (!landing.ok) return NextResponse.json({ error: landing.error || 'Falha ao enviar o teste de pouso' }, { status: 502 })

  return NextResponse.json({ ok: true, withPhoto: launch.withPhoto && landing.withPhoto })
}
