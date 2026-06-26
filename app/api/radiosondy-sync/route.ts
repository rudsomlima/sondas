import { NextResponse } from 'next/server'
import { readYearStore, writeYearStore } from '@/app/lib/blobStore'
import {
  fetchRadiosondyFeatures, fetchLiveFlights, findRecoveredMatch, findLiveMatch,
  isWithinMatchWindow, launchUtcInstant, LiveSondePosition,
} from '@/app/lib/radiosondy'
import { SOUTH_AMERICA_STATIONS } from '@/app/lib/stations'

export const maxDuration = 60

const GMT3 = -3 * 60 * 60 * 1000
function nowGMT3() {
  return new Date(Date.now() + GMT3)
}

/**
 * Checagem em segundo plano de correspondência no radiosondy.info, pra não
 * depender do navegador descobrir isso reativamente (e pagar o fetch pesado
 * do feed ao vivo) a cada clique no calendário. Disposado por um Vercel Cron
 * (ver vercel.json) — sem autenticação por enquanto (só lê/escreve dados
 * públicos de lançamentos, sem nada sensível).
 *
 * Desenhado pra ser leve e retomável:
 * - só processa o ano corrente;
 * - só estações com "startplace" conhecido (app/lib/stations.ts);
 * - nunca rechecha lançamentos que já têm `radiosondyMatch` definido;
 * - busca o radiosondy.info uma vez por (estação, mês) com lançamentos
 *   pendentes, não uma vez por lançamento;
 * - o feed ao vivo (~1MB) só é buscado uma única vez por execução inteira, e
 *   só se algum lançamento pendente ainda estiver dentro da janela de voo.
 * - se uma execução não terminar tudo (timeout, falha pontual), a próxima
 *   retoma de onde ficou, já que só o que falta fica sem `radiosondyMatch`.
 */
export async function GET() {
  const local = nowGMT3()
  const currentYear = local.getUTCFullYear()
  const currentMonth = local.getUTCMonth() + 1

  const stations = SOUTH_AMERICA_STATIONS.filter(s => s.radiosondyStartplace)

  let liveFlightsCache: LiveSondePosition[] | null = null
  async function liveFlightsOnce(): Promise<LiveSondePosition[]> {
    if (liveFlightsCache === null) {
      liveFlightsCache = await fetchLiveFlights().catch(() => [])
    }
    return liveFlightsCache
  }

  const summary: Record<string, { checked: number; yes: number; no: number; pending: number }> = {}

  for (const station of stations) {
    const startplace = station.radiosondyStartplace!
    const store = await readYearStore(station.id, currentYear)
    if (!store || store.launches.length === 0) continue

    const byMonth = new Map<number, typeof store.launches>()
    for (const l of store.launches) {
      if (l.radiosondyMatch || l.month > currentMonth) continue
      const list = byMonth.get(l.month) ?? []
      list.push(l)
      byMonth.set(l.month, list)
    }
    if (byMonth.size === 0) continue

    let changed = false
    let checked = 0, yes = 0, no = 0, pending = 0

    for (const [month, pendingLaunches] of byMonth) {
      let features
      try {
        features = await fetchRadiosondyFeatures(currentYear, month, startplace)
      } catch {
        pending += pendingLaunches.length
        continue // falha pontual do radiosondy.info: tenta de novo na próxima execução
      }

      for (const l of pendingLaunches) {
        const instant = launchUtcInstant(l.year, l.month, l.day, l.time_utc, l.time_local)
        const recovered = findRecoveredMatch(features, instant)
        if (recovered) {
          l.radiosondyMatch = 'yes'
          changed = true
          checked++
          yes++
          continue
        }

        if (isWithinMatchWindow(instant)) {
          const live = findLiveMatch(await liveFlightsOnce(), startplace)
          if (live) {
            l.radiosondyMatch = 'yes'
            changed = true
            checked++
            yes++
          } else {
            // Ainda dentro da janela de voo e sem nada: pode ainda ganhar
            // correspondência depois (pouso publicado com atraso, ou a sonda
            // ainda nem decolou de fato) — não marca 'no' ainda, recheca no
            // próximo run.
            pending++
          }
          continue
        }

        // Fora da janela e sem nenhuma correspondência: confirmadamente sem
        // recuperação registrada pra esse lançamento.
        l.radiosondyMatch = 'no'
        changed = true
        checked++
        no++
      }
    }

    if (changed) {
      store.updatedAt = Date.now()
      await writeYearStore(station.id, store)
    }
    if (checked > 0 || pending > 0) {
      summary[station.id] = { checked, yes, no, pending }
    }
  }

  return NextResponse.json({ ok: true, year: currentYear, stations: summary })
}
