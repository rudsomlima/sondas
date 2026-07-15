import { NextRequest, NextResponse } from 'next/server'
import { readReceiverHistory, writeReceiverHistory, deleteReceiverHistory } from '@/app/lib/blobStore'

// GET  ?key=home_rdz01&type=power|batt  → JSON array (ou [] se não existir)
// PUT  ?key=home_rdz01&type=power|batt  body: JSON array → salva no R2
// DELETE ?key=home_rdz01 → apaga power-history + batt-history deste receptor

function parseType(raw: string | null): 'power' | 'batt' | null {
  return raw === 'power' || raw === 'batt' ? raw : null
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const key  = searchParams.get('key')?.trim()
  const type = parseType(searchParams.get('type'))
  if (!key || !type) return NextResponse.json([], { status: 200 })

  const data = await readReceiverHistory(key, type)
  return NextResponse.json(data ?? [])
}

export async function PUT(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const key  = searchParams.get('key')?.trim()
  const type = parseType(searchParams.get('type'))
  if (!key || !type) return NextResponse.json({ ok: false, error: 'Parâmetros inválidos' }, { status: 400 })

  try {
    const data = await req.json()
    if (!Array.isArray(data)) return NextResponse.json({ ok: false, error: 'Body deve ser array' }, { status: 400 })
    await writeReceiverHistory(key, type, data)
    return NextResponse.json({ ok: true, written: data.length })
  } catch {
    return NextResponse.json({ ok: false, error: 'Erro ao salvar' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const key = searchParams.get('key')?.trim()
  if (!key) return NextResponse.json({ ok: false, error: 'key obrigatório' }, { status: 400 })
  await deleteReceiverHistory(key)
  return NextResponse.json({ ok: true })
}
