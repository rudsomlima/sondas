import { NextResponse } from 'next/server'
import { backfillRegistry } from '@/app/lib/sondeRegistryServer'

export const maxDuration = 60

/**
 * POST → roda uma passada do preenchimento do registro de sondas agora (o
 * mesmo passo que o /api/poll faz a cada ping): semeia lançamentos novos e
 * consulta as fontes pras próximas sondas incompletas. Botão "Completar
 * agora" em Configurações. Limitado a 6 sondas por chamada, e
 * `needsEnrichment` não deixa rebaixar o que já está completo.
 */
export async function POST() {
  try {
    return NextResponse.json(await backfillRegistry(6))
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'falhou' }, { status: 502 })
  }
}
