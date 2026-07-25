import { NextResponse } from 'next/server'
import { readFirmwareBinary } from '@/app/lib/blobStore'

// GET — binário do firmware deste receptor, baixado pelo ESP32 (conn-ota.cpp)
// só depois de conferir que /api/firmware/[receiver]/version mudou.
export async function GET(_req: Request, { params }: { params: Promise<{ receiver: string }> }) {
  const { receiver } = await params
  const bin = await readFirmwareBinary(receiver)
  if (!bin) return new NextResponse('', { status: 404 })
  return new NextResponse(Buffer.from(bin), {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(bin.byteLength),
      'Cache-Control': 'no-store',
    },
  })
}
