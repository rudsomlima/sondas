import { NextResponse } from 'next/server'
import { readTelegramSettings } from '@/app/lib/blobStore'

/**
 * "Bad Request: chat not found" no teste é quase sempre o chat ID errado —
 * o Telegram só permite que um bot mande mensagem pra quem já mandou
 * mensagem PRA ELE antes (ou que já adicionou o bot a um grupo). Em vez de
 * pedir pro usuário caçar o ID manualmente, chamamos getUpdates com o bot
 * token já salvo e devolvemos o chat mais recente que falou com o bot.
 */
export async function POST() {
  const s = await readTelegramSettings()
  if (!s?.botToken) {
    return NextResponse.json({ error: 'Salve o bot token primeiro.' }, { status: 400 })
  }
  let json: any
  try {
    const res = await fetch(`https://api.telegram.org/bot${s.botToken}/getUpdates?limit=20`, { cache: 'no-store' })
    json = await res.json()
    if (!res.ok || !json?.ok) throw new Error(json?.description || `HTTP ${res.status}`)
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Falha ao consultar o Telegram.' }, { status: 502 })
  }

  const updates = Array.isArray(json.result) ? json.result : []
  const last = [...updates].reverse().find((u: any) => u.message?.chat || u.my_chat_member?.chat)
  const chat = last?.message?.chat ?? last?.my_chat_member?.chat
  if (!chat) {
    return NextResponse.json({
      error: 'Nenhuma conversa encontrada. Abra o chat com o bot no Telegram, mande qualquer mensagem (ex.: /start) e tente de novo.',
    }, { status: 404 })
  }
  const label = chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || String(chat.id)
  return NextResponse.json({ ok: true, chatId: String(chat.id), label })
}
