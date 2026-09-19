import { NextRequest, NextResponse } from 'next/server'
import { enrichAndSave } from '@/app/lib/sondeRegistryServer'

/**
 * POST { serials: string[], station?: string }
 *   → { records: SondeRecord[] }
 *
 * Consulta as fontes pesadas (página + "Get Data" do radiosondy.info,
 * telemetria por uploader e relato de recuperação do SondeHub) pras sondas
 * cujo registro ainda está incompleto, mescla tudo no registro do R2 e
 * devolve. `needsEnrichment` (sondeRegistry.ts) decide o que ainda vale
 * buscar — voo encerrado e completo não é rebaixado de novo. O mesmo núcleo
 * roda no /api/poll (backfillRegistry), sem depender de alguém abrir o app.
 */

export const maxDuration = 60

const MAX_SERIALS = 6
const SERIAL_RE = /^[A-Za-z0-9_-]{3,20}$/

export async function POST(req: NextRequest) {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }
  const station = typeof body?.station === 'string' && /^[A-Za-z0-9_-]{1,20}$/.test(body.station) ? body.station : undefined
  const serials: string[] = [...new Set<string>((Array.isArray(body?.serials) ? body.serials : [])
    .filter((s: unknown): s is string => typeof s === 'string' && SERIAL_RE.test(s)))]
    .slice(0, MAX_SERIALS)
  if (serials.length === 0) return NextResponse.json({ records: [] })
  const records = await enrichAndSave(serials, { station })
  return NextResponse.json({ records }, { headers: { 'Cache-Control': 'no-store' } })
}
