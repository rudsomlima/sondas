/**
 * Métricas agregadas de voos para a página de análises.
 * Deriva tudo dos launches já persistidos (position + flightStats) —
 * nenhum endpoint novo.
 */
import { haversineKm, bearingDeg } from './geo'
import type { Launch } from './types'
import type { Station } from './stations'

export interface YearMetrics {
  totalLaunches: number
  withPosition: number
  meanBurstAltM: number | null
  meanDurationMin: number | null
  meanDriftKm: number | null
  // Contagem de pousos por octante de direção (N, NE, L, SE, S, SO, O, NO)
  driftByOctant: number[]
}

export function computeYearMetrics(launches: Launch[], station: Station): YearMetrics {
  const withPos = launches.filter(l => l.position)
  const bursts: number[] = []
  const durations: number[] = []
  const drifts: number[] = []
  const octants = new Array(8).fill(0)

  for (const l of withPos) {
    const pos = l.position!
    if (l.flightStats?.burstAltM) bursts.push(l.flightStats.burstAltM)
    if (l.flightStats?.durationMin) durations.push(l.flightStats.durationMin)

    const drift = l.flightStats?.distanceKm ?? haversineKm(station.lat, station.lon, pos.lat, pos.lon)
    drifts.push(drift)

    const brg = l.flightStats?.bearingDeg ?? bearingDeg(station.lat, station.lon, pos.lat, pos.lon)
    octants[Math.round(brg / 45) % 8]++
  }

  const mean = (arr: number[]) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null

  return {
    totalLaunches: launches.length,
    withPosition: withPos.length,
    meanBurstAltM: mean(bursts),
    meanDurationMin: mean(durations),
    meanDriftKm: mean(drifts),
    driftByOctant: octants,
  }
}

export interface LandingCell {
  lat: number
  lon: number
  count: number
}

// Agrupa posições de pouso em células de ~0.05° para o heatmap.
export function landingDensity(launches: Launch[], cellDeg = 0.05): LandingCell[] {
  const cells = new Map<string, LandingCell>()
  for (const l of launches) {
    if (!l.position) continue
    const latC = Math.round(l.position.lat / cellDeg) * cellDeg
    const lonC = Math.round(l.position.lon / cellDeg) * cellDeg
    const key = `${latC.toFixed(3)},${lonC.toFixed(3)}`
    const cell = cells.get(key)
    if (cell) cell.count++
    else cells.set(key, { lat: latC, lon: lonC, count: 1 })
  }
  return [...cells.values()]
}
