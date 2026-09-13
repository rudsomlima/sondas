'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Station } from '@/app/lib/stations'
import { fetchMonthSondePoints, type SondePoint } from '@/app/lib/sondePoints'
import { nowGMT3 } from '@/app/lib/types'

// Posições de todas as fontes (radiosondy.info + SondeHub recente/arquivo) de
// um mês, independentes da lista de lançamentos. month = null desliga a busca.
// O mês corrente é reconsultado periodicamente; meses passados, uma vez.
export function useSondePoints(station: Station, year: number, month: number | null, refreshMinutes = 5) {
  const [points, setPoints] = useState<SondePoint[]>([])
  const [loading, setLoading] = useState(false)
  const requestRef = useRef(0)

  const load = useCallback(async () => {
    const request = ++requestRef.current
    if (month == null) { setPoints([]); setLoading(false); return }
    const now = nowGMT3()
    const isRecent = year === now.getUTCFullYear() && now.getUTCMonth() + 1 - month <= 1
    setLoading(true)
    try {
      // O arquivo S3 do SondeHub tem meses de atraso: só vale para meses antigos.
      const result = await fetchMonthSondePoints(station, year, month, { archive: !isRecent })
      if (request !== requestRef.current) return
      // Falha total de rede não apaga os pontos já conhecidos.
      if (result.points.length > 0 || result.failed === 0) setPoints(result.points)
    } finally {
      if (request === requestRef.current) setLoading(false)
    }
  }, [station, year, month])

  useEffect(() => {
    setPoints([])
    load()
    const now = nowGMT3()
    const isCurrent = year === now.getUTCFullYear() && month === now.getUTCMonth() + 1
    if (!isCurrent || refreshMinutes <= 0) return () => { requestRef.current++ }
    const interval = setInterval(load, refreshMinutes * 60 * 1000)
    return () => { requestRef.current++; clearInterval(interval) }
  }, [load, year, month, refreshMinutes])

  return { points, loading, refresh: load }
}
