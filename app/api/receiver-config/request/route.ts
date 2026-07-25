import { NextRequest, NextResponse } from 'next/server'
import { readConfigRequest, writeConfigRequest, deleteConfigRequest } from '@/app/lib/blobStore'
import { receiverKey } from '@/app/lib/receiverKey'

// GET ?prefix=xxx — chamado pelo FIRMWARE (conn-cfg.cpp/checkPendingConfig),
// no boot e periodicamente enquanto acordado. Corpo cru, sem envelope
// {ok:...} — o parser do firmware (cfgJsonExtractString) espera "reqId" no
// nível raiz. `{}` = nada pendente.
export async function GET(req: NextRequest) {
  const prefix = req.nextUrl.searchParams.get('prefix')
  if (!prefix) return NextResponse.json({}, { status: 400 })
  const request = await readConfigRequest(receiverKey(prefix))
  return NextResponse.json(request ?? {})
}

// POST { prefix, reqId, auth, apply, changes } — chamado pelo NAVEGADOR
// (FullConfigEditor) pra enfileirar uma mudança. Substitui um pedido
// anterior não resolvido (só um pendente por vez — o mais recente vence).
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const prefix = typeof body?.prefix === 'string' ? body.prefix.trim() : ''
    const reqId = typeof body?.reqId === 'string' ? body.reqId : ''
    const auth = typeof body?.auth === 'string' ? body.auth : ''
    const apply = body?.apply === 'reboot' ? 'reboot' : 'live'
    const changes = typeof body?.changes === 'object' && body.changes !== null ? body.changes : null
    if (!prefix || !reqId || !auth || !changes) {
      return NextResponse.json({ ok: false, error: 'prefix, reqId, auth e changes obrigatórios' }, { status: 400 })
    }
    const key = receiverKey(prefix)
    await writeConfigRequest(key, { reqId, auth, apply, changes })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false, error: 'Erro ao enfileirar mudança' }, { status: 500 })
  }
}

// DELETE ?prefix=xxx — cancela um pedido ainda não aplicado (ex.: usuário
// desistiu antes do receptor acordar).
export async function DELETE(req: NextRequest) {
  const prefix = req.nextUrl.searchParams.get('prefix')
  if (!prefix) return NextResponse.json({ ok: false, error: 'prefix obrigatório' }, { status: 400 })
  await deleteConfigRequest(receiverKey(prefix))
  return NextResponse.json({ ok: true })
}
