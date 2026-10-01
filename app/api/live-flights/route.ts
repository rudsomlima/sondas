import { NextResponse } from 'next/server'

// No persistent cache: clients receive null and fetch the live providers.
// Keep this endpoint for compatibility with useLiveFlights.
export async function GET() {
  return NextResponse.json(null)
}
