'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  cachedRecords, enrichSondes, fetchRegistryYear, subscribeRegistry,
} from '@/app/lib/sondeRegistryClient'
import type { SondeRecord } from '@/app/lib/sondeRegistry'

/**
 * Registro permanente de sondas (R2) pra uma estação:
 *  - carrega do R2 tudo que já se sabe das sondas dos `years` (é o que
 *    completa os mapas quando as fontes não devolvem mais o dado);
 *  - pede ao servidor pra consultar as fontes pesadas pras sondas de
 *    `serials` que ainda estão incompletas (receptores, último sinal, 1º
 *    quadro, recuperação) — o servidor grava no R2.
 *
 * Devolve na hora o cache local (localStorage) e atualiza sozinho quando
 * chega coisa nova. Nunca bloqueia o desenho.
 */
export function useSondeRegistry(
  stationId: string | null, years: number[], serials: string[], enrich = true,
): Map<string, SondeRecord> {
  const [version, setVersion] = useState(0)
  useEffect(() => subscribeRegistry(() => setVersion(v => v + 1)), [])

  const yearsKey = years.join(',')
  useEffect(() => {
    if (!stationId) return
    for (const y of years) fetchRegistryYear(y, stationId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stationId, yearsKey])

  // A chave é ordenada (estável entre renders); a ORDEM de `serials` é a
  // prioridade do enriquecimento — quem chama passa as mais recentes primeiro.
  const orderedRef = useRef(serials)
  orderedRef.current = serials
  const serialsKey = useMemo(() => [...new Set(serials)].sort().join(','), [serials])
  useEffect(() => {
    if (!enrich || !stationId || !serialsKey) return
    // Espera o 1º desenho e a leitura do R2 assentarem antes de pedir fontes pesadas.
    const t = setTimeout(() => { enrichSondes([...new Set(orderedRef.current)], stationId) }, 1500)
    return () => clearTimeout(t)
  }, [enrich, stationId, serialsKey])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => cachedRecords(), [version])
}
