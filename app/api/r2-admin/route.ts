import { NextRequest, NextResponse } from 'next/server'
import {
  listYearStores, deleteYearStore,
  listAllR2Objects, deleteR2Object, deleteReceiverHistory,
} from '@/app/lib/blobStore'

// GET  — lista todos os arquivos no R2 (histórico de lançamentos + receptores + outros)
// DELETE ?station=82599&year=2024 — remove arquivo de histórico
// DELETE ?station=82599           — remove todos os anos de uma estação
// DELETE ?key=sondas/...          — remove qualquer arquivo por chave
// DELETE ?receiver=home_rdz01     — remove power+batt history de um receptor
// DELETE ?all=1                   — remove tudo

const HISTORY_RE  = /history-(?:(\d+)-)?(\d{4})\.json$/
const RECEIVER_RE = /receivers\/([^/]+)\/(power|batt)-history\.json$/
const DEFAULT_STATION = '82599'

export async function GET() {
  const configured = !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY)
  if (!configured) {
    return NextResponse.json({ ok: true, configured: false, totalBytes: 0, files: [], receiverFiles: [], otherFiles: [] })
  }

  const all = await listAllR2Objects()
  const totalBytes = all.reduce((s, f) => s + f.sizeBytes, 0)

  const files = all
    .filter(o => HISTORY_RE.test(o.key))
    .map(o => {
      const m = o.key.match(HISTORY_RE)!
      return {
        key: o.key,
        station: m[1] ?? DEFAULT_STATION,
        year: parseInt(m[2]),
        sizeBytes: o.sizeBytes,
        lastModified: o.lastModified,
      }
    })
    .sort((a, b) => b.year - a.year || a.station.localeCompare(b.station))

  const receiverFiles = all
    .filter(o => RECEIVER_RE.test(o.key))
    .map(o => {
      const m = o.key.match(RECEIVER_RE)!
      return {
        key: o.key,
        receiverKey: m[1],
        type: m[2] as 'power' | 'batt',
        sizeBytes: o.sizeBytes,
        lastModified: o.lastModified,
      }
    })
    .sort((a, b) => a.receiverKey.localeCompare(b.receiverKey))

  const otherFiles = all.filter(o => !HISTORY_RE.test(o.key) && !RECEIVER_RE.test(o.key))

  return NextResponse.json({ ok: true, configured: true, totalBytes, files, receiverFiles, otherFiles })
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const station = searchParams.get('station')
  const year    = searchParams.get('year')
  const all      = searchParams.get('all')
  const key      = searchParams.get('key')
  const receiver = searchParams.get('receiver')

  if (all === '1') {
    const objects = await listAllR2Objects()
    await Promise.all(objects.map(o => deleteR2Object(o.key)))
    return NextResponse.json({ ok: true, deleted: objects.length })
  }

  if (key) {
    await deleteR2Object(key)
    return NextResponse.json({ ok: true, deleted: 1 })
  }

  if (receiver) {
    await deleteReceiverHistory(receiver)
    return NextResponse.json({ ok: true, deleted: 2 })
  }

  if (station && year) {
    await deleteYearStore(station, parseInt(year))
    return NextResponse.json({ ok: true, deleted: 1 })
  }

  if (station) {
    const histFiles = await listYearStores()
    const toDelete = histFiles.filter(f => f.station === station)
    await Promise.all(toDelete.map(f => deleteYearStore(f.station, f.year)))
    return NextResponse.json({ ok: true, deleted: toDelete.length })
  }

  return NextResponse.json({ ok: false, error: 'Parâmetros inválidos' }, { status: 400 })
}
