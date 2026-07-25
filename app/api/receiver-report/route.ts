import { NextRequest, NextResponse } from 'next/server'
import { recordCollected } from '@/app/lib/receiverCollect'
import { parseRdzPmu, parseRdzSleep, parseRdzPower } from '@/app/lib/mqtt'
import { writeInstalledFirmware, upsertKnownReceiver, writeReceiverLiveStatus } from '@/app/lib/blobStore'
import { receiverKey } from '@/app/lib/receiverKey'

// POST { prefix, pmu?, sleep?, power?, fw? } — reporte direto do firmware ao
// acordar, sem passar por MQTT/cron. Substitui, pra persistência no R2, a
// dependência de um broker público retendo mensagem + o cron do servidor
// pegando a janela certa (ver mqttServerPoll.ts) — o TTGO chama isso uma vez
// por ciclo de wake, com os MESMOS JSONs que já publicava nos tópicos
// {prefix}pmu/sleep/power, só que via HTTPS direto pra cá. `fw: {version}` é
// a versão instalada (reportVersion em conn-report.cpp), pro painel "Meu
// Receptor" comparar com o que está publicado em /api/firmware/[receiver].
// Mesmo modelo de confiança de /api/register-receiver: sem chave, o prefix
// é a identidade (só afeta o próprio histórico de quem o usa).
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const prefix = typeof body?.prefix === 'string' ? body.prefix.trim() : ''
    if (!prefix) {
      return NextResponse.json({ ok: false, error: 'prefix obrigatório' }, { status: 400 })
    }

    const pmu   = body?.pmu   ? parseRdzPmu(JSON.stringify(body.pmu))     : null
    const sleep = body?.sleep ? parseRdzSleep(JSON.stringify(body.sleep)) : null
    const power = body?.power ? parseRdzPower(JSON.stringify(body.power)) : null
    const fwVersion = typeof body?.fw?.version === 'string' ? body.fw.version.trim() : ''

    if (!pmu && !sleep && !power && !fwVersion) {
      return NextResponse.json({ ok: false, error: 'nenhum dado reconhecido em pmu/sleep/power/fw' }, { status: 400 })
    }

    const key = receiverKey(prefix)
    if (fwVersion) await writeInstalledFirmware(key, fwVersion)
    await upsertKnownReceiver(prefix)
    if (pmu || sleep || power) {
      await writeReceiverLiveStatus(key, { pmu: pmu ?? undefined, sleep: sleep ?? undefined, power: power ?? undefined })
    }

    const updated = await recordCollected(prefix, { pmu: pmu ?? undefined, sleep: sleep ?? undefined, power: power ?? undefined }, Date.now())
    return NextResponse.json({ ok: true, updated })
  } catch {
    return NextResponse.json({ ok: false, error: 'Erro ao processar reporte' }, { status: 500 })
  }
}
