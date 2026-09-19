import { NextRequest, NextResponse } from 'next/server'
import { readSondeRegistry, updateSondeRegistry } from '@/app/lib/blobStore'
import {
  mergeSondeRecords, recordYear, sameRecord, sanitizeRecord, type SondeRecord,
} from '@/app/lib/sondeRegistry'

/**
 * Registro permanente de sondas (ver app/lib/sondeRegistry.ts).
 *
 * GET  ?year=2026[&station=82599][&serials=A,B] → { year, updatedAt, records: SondeRecord[] }
 *      `station` filtra pelas sondas já vistas nos mapas daquela estação.
 * POST { records: Partial<SondeRecord>[], station? } → mescla o que o navegador
 *      viu nas fontes (posição, status, último receptor…). Aditivo: nunca apaga.
 *
 * As consultas pesadas às fontes (páginas/zip do radiosondy, telemetria do
 * SondeHub) ficam em /api/sonde-registry/enrich, feitas pelo servidor.
 */

const MAX_POST_RECORDS = 300

export async function GET(req: NextRequest) {
  const year = Number(req.nextUrl.searchParams.get('year'))
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: 'year inválido' }, { status: 400 })
  }
  const station = req.nextUrl.searchParams.get('station')?.trim()
  const serials = new Set((req.nextUrl.searchParams.get('serials') ?? '').split(',').map(s => s.trim()).filter(Boolean))
  let reg
  try {
    reg = await readSondeRegistry(year)
  } catch {
    return NextResponse.json({ error: 'falha ao ler o registro no R2' }, { status: 502 })
  }
  let records = Object.values(reg?.records ?? {})
  if (serials.size > 0) records = records.filter(r => serials.has(r.serial))
  else if (station) records = records.filter(r => r.stations?.includes(station))
  return NextResponse.json(
    { year, updatedAt: reg?.updatedAt ?? 0, records },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function POST(req: NextRequest) {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }
  const station = typeof body?.station === 'string' && /^[A-Za-z0-9_-]{1,20}$/.test(body.station) ? body.station : undefined
  const input: unknown[] = Array.isArray(body?.records) ? body.records.slice(0, MAX_POST_RECORDS) : []

  // Agrupa por ano do registro; registro sem nenhuma data não tem onde morar.
  const byYear = new Map<number, SondeRecord[]>()
  for (const raw of input) {
    const rec = sanitizeRecord(raw)
    if (!rec) continue
    if (station) rec.stations = [...new Set([...(rec.stations ?? []), station])]
    const year = recordYear(rec)
    if (year == null) continue
    const list = byYear.get(year)
    if (list) list.push(rec); else byYear.set(year, [rec])
  }

  let saved = 0
  try {
    for (const [year, list] of byYear) {
      await updateSondeRegistry(year, current => {
        let changed = false
        const records = { ...current.records }
        for (const rec of list) {
          const merged = mergeSondeRecords(records[rec.serial], rec)
          if (sameRecord(records[rec.serial], merged)) continue
          records[rec.serial] = merged
          changed = true
          saved++
        }
        return changed ? { year, updatedAt: Date.now(), records } : null
      })
    }
  } catch {
    return NextResponse.json({ error: 'falha ao gravar o registro no R2' }, { status: 502 })
  }
  return NextResponse.json({ ok: true, saved })
}
