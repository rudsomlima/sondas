'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Launch } from '@/app/lib/types'
import {
  applyRecoveriesToLaunches, cachedRecoveriesFor, fetchRecoveries, unknownLaunchSerials, type SondeRecovery,
} from '@/app/lib/sondehubRecovery'

/**
 * Lançamentos com o status de recuperação do SondeHub aplicado nas posições
 * ainda UNKNOWN (ver sondehubRecovery.ts). Devolve na hora o que já está em
 * cache e completa em segundo plano — nunca atrasa o desenho. Só leitura: não
 * grava nada (a persistência no R2 é do cron radiosondy-sync).
 *
 * queryMonth: só CONSULTA a rede pros lançamentos desse mês (o ano inteiro
 * podia virar centenas de requisições ao SondeHub); o cache vale pra todos.
 * undefined = consulta todos.
 */
export function useRecoveredLaunches(launches: Launch[], queryMonth?: number | null): Launch[] {
  const allSerials = useMemo(() => unknownLaunchSerials(launches), [launches])
  const serials = useMemo(
    () => queryMonth === undefined ? allSerials : queryMonth === null ? [] : unknownLaunchSerials(launches.filter(l => l.month === queryMonth)),
    [launches, allSerials, queryMonth],
  )
  const serialsKey = serials.join(',')
  const allKey = allSerials.join(',')
  const [recoveries, setRecoveries] = useState<Map<string, SondeRecovery>>(() => cachedRecoveriesFor(allSerials))

  // Cache (sem rede) pra todos os lançamentos visíveis.
  useEffect(() => {
    if (allSerials.length === 0) return
    const cachedNow = cachedRecoveriesFor(allSerials)
    if (cachedNow.size > 0) setRecoveries(prev => new Map([...cachedNow, ...prev]))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allKey])

  useEffect(() => {
    if (serials.length === 0) return
    let cancelled = false
    fetchRecoveries(serials).then(map => {
      if (!cancelled && map.size > 0) setRecoveries(prev => new Map([...prev, ...map]))
    }).catch(() => {})
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialsKey])

  return useMemo(() => applyRecoveriesToLaunches(launches, recoveries).launches, [launches, recoveries])
}
