import { NextRequest, NextResponse } from 'next/server'
import { readKnownReceivers, deleteKnownReceiver } from '@/app/lib/blobStore'

// GET — receptores que já reportaram algo via /api/receiver-report (ver
// upsertKnownReceiver em blobStore.ts). Consumido pelo navegador (Meu
// Receptor) pra auto-descobrir e listar qualquer receptor ligado com
// mqtt.siteurl apontando pra este app — sem precisar de MQTT nem de
// cadastro manual.
export async function GET() {
  const entries = await readKnownReceivers()
  return NextResponse.json({ ok: true, entries })
}

// DELETE ?prefix=pu7iol — remove um receptor da lista de auto-descoberta
// (known-receivers.json). Não apaga histórico power/batt (ver /api/r2-admin
// ?receiver=... pra isso).
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const prefix = searchParams.get('prefix')
  if (!prefix) {
    return NextResponse.json({ ok: false, error: 'Parâmetro "prefix" é obrigatório' }, { status: 400 })
  }
  await deleteKnownReceiver(prefix)
  return NextResponse.json({ ok: true })
}
