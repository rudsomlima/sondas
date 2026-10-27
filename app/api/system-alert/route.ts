import { NextRequest, NextResponse } from 'next/server'
import { readTelegramSettings } from '@/app/lib/blobStore'
import { sendTelegramMessage } from '@/app/lib/telegramClient'

/**
 * Alertas do SISTEMA (cron parado, falha de armazenamento) — vão só pra
 * conversa privada `adminChatId`, nunca pro grupo dos avisos de sonda.
 *
 * Protegida pelo mesmo CRON_SECRET do /api/poll (chamada só pelos scripts da
 * VM em deploy/oracle/):
 * - GET  → { botToken, adminChatId } pro watchdog.sh guardar uma cópia local e
 *   conseguir avisar mesmo com o app fora do ar. Por isso exige o segredo.
 * - POST { text } → envia pro adminChatId.
 */
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const auth = req.headers.get('authorization')
  return auth === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const s = await readTelegramSettings()
  if (!s?.botToken || !s.adminChatId) {
    return NextResponse.json({ ok: false, error: 'alertas do sistema não configurados' }, { status: 404 })
  }
  return NextResponse.json({ ok: true, botToken: s.botToken, adminChatId: s.adminChatId }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null)
  const text = typeof body?.text === 'string' ? body.text.slice(0, 4000) : ''
  if (!text) return NextResponse.json({ ok: false, error: 'texto vazio' }, { status: 400 })
  const s = await readTelegramSettings()
  if (!s?.botToken || !s.adminChatId) {
    return NextResponse.json({ ok: false, error: 'alertas do sistema não configurados' }, { status: 404 })
  }
  const r = await sendTelegramMessage(s.botToken, s.adminChatId, text)
  return NextResponse.json(r, { status: r.ok ? 200 : 502 })
}
