import { NextRequest, NextResponse } from 'next/server'
import { readLiveFlights } from '@/app/lib/blobStore'

// GET ?station=82599 → { updatedAt, flights } do cache em R2 (ver
// app/lib/liveFlightsCache.ts, atualizado por /api/poll), ou null se ainda
// não houver snapshot pra essa estação — nesse caso o cliente (useLiveFlights.ts)
// cai pro fetch direto do SondeHub/radiosondy.info como hoje.
export async function GET(req: NextRequest) {
  const station = req.nextUrl.searchParams.get('station')?.trim()
  if (!station) return NextResponse.json(null, { status: 200 })
  const snapshot = await readLiveFlights(station)
  return NextResponse.json(snapshot)
}
