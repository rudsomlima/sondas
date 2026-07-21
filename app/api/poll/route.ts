import { NextRequest, NextResponse } from 'next/server'
import { writePollStatus } from '@/app/lib/blobStore'
import { pollAllReceivers } from '@/app/lib/mqttServerPoll'
import { refreshLiveFlightsCache } from '@/app/lib/liveFlightsCache'

export const maxDuration = 60

/**
 * Cron combinado: coleta telemetria MQTT dos receptores registrados
 * (app/lib/mqttServerPoll.ts) e atualiza o cache de voos ao vivo por
 * estação (app/lib/liveFlightsCache.ts) — ambos gravam em R2, direto,
 * independente de alguém estar com o site aberto.
 *
 * Pensado pra ser chamado com frequência (a cada poucos minutos) por um
 * serviço externo (o cron nativo da Vercel no plano gratuito só roda 1x/dia
 * — ver vercel.json, que mantém esse cron diário como rede de segurança).
 * Por isso, diferente de /api/radiosondy-sync, esta rota tem uma URL
 * pública conhecida de terceiros e exige um segredo compartilhado.
 *
 * Os dois passos rodam isolados: falha de um não impede o outro.
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

  let receivers: Awaited<ReturnType<typeof pollAllReceivers>> = { total: 0, updated: 0, errors: 0, results: [] }
  try {
    receivers = await pollAllReceivers()
  } catch (e) {
    console.error('[poll] pollAllReceivers falhou:', e)
  }

  let liveFlights: Awaited<ReturnType<typeof refreshLiveFlightsCache>> = { stations: {}, errors: 0 }
  try {
    liveFlights = await refreshLiveFlightsCache()
  } catch (e) {
    console.error('[poll] refreshLiveFlightsCache falhou:', e)
  }

  await writePollStatus({
    lastRunAt: startedAt,
    durationMs: Date.now() - startedAt,
    receivers: { total: receivers.total, updated: receivers.updated, errors: receivers.errors },
    liveFlights,
  })

  return NextResponse.json({ ok: true, receivers, liveFlights })
}
