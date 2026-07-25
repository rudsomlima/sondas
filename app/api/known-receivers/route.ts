import { NextResponse } from 'next/server'
import { readKnownReceivers } from '@/app/lib/blobStore'

// GET — receptores que já reportaram algo via /api/receiver-report (ver
// upsertKnownReceiver em blobStore.ts). Consumido pelo navegador (Meu
// Receptor) pra auto-descobrir e listar qualquer receptor ligado com
// mqtt.siteurl apontando pra este app — sem precisar de MQTT nem de
// cadastro manual.
export async function GET() {
  const entries = await readKnownReceivers()
  return NextResponse.json({ ok: true, entries })
}
