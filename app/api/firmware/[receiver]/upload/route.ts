import { NextRequest, NextResponse } from 'next/server'
import { writeFirmwareBinary, readFirmwareMeta, readInstalledFirmware } from '@/app/lib/blobStore'

// GET — metadados do firmware publicado pra este receptor + versão que ele
// mesmo reportou ter instalada (ver conn-report.cpp/reportVersion), pro
// painel "Meu Receptor" comparar publicado vs. instalado.
export async function GET(_req: Request, { params }: { params: Promise<{ receiver: string }> }) {
  const { receiver } = await params
  const [meta, installed] = await Promise.all([
    readFirmwareMeta(receiver),
    readInstalledFirmware(receiver),
  ])
  return NextResponse.json({ ok: true, meta, installed })
}

// POST multipart/form-data { version: string, bin: File } — publica um novo
// firmware.bin no R2 (sondas/firmware/{receiver}/), que o ESP32 desse
// receptor baixa sozinho no próximo wake se mqtt.siteurl apontar pra este
// app (ver conn-ota.cpp — monta /api/firmware/{prefix}/ sozinho). Sem autenticação, mesmo
// modelo de confiança do resto do app (uso pessoal).
export async function POST(req: NextRequest, { params }: { params: Promise<{ receiver: string }> }) {
  const { receiver } = await params
  try {
    const form = await req.formData()
    const version = String(form.get('version') ?? '').trim()
    const file = form.get('bin')
    if (!version) {
      return NextResponse.json({ ok: false, error: 'Informe a versão' }, { status: 400 })
    }
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ ok: false, error: 'Envie o firmware.bin' }, { status: 400 })
    }
    const bin = new Uint8Array(await file.arrayBuffer())
    await writeFirmwareBinary(receiver, bin, version)
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[api/firmware/upload] falhou:', e)
    return NextResponse.json({ ok: false, error: 'Erro ao publicar firmware' }, { status: 500 })
  }
}
