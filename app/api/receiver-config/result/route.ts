import { NextRequest, NextResponse } from 'next/server'
import { readConfigResult, writeConfigResult, deleteConfigRequest } from '@/app/lib/blobStore'
import { receiverKey } from '@/app/lib/receiverKey'

// GET ?prefix=xxx&reqId=xxx — chamado pelo NAVEGADOR fazendo polling do
// resultado de um pedido enfileirado. `resolved:false` enquanto o receptor
// ainda não aplicou (dormindo, ou reqId não bate com o resultado mais
// recente conhecido).
export async function GET(req: NextRequest) {
  const prefix = req.nextUrl.searchParams.get('prefix')
  const reqId = req.nextUrl.searchParams.get('reqId')
  if (!prefix || !reqId) return NextResponse.json({ ok: false, error: 'prefix e reqId obrigatórios' }, { status: 400 })
  const result = await readConfigResult(receiverKey(prefix))
  if (!result || result.reqId !== reqId) return NextResponse.json({ ok: true, resolved: false })
  return NextResponse.json({ ok: true, resolved: true, result })
}

// POST { prefix, reqId, ok, error?, rebooting? } — chamado pelo FIRMWARE
// (conn-cfg.cpp) depois de tentar aplicar um pedido. Limpa a pendência (não
// reaplica no próximo boot) e grava o resultado pro navegador ler.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const prefix = typeof body?.prefix === 'string' ? body.prefix.trim() : ''
    const reqId = typeof body?.reqId === 'string' ? body.reqId : ''
    if (!prefix || !reqId) {
      return NextResponse.json({ ok: false, error: 'prefix e reqId obrigatórios' }, { status: 400 })
    }
    const key = receiverKey(prefix)
    await writeConfigResult(key, {
      reqId,
      ok: body.ok === true,
      error: typeof body.error === 'string' ? body.error : undefined,
      rebooting: body.rebooting === true,
    })
    await deleteConfigRequest(key)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false, error: 'Erro ao gravar resultado' }, { status: 500 })
  }
}
