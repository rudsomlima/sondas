/**
 * Snapshot server-side de "voos ao vivo" por estação — roda dentro de
 * app/api/poll (chamado por um cron externo a cada poucos minutos) e grava
 * em R2 (ver readLiveFlights/writeLiveFlights em blobStore.ts), pra
 * /historico não precisar bater direto no SondeHub/radiosondy.info nem
 * reprocessar o feed global toda vez que alguém abre a página (ver
 * useLiveFlights.ts, que agora lê esse cache primeiro).
 *
 * Os dois feeds globais (radiosondy "Now Flying!" e a telemetria de 12h do
 * SondeHub) são buscados UMA VEZ por execução e fatiados em memória por
 * estação — em vez do que useLiveFlights.ts faz hoje (um fetch do feed
 * inteiro por estação, repetido a cada usuário/aba).
 */
import { SOUTH_AMERICA_STATIONS } from './stations'
import {
  fetchLiveFlights, fetchRadiosondyFeatures, matchesStartplace, matchesStartplaceExact,
  parsePopupTelemetry, toReportStr, type TodayFlight,
} from './radiosondy'
import { fetchSondeHubLastFrames, filterSondeHubFlights, type SondeHubLastFrame } from './sondehub'
import { gmt3DateStr } from './launchUtils'
import { writeLiveFlights } from './blobStore'
import type { PollStationStatus } from './types'
import { nowGMT3 } from './types'

function todayStr(): string {
  const d = nowGMT3()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

export interface LiveFlightsCacheSummary {
  stations: Record<string, PollStationStatus>
  errors: number
}

export async function refreshLiveFlightsCache(): Promise<LiveFlightsCacheSummary> {
  const today = todayStr()
  const now = nowGMT3()
  const stations = SOUTH_AMERICA_STATIONS

  const summary: LiveFlightsCacheSummary = { stations: {}, errors: 0 }

  let liveFeed: Awaited<ReturnType<typeof fetchLiveFlights>> = []
  let sondeHubFrames: Map<string, SondeHubLastFrame> = new Map()
  const [radioResult, hubResult] = await Promise.allSettled([fetchLiveFlights(), fetchSondeHubLastFrames()])
  if (radioResult.status === 'fulfilled') liveFeed = radioResult.value
  else { console.error('[liveFlightsCache] radiosondy indisponível:', radioResult.reason); summary.errors++ }
  if (hubResult.status === 'fulfilled') sondeHubFrames = hubResult.value
  else { console.error('[liveFlightsCache] SondeHub indisponível:', hubResult.reason); summary.errors++ }
  if (radioResult.status === 'rejected' && hubResult.status === 'rejected') return summary

  for (const station of stations) {
    const startplace = station.radiosondyStartplace
    try {
      const bySondeNumber = new Map<string, TodayFlight>()

      for (const f of liveFeed) {
        if (!startplace) continue
        if (!matchesStartplace(f, startplace)) continue
        if (gmt3DateStr(new Date(f.lastReportUtc)) !== today) continue
        bySondeNumber.set(f.sondeNumber, {
          sondeNumber: f.sondeNumber,
          altitude: f.altitude,
          climbing: f.climbing,
          lat: f.lat,
          lon: f.lon,
          lastReportUtc: f.lastReportUtc,
          isLive: true,
          source: matchesStartplaceExact(f, startplace) ? 'radiosondy' : 'radiosondy-approx',
        })
      }

      for (const f of filterSondeHubFlights(sondeHubFrames, station.lat, station.lon, today)) {
        const existing = bySondeNumber.get(f.sondeNumber)
        if (!existing || f.lastReportUtc > existing.lastReportUtc) bySondeNumber.set(f.sondeNumber, f)
      }

      // Busca os já pousados (export_search.php, específico por estação) só
      // quando algo já apareceu ao vivo pra essa estação hoje — evita ~20
      // requisições extras por execução em dias sem nenhuma atividade.
      if (bySondeNumber.size > 0 && startplace) {
        const recovered = await fetchRadiosondyFeatures(now.getUTCFullYear(), now.getUTCMonth() + 1, startplace)
        for (const f of recovered) {
          if (gmt3DateStr(f.date) !== today) continue
          if (bySondeNumber.has(f.sondeNumber)) continue
          const { altitude, climbing } = parsePopupTelemetry(f.popupContent)
          bySondeNumber.set(f.sondeNumber, {
            sondeNumber: f.sondeNumber,
            altitude,
            climbing,
            lat: f.lat,
            lon: f.lon,
            lastReportUtc: toReportStr(f.date),
            isLive: false,
            source: 'radiosondy',
          })
        }
      }

      const flights = [...bySondeNumber.values()]
      await writeLiveFlights(station.id, { updatedAt: Date.now(), flights })
      summary.stations[station.id] = {
        radiosondy: flights.filter(f => f.source.startsWith('radiosondy')).length,
        sondehub:   flights.filter(f => f.source.startsWith('sondehub')).length,
      }
    } catch (e) {
      console.error(`[liveFlightsCache] falhou pra estação ${station.id}:`, e)
      summary.errors++
    }
  }

  return summary
}
