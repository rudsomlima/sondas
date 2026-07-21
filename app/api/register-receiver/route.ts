import { NextRequest, NextResponse } from 'next/server'
import { upsertReceiverRegistry } from '@/app/lib/blobStore'

// POST { prefix, brokerUrl } — upsert no registro de receptores conhecidos
// pelo servidor (sondas/receivers-registry.json), consumido pelo cron
// (app/api/poll) pra saber quais prefixos MQTT consultar. Chamado pelo
// navegador sempre que MQTT está ativado/configurado (ver useReceiver.ts).
// Sem autenticação por chave — mesmo modelo de confiança de /api/receiver-history:
// qualquer um pode registrar seu próprio prefixo, sem afetar o de ninguém.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const prefix = typeof body?.prefix === 'string' ? body.prefix.trim() : ''
    const brokerUrl = typeof body?.brokerUrl === 'string' ? body.brokerUrl.trim() : ''
    if (!prefix || !/^wss?:\/\//.test(brokerUrl)) {
      return NextResponse.json({ ok: false, error: 'prefix e brokerUrl (wss?://) obrigatórios' }, { status: 400 })
    }
    await upsertReceiverRegistry(prefix, brokerUrl)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false, error: 'Erro ao registrar' }, { status: 500 })
  }
}
