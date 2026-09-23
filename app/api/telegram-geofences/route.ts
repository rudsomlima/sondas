import { NextRequest, NextResponse } from 'next/server'
import { readGeofences, writeGeofences } from '@/app/lib/blobStore'
import type { Geofence } from '@/app/lib/telegramTypes'

/**
 * Áreas de interesse (polígonos/círculos) desenhadas em /telegram, avisadas
 * quando uma sonda pousa dentro. Lista pequena (dezenas no máximo) — o POST
 * substitui a lista inteira, mesmo padrão de /api/app-settings.
 */
export async function GET() {
  const f = await readGeofences()
  return NextResponse.json({ areas: f?.areas ?? [] }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest) {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }
  if (!Array.isArray(body?.areas)) return NextResponse.json({ error: 'areas (array) obrigatório' }, { status: 400 })
  const areas: Geofence[] = body.areas
  try {
    await writeGeofences({ areas, updatedAt: Date.now() })
  } catch {
    return NextResponse.json({ error: 'falha ao gravar no R2' }, { status: 502 })
  }
  return NextResponse.json({ ok: true, areas })
}
