'use client'

import { useMemo } from 'react'
import type { Launch } from '@/app/lib/types'
import type { SondeRecord } from '@/app/lib/sondeRegistry'
import { launchesWithSondes } from '@/app/lib/sondeLaunches'
import type { SondePoint } from '@/app/lib/sondePoints'

/**
 * Lista de lançamentos como a interface mostra hoje: uma entrada por sonda
 * (as que não casaram com um slot da Wyoming entram como extras), com o
 * horário do primeiro quadro recebido, receptores e último sinal vindos do
 * registro permanente de sondas (useSondeRegistry → R2).
 *
 * Só exibição — nada disso é gravado no cache do ano nem no YearStore.
 */
export function useSondeLaunches(launches: Launch[], points: SondePoint[], records: Map<string, SondeRecord>): Launch[] {
  return useMemo(() => launchesWithSondes(launches, points, records), [launches, points, records])
}
