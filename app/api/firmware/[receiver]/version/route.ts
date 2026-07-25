import { NextResponse } from 'next/server'
import { readFirmwareMeta } from '@/app/lib/blobStore'

// GET — versão do firmware publicado para este receptor (texto puro),
// consumida pelo ESP32 (conn-ota.cpp) pra decidir se baixa o binário de novo.
// [receiver] = receiverKey(mqtt.prefix), igual ao usado no histórico power/batt.
export async function GET(_req: Request, { params }: { params: Promise<{ receiver: string }> }) {
  const { receiver } = await params
  const meta = await readFirmwareMeta(receiver)
  if (!meta) return new NextResponse('', { status: 404 })
  return new NextResponse(meta.version, {
    status: 200,
    headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' },
  })
}
