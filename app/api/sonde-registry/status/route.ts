import { NextRequest, NextResponse } from 'next/server'
import { readPollStatus, readReceiverStations, readSondeRegistry } from '@/app/lib/blobStore'
import { needsEnrichment } from '@/app/lib/sondeRegistry'

/**
 * GET ?station=82599[&year=2026] → resumo do registro de sondas daquela
 * estação (quantas guardadas, quantas completas, o que falta), das estações
 * receptoras conhecidas e da última passada do cron (/api/poll).
 * Alimenta o painel "Registro de sondas" em Configurações.
 */
export async function GET(req: NextRequest) {
  const station = req.nextUrl.searchParams.get('station')?.trim() || '82599'
  const year = Number(req.nextUrl.searchParams.get('year')) || new Date().getUTCFullYear()
  const [reg, stationsFile, poll] = await Promise.all([
    readSondeRegistry(year).catch(() => null),
    readReceiverStations().catch(() => null),
    readPollStatus().catch(() => null),
  ])
  const records = Object.values(reg?.records ?? {}).filter(r => r.stations?.includes(station))
  const now = Date.now()
  const count = (f: (r: typeof records[number]) => boolean) => records.filter(f).length
  const stations = Object.values(stationsFile?.stations ?? {})

  return NextResponse.json({
    year, station,
    registry: {
      total: records.length,
      withReceivers: count(r => !!r.receivers?.length),
      withLastSignal: count(r => !!r.lastReceiver),
      withFirstFrame: count(r => !!r.firstFrameUtc),
      withFlight: count(r => !!r.flight),
      complete: count(r => !!r.receivers?.length && !!r.lastReceiver && !!r.firstFrameUtc && !!r.flight),
      found: count(r => r.status === 'FOUND'),
      lost: count(r => r.status === 'LOST'),
      pending: count(r => { const p = needsEnrichment(r, now); return p.radiosondy || p.sondehub || p.recovered }),
      updatedAt: reg?.updatedAt ?? 0,
    },
    stations: {
      total: stations.length,
      active: stations.filter(s => s.lastSeenAt && now - new Date(s.lastSeenAt).getTime() < 24 * 3600_000).length,
      listenersCheckedAt: stationsFile?.listenersCheckedAt ?? 0,
    },
    lastPoll: poll ? { lastRunAt: poll.lastRunAt, durationMs: poll.durationMs, registry: poll.registry ?? null } : null,
  }, { headers: { 'Cache-Control': 'no-store' } })
}
