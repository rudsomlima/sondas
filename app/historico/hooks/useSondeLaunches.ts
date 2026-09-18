'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Launch } from '@/app/lib/types'
import {
  cachedArchivesFor, fetchSondeArchives, missingArchiveSerials, type SondeArchiveInfo,
} from '@/app/lib/sondeArchive'
import { archiveSerials, launchesWithSondes } from '@/app/lib/sondeLaunches'
import type { SondePoint } from '@/app/lib/sondePoints'

/**
 * Lista de lançamentos como a interface mostra hoje: uma entrada por sonda
 * (as que não casaram com um slot da Wyoming entram como extras) e o horário
 * do primeiro quadro recebido quando conhecido.
 *
 * Igual ao useRecoveredLaunches: devolve na hora o que já está em cache e
 * completa em segundo plano, sem nunca atrasar o desenho. Só leitura — nada
 * disso é gravado no cache do ano nem no R2.
 */
export function useSondeLaunches(launches: Launch[], points: SondePoint[]): Launch[] {
  const serials = useMemo(() => archiveSerials(launches, points), [launches, points])
  const serialsKey = serials.join(',')
  const [archives, setArchives] = useState<Map<string, SondeArchiveInfo>>(() => cachedArchivesFor(serials))

  useEffect(() => {
    const cachedNow = cachedArchivesFor(serials)
    if (cachedNow.size > 0) setArchives(prev => new Map([...prev, ...cachedNow]))
    if (missingArchiveSerials(serials).length === 0) return
    let cancelled = false
    // fetchSondeArchives consulta no máximo 40 serials por chamada (é rede de
    // terceiro); um mês cheio pode ter mais, então repete enquanto sobrar
    // algo — com teto, pra nunca virar laço infinito se o proxy falhar.
    ;(async () => {
      for (let pass = 0; pass < 4 && !cancelled && missingArchiveSerials(serials).length > 0; pass++) {
        try {
          const map = await fetchSondeArchives(serials)
          if (cancelled) return
          if (map.size > 0) setArchives(prev => new Map([...prev, ...map]))
        } catch { return }
      }
    })()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialsKey])

  return useMemo(() => launchesWithSondes(launches, points, archives), [launches, points, archives])
}
