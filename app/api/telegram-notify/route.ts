import { NextRequest, NextResponse } from 'next/server'
import { notifyFlightEvent } from '@/app/lib/telegramEvents'

/**
 * Recebe um evento "lançamento"/"pouso" detectado no navegador (ver
 * app/painel/hooks/useLaunchLandingWatcher.ts) e decide se manda a mensagem
 * no Telegram: config precisa estar ligada + o evento correspondente
 * habilitado, e o dedup (R2) precisa aceitar (evita duplicar quando mais de
 * uma aba detecta a mesma transição). O bot token nunca sai do servidor.
 *
 * Mensagem sempre com foto quando dá: monta um mapa (tiles OSM + pino) em
 * app/lib/staticMap.ts, sem depender de nenhuma API de terceiro. Se o mapa
 * falhar (sem internet do lado do servidor, OSM fora do ar), cai pra texto
 * puro — melhor um aviso sem imagem do que nenhum aviso.
 */
export async function POST(req: NextRequest) {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const {
    event, sondeNumber, lat, lon, altitude, climbing, frequencyMHz, source, lastReceiver, lastReportUtc,
    stationId, stationName, stationLat, stationLon,
  } = body ?? {}
  if ((event !== 'launch' && event !== 'landing') || typeof sondeNumber !== 'string' || !sondeNumber) {
    return NextResponse.json({ error: 'evento inválido' }, { status: 400 })
  }

  const r = await notifyFlightEvent({
    event, sondeNumber, lat, lon, altitude, climbing, frequencyMHz, source, lastReceiver, lastReportUtc,
    stationId, stationName, stationLat, stationLon,
  })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 })
  return NextResponse.json(r)
}
