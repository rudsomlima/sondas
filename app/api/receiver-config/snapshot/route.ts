import { NextRequest, NextResponse } from 'next/server'
import { readConfigSnapshot, writeConfigSnapshot } from '@/app/lib/blobStore'
import { receiverKey } from '@/app/lib/receiverKey'

// GET ?prefix=xxx — última config completa que o receptor reportou (ver
// conn-cfg.cpp/reportConfigSnapshot, chamado uma vez por boot). Substitui o
// antigo cfg/get via MQTT — sempre "a config de quando ele acordou pela
// última vez", não instantânea (config raramente muda sozinha).
export async function GET(req: NextRequest) {
  const prefix = req.nextUrl.searchParams.get('prefix')
  if (!prefix) return NextResponse.json({ ok: false, error: 'prefix obrigatório' }, { status: 400 })
  const snapshot = await readConfigSnapshot(receiverKey(prefix))
  return NextResponse.json({ ok: true, snapshot })
}

// POST { prefix, config } — o firmware empurra a config completa (campos
// sensíveis já redigidos como "***" antes de sair do dispositivo).
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const prefix = typeof body?.prefix === 'string' ? body.prefix.trim() : ''
    if (!prefix || typeof body?.config !== 'object' || body.config === null) {
      return NextResponse.json({ ok: false, error: 'prefix e config obrigatórios' }, { status: 400 })
    }
    await writeConfigSnapshot(receiverKey(prefix), body.config)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false, error: 'Erro ao processar snapshot' }, { status: 500 })
  }
}
