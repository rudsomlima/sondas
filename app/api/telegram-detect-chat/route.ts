import { NextRequest, NextResponse } from 'next/server'
import { readTelegramSettings } from '@/app/lib/blobStore'

/**
 * "Bad Request: chat not found" no teste é quase sempre o chat ID errado —
 * o Telegram só permite que um bot mande mensagem pra quem já mandou
 * mensagem PRA ELE antes (ou que já adicionou o bot a um grupo). Em vez de
 * pedir pro usuário caçar o ID manualmente, chamamos getUpdates com o bot
 * token já salvo e devolvemos o chat mais recente que falou com o bot.
 *
 * Body opcional `{ type: 'private' }`: só considera conversas privadas (usado
 * pelos alertas do sistema, que nunca vão pro grupo).
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const onlyPrivate = body?.type === 'private'
  const s = await readTelegramSettings()
  if (!s?.botToken) {
    return NextResponse.json({ error: 'Salve o bot token primeiro.' }, { status: 400 })
  }
  let json: any
  try {
    const res = await fetch(`https://api.telegram.org/bot${s.botToken}/getUpdates?limit=50`, { cache: 'no-store' })
    json = await res.json()
    if (!res.ok || !json?.ok) throw new Error(json?.description || `HTTP ${res.status}`)
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Falha ao consultar o Telegram.' }, { status: 502 })
  }

  const updates = Array.isArray(json.result) ? json.result : []
  const chatOf = (u: any) => u.message?.chat ?? u.my_chat_member?.chat
  const last = [...updates].reverse().find((u: any) => {
    const c = chatOf(u)
    return c && (!onlyPrivate || c.type === 'private')
  })
  const chat = last ? chatOf(last) : null
  if (!chat) {
    return NextResponse.json({
      error: onlyPrivate
        ? 'Nenhuma conversa privada encontrada. Abra o bot no Telegram (sem ser no grupo), envie /start e tente de novo.'
        : 'Nenhuma conversa encontrada. Abra o chat com o bot no Telegram, mande qualquer mensagem (ex.: /start) e tente de novo.',
    }, { status: 404 })
  }
  const label = chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || String(chat.id)
  return NextResponse.json({ ok: true, chatId: String(chat.id), label })
}
