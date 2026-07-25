import { NextRequest, NextResponse } from 'next/server'
import { readScreensSnapshot, writeScreensSnapshot } from '@/app/lib/blobStore'
import { receiverKey } from '@/app/lib/receiverKey'

// GET ?prefix=xxx — último screens1.txt que o receptor reportou (ver
// conn-cfg.cpp/reportScreensSnapshot, chamado uma vez por boot). Mesmo
// padrão do canal de config.txt, só que carregando texto bruto.
export async function GET(req: NextRequest) {
  const prefix = req.nextUrl.searchParams.get('prefix')
  if (!prefix) return NextResponse.json({ ok: false, error: 'prefix obrigatório' }, { status: 400 })
  const snapshot = await readScreensSnapshot(receiverKey(prefix))
  return NextResponse.json({ ok: true, snapshot })
}

// POST { prefix, screens } — o firmware empurra o conteúdo completo do
// arquivo de telas ativo.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const prefix = typeof body?.prefix === 'string' ? body.prefix.trim() : ''
    const screens = typeof body?.screens === 'string' ? body.screens : null
    if (!prefix || screens === null) {
      return NextResponse.json({ ok: false, error: 'prefix e screens obrigatórios' }, { status: 400 })
    }
    await writeScreensSnapshot(receiverKey(prefix), screens)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false, error: 'Erro ao processar snapshot' }, { status: 500 })
  }
}
