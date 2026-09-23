/**
 * Envio de mensagens via Telegram Bot API. Server-only (o bot token nunca
 * pode chegar ao navegador) — chamado só de app/api/telegram-*.
 */
export async function sendTelegramMessage(
  botToken: string, chatId: string, text: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) return { ok: false, error: json?.description || `HTTP ${res.status}` }
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'falha de rede ao chamar o Telegram' }
  }
}

// Legenda de foto no Telegram tem limite de 1024 caracteres (bem menor que
// os 4096 de uma mensagem de texto normal) — truncar em vez de deixar a API
// rejeitar a chamada inteira.
const CAPTION_MAX = 1024

export async function sendTelegramPhoto(
  botToken: string, chatId: string, photo: Buffer, caption: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const form = new FormData()
    form.append('chat_id', chatId)
    form.append('caption', caption.length > CAPTION_MAX ? caption.slice(0, CAPTION_MAX - 1) + '…' : caption)
    form.append('parse_mode', 'HTML')
    form.append('photo', new Blob([Uint8Array.from(photo)], { type: 'image/png' }), 'map.png')
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, { method: 'POST', body: form })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) return { ok: false, error: json?.description || `HTTP ${res.status}` }
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'falha de rede ao enviar a foto pro Telegram' }
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
