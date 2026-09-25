import { NextRequest, NextResponse } from 'next/server'
import { DEFAULT_STATION } from '@/app/lib/stations'
import { readTelegramSettings, writeTelegramSettings } from '@/app/lib/blobStore'

/**
 * Configurações do bot do Telegram (R2 `sondas/telegram-settings.json`).
 * O botToken NUNCA volta pro navegador em texto puro (só se está configurado
 * + os últimos dígitos, pra conferência) — só é regravado quando o POST
 * manda um valor novo; campo vazio mantém o token já salvo.
 */
export async function GET() {
  try {
    const s = await readTelegramSettings()
    return NextResponse.json({
      chatId: s?.chatId ?? '',
      enabled: s?.enabled ?? false,
      notifyLaunch: s?.notifyLaunch !== false,
      notifyLanding: s?.notifyLanding !== false,
      notifyAnywhere: s?.notifyAnywhere !== false,
      notifyReceiverOffline: s?.notifyReceiverOffline !== false,
      notifyReceiverOnline: s?.notifyReceiverOnline ?? s?.notifyReceiverOffline !== false,
      receiverOfflineMinutes: s?.receiverOfflineMinutes ?? 30,
      notifyLowBattery: s?.notifyLowBattery !== false,
      notifyBatteryOk: s?.notifyBatteryOk ?? s?.notifyLowBattery !== false,
      lowBatteryVoltage: s?.lowBatteryVoltage ?? 3.5,
      watchedStationIds: s?.watchedStationIds ?? [DEFAULT_STATION.id],
      stationRadiusKm: s?.stationRadiusKm ?? {},
      messageTemplates: s?.messageTemplates ?? {},
      hasToken: !!s?.botToken,
      tokenPreview: s?.botToken ? `…${s.botToken.slice(-6)}` : '',
      updatedAt: s?.updatedAt ?? 0,
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[telegram-settings] falha ao carregar:', e)
    return NextResponse.json({ error: 'Falha ao carregar as configurações do Telegram no armazenamento.' }, { status: 502 })
  }
}

async function processPost(req: NextRequest) {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const current = await readTelegramSettings()
  const botToken = typeof body?.botToken === 'string' && body.botToken.trim()
    ? body.botToken.trim()
    : (current?.botToken ?? '')
  const chatId = typeof body?.chatId === 'string' ? body.chatId.trim() : (current?.chatId ?? '')

  const numOr = (v: unknown, fallback: number) => typeof v === 'number' && isFinite(v) ? v : fallback

  const settings = {
    botToken,
    chatId,
    enabled: !!body?.enabled,
    notifyLaunch: body?.notifyLaunch !== false,
    notifyLanding: body?.notifyLanding !== false,
    notifyAnywhere: body?.notifyAnywhere !== false,
    notifyReceiverOffline: body?.notifyReceiverOffline !== false,
    notifyReceiverOnline: typeof body?.notifyReceiverOnline === 'boolean'
      ? body.notifyReceiverOnline
      : (current?.notifyReceiverOnline ?? current?.notifyReceiverOffline ?? true),
    receiverOfflineMinutes: numOr(body?.receiverOfflineMinutes, current?.receiverOfflineMinutes ?? 30),
    notifyLowBattery: body?.notifyLowBattery !== false,
    notifyBatteryOk: typeof body?.notifyBatteryOk === 'boolean'
      ? body.notifyBatteryOk
      : (current?.notifyBatteryOk ?? current?.notifyLowBattery ?? true),
    lowBatteryVoltage: numOr(body?.lowBatteryVoltage, current?.lowBatteryVoltage ?? 3.5),
    watchedStationIds: Array.isArray(body?.watchedStationIds)
      ? [...new Set<string>(body.watchedStationIds.filter((x: unknown): x is string => typeof x === 'string'))].slice(0, 60)
      : (current?.watchedStationIds ?? [DEFAULT_STATION.id]),
    stationRadiusKm: body?.stationRadiusKm && typeof body.stationRadiusKm === 'object'
      ? Object.fromEntries(Object.entries(body.stationRadiusKm as Record<string, unknown>)
          .filter(([, v]) => typeof v === 'number' && isFinite(v))
          .map(([k, v]) => [k, Math.min(Math.max(v as number, 10), 1000)]))
      : (current?.stationRadiusKm ?? {}),
    messageTemplates: body?.messageTemplates && typeof body.messageTemplates === 'object'
      ? Object.fromEntries(Object.entries(body.messageTemplates)
          .filter(([k, v]) => ['launch', 'landing', 'receiverOffline', 'receiverOnline', 'lowBattery', 'batteryOk'].includes(k) && typeof v === 'string')
          .map(([k, v]) => [k, (v as string).slice(0, 4000)]))
      : (current?.messageTemplates ?? {}),
    updatedAt: Date.now(),
  }
  try {
    await writeTelegramSettings(settings)
  } catch {
    return NextResponse.json({ error: 'falha ao gravar no R2' }, { status: 502 })
  }
  return NextResponse.json({ ok: true })
}

export async function POST(req: NextRequest) {
  try {
    return await processPost(req)
  } catch (e) {
    console.error('[telegram-settings] falha inesperada ao salvar:', e)
    return NextResponse.json({ error: 'Falha ao acessar o armazenamento das configurações do Telegram.' }, { status: 502 })
  }
}
