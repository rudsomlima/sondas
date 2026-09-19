import { NextRequest, NextResponse } from 'next/server'
import { writePollStatus } from '@/app/lib/blobStore'
import type { PollStatus } from '@/app/lib/types'
import { refreshLiveFlightsCache } from '@/app/lib/liveFlightsCache'
import { backfillRegistry } from '@/app/lib/sondeRegistryServer'

export const maxDuration = 60

/**
 * Cron: atualiza o cache de voos ao vivo por estação (app/lib/liveFlightsCache.ts),
 * direto em R2, independente de alguém estar com o site aberto.
 *
 * Pensado pra ser chamado com frequência (a cada poucos minutos) por um
 * serviço externo (o cron nativo da Vercel no plano gratuito só roda 1x/dia
 * — ver vercel.json, que mantém esse cron diário como rede de segurança).
 * Por isso esta rota tem uma URL
 * pública conhecida de terceiros e exige um segredo compartilhado.
 *
 * Branch mqtt-cfg-only: este cron também coletava telemetria MQTT dos
 * receptores registrados (pollAllReceivers) — removido, o firmware não
 * publica mais pmu/sleep/power via MQTT (só cfg/get e cfg/set continuam
 * ativos); a persistência desses dados agora é via /api/receiver-report
 * (reporte HTTP direto do firmware), sem depender deste cron.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    // ?secret= pro ping externo (cron-job.org); Authorization: Bearer é o
    // header que a própria Vercel injeta automaticamente nas chamadas do
    // cron nativo quando CRON_SECRET está configurado (ver vercel.json).
    const auth = req.headers.get('authorization')
    const bearer = auth?.startsWith('Bearer ') ? auth.slice(7) : null
    const provided = req.nextUrl.searchParams.get('secret') ?? bearer
    if (provided !== secret) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
    }
  }

  const startedAt = Date.now()
  const receivers = { total: 0, updated: 0, errors: 0 }

  // Em paralelo: cache de voos ao vivo + completar o registro permanente de
  // sondas (R2) aos poucos — poucas sondas por ping (cada uma pode baixar
  // ~1-2 MB das fontes), sem depender de alguém abrir o app. Independentes:
  // a demora de um não come o tempo do outro.
  let liveFlights: Awaited<ReturnType<typeof refreshLiveFlightsCache>> = { stations: {}, errors: 0 }
  let registry: NonNullable<PollStatus['registry']> = { seeded: 0, checked: [] }
  await Promise.all([
    refreshLiveFlightsCache()
      .then(r => { liveFlights = r })
      .catch(e => { console.error('[poll] refreshLiveFlightsCache falhou:', e) }),
    backfillRegistry(4)
      .then(r => { registry = r })
      .catch((e: any) => { console.error('[poll] backfillRegistry falhou:', e); registry = { seeded: 0, checked: [], error: String(e?.message ?? 'falhou') } }),
  ])

  await writePollStatus({
    lastRunAt: startedAt,
    durationMs: Date.now() - startedAt,
    receivers: { total: receivers.total, updated: receivers.updated, errors: receivers.errors },
    liveFlights,
    registry,
  })

  return NextResponse.json({ ok: true, receivers, liveFlights, registry })
}
