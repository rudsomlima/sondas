import { NextRequest, NextResponse } from 'next/server'
import { readScreensRequest, writeScreensRequest, deleteScreensRequest } from '@/app/lib/blobStore'
import { receiverKey } from '@/app/lib/receiverKey'

// GET ?prefix=xxx — chamado pelo FIRMWARE (conn-cfg.cpp/checkPendingScreens),
// no boot e periodicamente enquanto acordado. Corpo cru, sem envelope
// {ok:...}. `{}` = nada pendente.
export async function GET(req: NextRequest) {
  const prefix = req.nextUrl.searchParams.get('prefix')
  if (!prefix) return NextResponse.json({}, { status: 400 })
  const request = await readScreensRequest(receiverKey(prefix))
  return NextResponse.json(request ?? {})
}

// POST { prefix, reqId, auth, text } — chamado pelo NAVEGADOR (editor visual
// de telas) pra enfileirar um novo screens1.txt. Substitui um pedido
// anterior não resolvido.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const prefix = typeof body?.prefix === 'string' ? body.prefix.trim() : ''
    const reqId = typeof body?.reqId === 'string' ? body.reqId : ''
    const auth = typeof body?.auth === 'string' ? body.auth : ''
    const text = typeof body?.text === 'string' ? body.text : null
    if (!prefix || !reqId || !auth || text === null) {
      return NextResponse.json({ ok: false, error: 'prefix, reqId, auth e text obrigatórios' }, { status: 400 })
    }
    const key = receiverKey(prefix)
    await writeScreensRequest(key, { reqId, auth, text })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false, error: 'Erro ao enfileirar mudança' }, { status: 500 })
  }
}

// DELETE ?prefix=xxx — cancela um pedido ainda não aplicado.
export async function DELETE(req: NextRequest) {
  const prefix = req.nextUrl.searchParams.get('prefix')
  if (!prefix) return NextResponse.json({ ok: false, error: 'prefix obrigatório' }, { status: 400 })
  await deleteScreensRequest(receiverKey(prefix))
  return NextResponse.json({ ok: true })
}
