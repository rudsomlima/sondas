import { NextRequest, NextResponse } from 'next/server'
import { readAppGlobalSettings, writeAppGlobalSettings } from '@/app/lib/blobStore'
import { forgetAppSettingsCache } from '@/app/lib/appSettingsServer'

/**
 * Configurações globais do app (R2 `sondas/app-settings.json`), iguais em
 * todos os aparelhos. Hoje: `wyomingEnabled` (liga/desliga toda consulta à
 * University of Wyoming — ver app/lib/appSettings.ts).
 */
export async function GET() {
  const s = await readAppGlobalSettings()
  return NextResponse.json(
    { wyomingEnabled: s?.wyomingEnabled !== false, updatedAt: s?.updatedAt ?? 0 },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function POST(req: NextRequest) {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }
  if (typeof body?.wyomingEnabled !== 'boolean') {
    return NextResponse.json({ error: 'wyomingEnabled (booleano) obrigatório' }, { status: 400 })
  }
  const settings = { wyomingEnabled: body.wyomingEnabled, updatedAt: Date.now() }
  try {
    await writeAppGlobalSettings(settings)
  } catch {
    return NextResponse.json({ error: 'falha ao gravar no R2' }, { status: 502 })
  }
  forgetAppSettingsCache()
  return NextResponse.json({ ok: true, ...settings })
}
