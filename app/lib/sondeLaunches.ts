/**
 * Uma entrada de lançamento por SONDA, e não por slot sinótico da Wyoming.
 *
 * O histórico nasceu modelado pelo arquivo de sondagens da Wyoming: dois
 * horários nominais por dia (00Z/12Z), cada um com no máximo uma sonda casada.
 * Em Natal isso escondia voos reais — 15/09/2026 teve 5 sondas no SondeHub e
 * o app mostrava 2 lançamentos. Aqui as sondas que não casaram com nenhum
 * lançamento viram entradas próprias, e todas ganham o horário do primeiro
 * quadro recebido (app/lib/sondeArchive.ts) quando o radiosondy.info tem a
 * página da sonda.
 *
 * Módulo puro (sem browser): as entradas extras são só de EXIBIÇÃO — não
 * entram no YearStore do R2 nem no cache local do ano, que continuam sendo a
 * verdade da Wyoming (ver mergeLaunchCollections em launchData.ts).
 */
import type { Launch } from './types'
import { isValidPosition, launchInstantMs } from './launchData'
import { gmt3DateWithMonthGuard } from './launchUtils'
import { roundToSynopticHour } from './radiosondy'
import { parseFrameDate, type SondeArchiveInfo } from './sondeArchive'
import type { SondePoint } from './sondePoints'

const pad = (n: number) => String(n).padStart(2, '0')

/** Serials já representados por algum lançamento da lista. */
export function launchSerials(launches: Launch[]): string[] {
  return launches.flatMap(l => isValidPosition(l.position) && l.position.sondeNumber !== '?' ? [l.position.sondeNumber] : [])
}

/** Todos os serials que valem consultar no arquivo do radiosondy.info. */
export function archiveSerials(launches: Launch[], points: SondePoint[]): string[] {
  return [...new Set([...launchSerials(launches), ...points.map(p => p.serial)])].filter(s => s && s !== '?')
}

/**
 * Sonda → lançamento. Com o primeiro quadro conhecido, o horário é exato;
 * sem ele, cai no horário sinótico mais próximo abaixo do último reporte
 * (mesma aproximação de fetchRadiosondyLaunches) e fica marcado `approx`.
 */
export function pointToLaunch(p: SondePoint, info?: SondeArchiveInfo): Launch {
  const first = parseFrameDate(info?.firstFrameUtc)
  const exact = !!first
  const utcMs = (first ?? roundToSynopticHour(p.date)).getTime()
  const utcDate = new Date(utcMs)
  const localDate = gmt3DateWithMonthGuard(utcMs)
  return {
    date: `${localDate.getUTCFullYear()}-${pad(localDate.getUTCMonth() + 1)}-${pad(localDate.getUTCDate())}`,
    time_local: `${pad(localDate.getUTCHours())}:${pad(localDate.getUTCMinutes())}`,
    time_utc: `${pad(utcDate.getUTCHours())}:${pad(utcDate.getUTCMinutes())}Z`,
    day: localDate.getUTCDate(),
    month: localDate.getUTCMonth() + 1,
    year: localDate.getUTCFullYear(),
    source: p.sources.includes('radiosondy') ? 'radiosondy' : 'sondehub',
    approx: exact ? undefined : true,
    association: p.geographic ? 'geographic' : p.sources.includes('radiosondy') ? 'startplace' : 'station',
    firstFrameUtc: info?.firstFrameUtc,
    position: {
      lat: p.lat, lon: p.lon, sondeNumber: p.serial, status: p.status,
      altitude: p.altitude, recoveredBy: p.recoveredBy, recoveryNote: p.recoveryNote,
    },
  }
}

// Ordenação: o instante do primeiro quadro tem minutos; launchInstantMs só
// conhece a hora sinótica cheia (é derivado do slot da Wyoming).
export function launchSortMs(l: Launch): number {
  return parseFrameDate(l.firstFrameUtc)?.getTime() ?? launchInstantMs(l)
}

/** Copia o primeiro quadro conhecido pra dentro dos lançamentos que já existem. */
export function applyArchivesToLaunches(launches: Launch[], archives: Map<string, SondeArchiveInfo>): Launch[] {
  if (archives.size === 0) return launches
  let changed = false
  const out = launches.map(l => {
    if (!isValidPosition(l.position)) return l
    const first = archives.get(l.position.sondeNumber)?.firstFrameUtc
    if (!first || l.firstFrameUtc === first) return l
    changed = true
    return { ...l, firstFrameUtc: first }
  })
  return changed ? out : launches
}

/**
 * Lançamentos da Wyoming (com o horário real aplicado) + uma entrada por
 * sonda do mês que não casou com nenhum deles, tudo ordenado por horário.
 */
export function launchesWithSondes(
  launches: Launch[], points: SondePoint[], archives: Map<string, SondeArchiveInfo>,
): Launch[] {
  const base = applyArchivesToLaunches(launches, archives)
  const known = new Set(launchSerials(base))
  const extras: Launch[] = []
  for (const p of points) {
    if (!p.serial || p.serial === '?' || known.has(p.serial)) continue
    known.add(p.serial)
    extras.push(pointToLaunch(p, archives.get(p.serial)))
  }
  if (extras.length === 0) return base
  return [...base, ...extras].sort((a, b) => launchSortMs(a) - launchSortMs(b))
}
