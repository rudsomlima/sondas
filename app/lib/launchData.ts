import type { Launch, LaunchPosition, LaunchSources } from './types'
import { launchUtcInstant } from './radiosondy'

const APPROX_MATCH_MS = 6 * 60 * 60 * 1000

export function isValidCoordinate(lat: unknown, lon: unknown): lat is number {
  return typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90 &&
    typeof lon === 'number' && Number.isFinite(lon) && lon >= -180 && lon <= 180
}

export function isValidPosition(position: LaunchPosition | undefined): position is LaunchPosition {
  return !!position && isValidCoordinate(position.lat, position.lon) &&
    typeof position.sondeNumber === 'string' && position.sondeNumber.trim().length > 0
}

export function isValidLaunch(launch: unknown): launch is Launch {
  if (!launch || typeof launch !== 'object') return false
  const l = launch as Launch
  if (!/^\d{4}-\d{2}-\d{2}$/.test(l.date) || !/^\d{2}:\d{2}$/.test(l.time_local) ||
      !/^\d{2}:\d{2}Z$/.test(l.time_utc)) return false
  if (!Number.isInteger(l.year) || !Number.isInteger(l.month) || !Number.isInteger(l.day) ||
      l.month < 1 || l.month > 12 || l.day < 1 || l.day > 31) return false
  const date = new Date(`${l.date}T12:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === l.date &&
    (!l.position || isValidPosition(l.position))
}

export function launchInstantMs(l: Launch): number {
  return launchUtcInstant(l.year, l.month, l.day, l.time_utc, l.time_local).getTime()
}

function sourceRank(l: Launch): number {
  if (!l.source) return 3
  if (l.source === 'sondehub') return 2
  return 1
}

function mergeSources(a?: LaunchSources, b?: LaunchSources): LaunchSources | undefined {
  if (!a && !b) return undefined
  const merge = (x: boolean | undefined, y: boolean | undefined) => x === true || y === true
    ? true
    : x === false || y === false ? false : undefined
  return {
    wyoming: merge(a?.wyoming, b?.wyoming),
    radiosondy: merge(a?.radiosondy, b?.radiosondy),
    sondehub: merge(a?.sondehub, b?.sondehub),
  }
}

function mergePair(a: Launch, b: Launch): Launch {
  const preferred = sourceRank(b) > sourceRank(a) ? b : a
  const other = preferred === a ? b : a
  let position = isValidPosition(preferred.position)
    ? preferred.position
    : isValidPosition(other.position) ? other.position : undefined
  // Mesma sonda: FOUND/LOST (recuperação do radiosondy.info ou do SondeHub)
  // sobrevive a um UNKNOWN da outra cópia — senão um YearStore antigo do
  // servidor desfazia a recuperação já conhecida no cache local.
  if (position && position.status === 'UNKNOWN' && isValidPosition(other.position) &&
      other.position.sondeNumber === position.sondeNumber && other.position.status !== 'UNKNOWN') {
    position = other.position
  }
  return {
    ...other,
    ...preferred,
    position,
    flightStats: preferred.flightStats ?? other.flightStats,
    radiosondyMatch: preferred.radiosondyMatch ?? other.radiosondyMatch,
    wyomingDataOk: preferred.wyomingDataOk ?? other.wyomingDataOk,
    sources: mergeSources(a.sources, b.sources),
    association: preferred.association ?? other.association,
    approx: preferred.approx && other.approx ? true : undefined,
  }
}

export function sameMission(a: Launch, b: Launch): boolean {
  if (a.date === b.date && a.time_utc === b.time_utc) return true
  if (isValidPosition(a.position) && isValidPosition(b.position) &&
      a.position.sondeNumber !== '?' && a.position.sondeNumber === b.position.sondeNumber) return true
  if (!a.approx && !b.approx) return false
  return Math.abs(launchInstantMs(a) - launchInstantMs(b)) <= APPROX_MATCH_MS
}

/**
 * Reconciles cache/server/provider records without throwing away richer data.
 * Official Wyoming timing wins; positions, trajectory metrics and positive
 * source confirmations survive when a less enriched response arrives later.
 */
export function mergeLaunchCollections(...collections: Launch[][]): Launch[] {
  const merged: Launch[] = []
  for (const collection of collections) {
    for (const launch of collection) {
      if (!isValidLaunch(launch)) continue
      let index = merged.findIndex(existing =>
        (existing.date === launch.date && existing.time_utc === launch.time_utc) ||
        (isValidPosition(existing.position) && isValidPosition(launch.position) &&
          existing.position.sondeNumber !== '?' && existing.position.sondeNumber === launch.position.sondeNumber)
      )
      if (index === -1 && launch.approx) {
        const candidates = merged
          .map((existing, i) => ({ i, distance: Math.abs(launchInstantMs(existing) - launchInstantMs(launch)), existing }))
          .filter(c => (c.existing.approx || launch.approx) && c.distance <= APPROX_MATCH_MS)
          .sort((a, b) => a.distance - b.distance)
        index = candidates[0]?.i ?? -1
      }
      if (index === -1) merged.push(launch)
      else merged[index] = mergePair(merged[index], launch)
    }
  }
  return merged.sort((a, b) => launchInstantMs(a) - launchInstantMs(b))
}

export function sourceCounts(launches: Launch[]) {
  return {
    wyoming: launches.filter(l => !l.source || l.sources?.wyoming).length,
    radiosondy: launches.filter(l => l.source === 'radiosondy' || l.sources?.radiosondy).length,
    sondehub: launches.filter(l => l.source === 'sondehub' || l.sources?.sondehub).length,
    positioned: launches.filter(l => isValidPosition(l.position)).length,
    approximate: launches.filter(l => l.approx).length,
  }
}

/**
 * Lançamentos sem nada da Wyoming (liga/desliga em Configurações, ver
 * app/lib/appSettings.ts): descarta os que vieram dela (`!source`) e apaga o
 * que ela disse dos demais (confirmação W, checagem da sondagem).
 */
export function withoutWyoming(launches: Launch[]): Launch[] {
  return launches
    .filter(l => !!l.source)
    .map(l => {
      if (l.sources?.wyoming === undefined && l.wyomingDataOk === undefined) return l
      const { wyomingDataOk: _drop, ...rest } = l
      return { ...rest, sources: l.sources ? { ...l.sources, wyoming: undefined } : undefined }
    })
}
