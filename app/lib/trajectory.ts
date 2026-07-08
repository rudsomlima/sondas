/**
 * Trajetória completa de um voo (subida → estouro → descida) a partir do
 * sondehub.org, com análise (altitude de estouro, duração, deriva, taxas).
 *
 * Duas fontes, mesma saída:
 *  - fetchLiveTrajectory: GET api.v2.sondehub.org/sonde/{serial} — voo de
 *    hoje/recente, frames de alta resolução (CORS aberto, fetch do browser).
 *  - fetchArchiveTrajectory: bucket S3 sondehub-history (voos antigos; o
 *    arquivo pode estar resumido a poucos frames — a análise tolera).
 */
import { fetchSondeHubArchiveFramesForDay, SondeHubFrame } from './sondehub'
import { haversineKm, bearingDeg } from './geo'

export interface TrajectoryPoint {
  lat: number
  lon: number
  alt: number
  velV: number
  timeMs: number
}

export interface FlightAnalysis {
  burst: TrajectoryPoint | null
  launch: TrajectoryPoint | null
  landing: TrajectoryPoint | null
  maxAltM: number
  durationMin: number | null
  distanceKm: number | null
  bearingDeg: number | null
  ascentRateMs: number | null
  descentRateMs: number | null
  pointCount: number
}

// Trilha de voo encerrado é imutável — cache em memória por serial.
const trajectoryCache = new Map<string, TrajectoryPoint[]>()

// Converte frames crus do sondehub em pontos ordenados de trajetória.
export function pointsFromFrames(frames: SondeHubFrame[]): TrajectoryPoint[] {
  return frames
    .map(frameToPoint)
    .filter((p): p is TrajectoryPoint => p !== null)
    .sort((a, b) => a.timeMs - b.timeMs)
}

function frameToPoint(f: SondeHubFrame): TrajectoryPoint | null {
  if (typeof f.lat !== 'number' || typeof f.lon !== 'number') return null
  const t = new Date(f.datetime).getTime()
  if (isNaN(t)) return null
  return { lat: f.lat, lon: f.lon, alt: f.alt ?? 0, velV: f.vel_v ?? 0, timeMs: t }
}

// Reduz a trilha pra desenho leve no mapa (polyline com >600 pontos pesa no
// mobile). Mantém primeiro e último pontos sempre.
export function downsample(points: TrajectoryPoint[], maxPoints = 600): TrajectoryPoint[] {
  if (points.length <= maxPoints) return points
  const step = Math.ceil(points.length / maxPoints)
  const out: TrajectoryPoint[] = []
  for (let i = 0; i < points.length; i += step) out.push(points[i])
  if (out[out.length - 1] !== points[points.length - 1]) out.push(points[points.length - 1])
  return out
}

// Voo de hoje/recente — frames do voo inteiro pela API de telemetria.
export async function fetchLiveTrajectory(serial: string): Promise<TrajectoryPoint[]> {
  const cached = trajectoryCache.get(serial)
  if (cached) return cached

  const res = await fetch(`https://api.v2.sondehub.org/sonde/${encodeURIComponent(serial)}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Erro ${res.status} ao consultar trajetória no sondehub.org`)
  const frames: SondeHubFrame[] = await res.json()
  const points = frames
    .map(frameToPoint)
    .filter((p): p is TrajectoryPoint => p !== null)
    .sort((a, b) => a.timeMs - b.timeMs)

  if (points.length > 0) trajectoryCache.set(serial, points)
  return points
}

// Voo antigo — arquivo do bucket S3 (pode ter atraso de meses e poucos pontos).
export async function fetchArchiveTrajectory(
  stationId: string, year: number, month: number, day: number
): Promise<{ serial: string; points: TrajectoryPoint[] } | null> {
  const result = await fetchSondeHubArchiveFramesForDay(stationId, year, month, day)
  if (!result) return null

  const cacheKey = `archive:${result.serial}`
  const cached = trajectoryCache.get(cacheKey)
  if (cached) return { serial: result.serial, points: cached }

  const points = result.frames
    .map(frameToPoint)
    .filter((p): p is TrajectoryPoint => p !== null)
    .sort((a, b) => a.timeMs - b.timeMs)

  if (points.length > 0) trajectoryCache.set(cacheKey, points)
  return { serial: result.serial, points }
}

export function analyzeTrajectory(points: TrajectoryPoint[]): FlightAnalysis {
  if (points.length === 0) {
    return {
      burst: null, launch: null, landing: null, maxAltM: 0,
      durationMin: null, distanceKm: null, bearingDeg: null,
      ascentRateMs: null, descentRateMs: null, pointCount: 0,
    }
  }

  const launch = points[0]
  const landing = points[points.length - 1]

  let burst = points[0]
  for (const p of points) {
    if (p.alt > burst.alt) burst = p
  }

  const durationMs = landing.timeMs - launch.timeMs
  const durationMin = durationMs > 0 ? Math.round(durationMs / 60000) : null
  const distanceKm = haversineKm(launch.lat, launch.lon, landing.lat, landing.lon)
  const bearing = bearingDeg(launch.lat, launch.lon, landing.lat, landing.lon)

  // Taxas médias: só fazem sentido com trilha razoavelmente completa.
  let ascentRateMs: number | null = null
  let descentRateMs: number | null = null
  if (points.length >= 5) {
    const ascentMs = burst.timeMs - launch.timeMs
    const descentMs = landing.timeMs - burst.timeMs
    if (ascentMs > 60_000) ascentRateMs = (burst.alt - launch.alt) / (ascentMs / 1000)
    if (descentMs > 60_000) descentRateMs = (burst.alt - landing.alt) / (descentMs / 1000)
  }

  return {
    burst: burst !== launch ? burst : null,
    launch,
    landing,
    maxAltM: burst.alt,
    durationMin,
    distanceKm,
    bearingDeg: bearing,
    ascentRateMs,
    descentRateMs,
    pointCount: points.length,
  }
}
