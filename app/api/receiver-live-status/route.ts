import { NextRequest, NextResponse } from 'next/server'
import { readReceiverLiveStatus } from '@/app/lib/blobStore'

// GET ?receiver=key — último pmu/sleep/power reportado por este receptor via
// HTTP direto (ver writeReceiverLiveStatus em blobStore.ts). Consumido pelo
// navegador (useReceiverLiveStatus.ts) por polling, substituindo o que antes
// vinha ao vivo via tópicos MQTT (mqtt-cfg-only: MQTT ficou só para config).
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('receiver')
  if (!key) return NextResponse.json({ ok: false, error: 'receiver obrigatório' }, { status: 400 })
  const status = await readReceiverLiveStatus(key)
  return NextResponse.json({ ok: true, status })
}
