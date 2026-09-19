import { NextResponse } from 'next/server'
import { readReceiverStations } from '@/app/lib/blobStore'

/**
 * GET → { updatedAt, stations: ReceiverStation[] } — estações receptoras
 * guardadas no R2 (ver app/lib/receiverStations.ts). Só entram estações que
 * receberam alguma sonda do registro, então a lista é pequena.
 */
export async function GET() {
  try {
    const file = await readReceiverStations()
    return NextResponse.json(
      { updatedAt: file?.updatedAt ?? 0, stations: Object.values(file?.stations ?? {}) },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch {
    return NextResponse.json({ error: 'falha ao ler as estações no R2' }, { status: 502 })
  }
}
