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
import { SOUTH_AMERICA_STATIONS, DEFAULT_STATION } from './stations'
import {
  fetchLiveFlights, fetchRadiosondyFeatures, flightStatus, matchesStartplace, matchesStartplaceExact,
  parsePopupTelemetry, toReportStr, type TodayFlight,
} from './radiosondy'
import { fetchSondeHubLastFrames, filterSondeHubFlights, type SondeHubLastFrame } from './sondehub'
import { haversineKm } from './geo'
import { gmt3DateStr } from './launchUtils'
import { writeLiveFlights, readTelegramSettings } from './blobStore'
import { notifyFlightEvent } from './telegramEvents'
import type { PollStationStatus } from './types'
import { DEFAULT_WATCH_RADIUS_KM } from './telegramTypes'
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
  const tgSettings = await readTelegramSettings().catch(() => null)
  const watched = new Set(tgSettings?.watchedStationIds ?? [DEFAULT_STATION.id])
  const radiusOf = (id: string) => tgSettings?.stationRadiusKm?.[id] ?? DEFAULT_WATCH_RADIUS_KM

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
      // Avisos de lançamento/pouso no Telegram sem depender do /painel aberto
      // (estações escolhidas em /telegram; o dedup em R2 evita repetir com o
      // detector do navegador). Só eventos recentes: na 1ª execução não
      // dispara aviso de algo que subiu/pousou horas atrás.
      if (watched.has(station.id)) {
        // Alcance próprio da estação (pode passar dos 300 km do cache).
        const radiusKm = radiusOf(station.id)
        const inRange = new Map<string, TodayFlight>()
        for (const f of flights) if (haversineKm(station.lat, station.lon, f.lat, f.lon) <= radiusKm) inRange.set(f.sondeNumber, f)
        for (const f of filterSondeHubFlights(sondeHubFrames, station.lat, station.lon, today, radiusKm)) {
          if (!inRange.has(f.sondeNumber)) inRange.set(f.sondeNumber, f)
        }
        await notifyRecentEvents(station, [...inRange.values()])
      }
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

const LAUNCH_MAX_AGE_MS = 20 * 60_000
const LANDING_MAX_AGE_MS = 3 * 60 * 60_000

function reportAgeMs(f: TodayFlight): number {
  return Date.now() - new Date(f.lastReportUtc.replace(/z$/i, '').replace(' ', 'T') + 'Z').getTime()
}

async function notifyRecentEvents(station: { id: string; name: string; lat: number; lon: number }, flights: TodayFlight[]) {
  for (const f of flights) {
    const age = reportAgeMs(f)
    let event: 'launch' | 'landing' | null = null
    if (f.isLive && age < LAUNCH_MAX_AGE_MS) event = 'launch'
    else if (flightStatus(f) === 'landed' && age < LANDING_MAX_AGE_MS) event = 'landing'
    if (!event) continue
    try {
      const r = await notifyFlightEvent({
        event, sondeNumber: f.sondeNumber, lat: f.lat, lon: f.lon, altitude: f.altitude, climbing: f.climbing,
        frequencyMHz: f.frequencyMHz, source: f.source, lastReceiver: f.lastReceiver, lastReportUtc: f.lastReportUtc,
        stationId: station.id, stationName: station.name, stationLat: station.lat, stationLon: station.lon,
      })
      if (!r.ok) console.error('[liveFlightsCache] aviso Telegram falhou:', r.error)
    } catch (e) {
      console.error('[liveFlightsCache] aviso Telegram falhou:', e)
    }
  }
}
