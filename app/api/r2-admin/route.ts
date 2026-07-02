import { NextRequest, NextResponse } from 'next/server'
import { listYearStores, deleteYearStore } from '@/app/lib/blobStore'

// GET  — lista todos os arquivos no R2 com tamanho, data, lançamentos
// DELETE ?station=82599&year=2024 — remove um arquivo específico
// DELETE ?station=82599           — remove todos os anos de uma estação
// DELETE ?all=1                   — remove tudo (usar com cuidado)

export async function GET() {
  const configured = !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY)
  if (!configured) {
    return NextResponse.json({ ok: true, configured: false, totalBytes: 0, files: [] })
  }
  const files = await listYearStores()
  const totalBytes = files.reduce((s, f) => s + f.sizeBytes, 0)
  return NextResponse.json({ ok: true, configured: true, totalBytes, files })
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const station = searchParams.get('station')
  const year = searchParams.get('year')
  const all = searchParams.get('all')

  if (all === '1') {
    const files = await listYearStores()
    await Promise.all(files.map(f => deleteYearStore(f.station, f.year)))
    return NextResponse.json({ ok: true, deleted: files.length })
  }

  if (station && year) {
    await deleteYearStore(station, parseInt(year))
    return NextResponse.json({ ok: true, deleted: 1 })
  }

  if (station) {
    const files = await listYearStores()
    const toDelete = files.filter(f => f.station === station)
    await Promise.all(toDelete.map(f => deleteYearStore(f.station, f.year)))
    return NextResponse.json({ ok: true, deleted: toDelete.length })
  }

  return NextResponse.json({ ok: false, error: 'Parâmetros inválidos' }, { status: 400 })
}
