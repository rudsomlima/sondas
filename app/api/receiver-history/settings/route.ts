import { NextRequest, NextResponse } from 'next/server'
import { readHistorySettings, writeHistorySettings } from '@/app/lib/blobStore'
import { setHistorySettingsCache } from '@/app/lib/receiverCollect'

// GET ?key=home_rdz01 → { batt, power } (true = registrando)
// PUT ?key=home_rdz01 body { batt?, power? } → grava e devolve o estado final
// Liga/desliga o registro de histórico no R2 feito pelo servidor a cada
// reporte do receptor (ver receiverCollect.ts).

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key')?.trim()
  if (!key) return NextResponse.json({ ok: false, error: 'key obrigatório' }, { status: 400 })
  return NextResponse.json({ ok: true, settings: await readHistorySettings(key) })
}

export async function PUT(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key')?.trim()
  if (!key) return NextResponse.json({ ok: false, error: 'key obrigatório' }, { status: 400 })
  try {
    const body = await req.json()
    const current = await readHistorySettings(key)
    const next = {
      batt: typeof body?.batt === 'boolean' ? body.batt : current.batt,
      power: typeof body?.power === 'boolean' ? body.power : current.power,
    }
    await writeHistorySettings(key, next)
    setHistorySettingsCache(key, next)
    return NextResponse.json({ ok: true, settings: next })
  } catch {
    return NextResponse.json({ ok: false, error: 'Erro ao salvar' }, { status: 500 })
  }
}
