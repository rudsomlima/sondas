/**
 * Uma entrada de lançamento por SONDA, e não por slot sinótico da Wyoming.
 *
 * O histórico nasceu modelado pelo arquivo de sondagens da Wyoming: dois
 * horários nominais por dia (00Z/12Z), cada um com no máximo uma sonda casada.
 * Em Natal isso escondia voos reais — 15/09/2026 teve 5 sondas no SondeHub e
 * o app mostrava 2 lançamentos. Aqui as sondas que não casaram com nenhum
 * lançamento viram entradas próprias, e todas ganham o horário do primeiro
 * quadro recebido, os receptores e o último sinal — tudo vindo do registro
 * permanente de sondas no R2 (app/lib/sondeRegistry.ts).
 *
 * Módulo puro (sem browser): as entradas extras são só de EXIBIÇÃO — não
 * entram no YearStore do R2 nem no cache local do ano, que continuam sendo a
 * verdade da Wyoming (ver mergeLaunchCollections em launchData.ts).
 */
import type { FlightStats, Launch, LaunchSources } from './types'
import { isValidPosition, launchInstantMs } from './launchData'
import { gmt3DateWithMonthGuard } from './launchUtils'
import { roundToSynopticHour } from './radiosondy'
import type { SondeRecord } from './sondeRegistry'
import type { SondePoint } from './sondePoints'

const pad = (n: number) => String(n).padStart(2, '0')

function parseIso(s: string | undefined): Date | null {
  if (!s) return null
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T').replace(/z$/i, '') + 'Z')
  return isNaN(d.getTime()) ? null : d
}

/** Serials já representados por algum lançamento da lista. */
export function launchSerials(launches: Launch[]): string[] {
  return launches.flatMap(l => isValidPosition(l.position) && l.position.sondeNumber !== '?' ? [l.position.sondeNumber] : [])
}

/** Todos os serials de lançamentos + pontos (os que valem buscar no registro). */
export function registrySerials(launches: Launch[], points: SondePoint[]): string[] {
  return [...new Set([...launchSerials(launches), ...points.map(p => p.serial)])].filter(s => s && s !== '?')
}

/** Estatísticas do voo guardadas no registro → formato do Launch (Análises). */
export function flightStatsFromRecord(r: SondeRecord | undefined): FlightStats | undefined {
  const f = r?.flight
  if (!f) return undefined
  // Trilha truncada (fonte começou no meio do voo): só o estouro é confiável.
  return f.complete
    ? { burstAltM: f.burstAltM, durationMin: f.durationMin, distanceKm: f.distanceKm, bearingDeg: f.bearingDeg }
    : { burstAltM: f.burstAltM }
}

/**
 * Quais fontes confirmam a sonda, segundo o registro: tem dado de uma fonte
 * = confirmada; a fonte já foi consultada e não tinha nada = ausente; ainda
 * não consultada = indefinido (o selo fica "aguardando"). Wyoming não é
 * tocada aqui — continua vindo do próprio lançamento.
 */
export function sourcesFromRecord(r: SondeRecord | undefined, current?: LaunchSources): LaunchSources | undefined {
  if (!r) return current
  const has = (prefix: string) => r.sources.some(s => s.startsWith(prefix))
  const radiosondy = has('radiosondy') ? true : r.checked?.radiosondy ? false : current?.radiosondy
  const sondehub = has('sondehub') ? true : r.checked?.sondehub ? false : current?.sondehub
  return { ...current, radiosondy, sondehub }
}

/** Campos de exibição que o registro acrescenta a um lançamento. */
function launchFieldsFromRecord(r: SondeRecord | undefined): Partial<Launch> {
  if (!r) return {}
  const receivers = r.receivers?.map(x => x.callsign)
  const withFrames = r.receivers?.filter(x => x.frames) ?? []
  return {
    firstFrameUtc: r.firstFrameUtc,
    receivers: receivers?.length ? receivers : undefined,
    receiverFrames: withFrames.length ? Object.fromEntries(withFrames.map(x => [x.callsign, x.frames!])) : undefined,
    lastReceiver: r.lastReceiver,
    lastReceiverAt: r.lastReceiverAt,
    flightStats: flightStatsFromRecord(r),
  }
}

/**
 * Sonda → lançamento. Com o primeiro quadro conhecido, o horário é exato;
 * sem ele, cai no horário sinótico mais próximo abaixo do último reporte
 * (mesma aproximação de fetchRadiosondyLaunches) e fica marcado `approx`.
 */
export function pointToLaunch(p: SondePoint, rec?: SondeRecord): Launch {
  const first = parseIso(rec?.firstFrameUtc ?? p.firstFrameUtc)
  const utcMs = (first ?? roundToSynopticHour(p.date)).getTime()
  const utcDate = new Date(utcMs)
  const localDate = gmt3DateWithMonthGuard(utcMs)
  const fromRecord = launchFieldsFromRecord(rec)
  return {
    date: `${localDate.getUTCFullYear()}-${pad(localDate.getUTCMonth() + 1)}-${pad(localDate.getUTCDate())}`,
    time_local: `${pad(localDate.getUTCHours())}:${pad(localDate.getUTCMinutes())}`,
    time_utc: `${pad(utcDate.getUTCHours())}:${pad(utcDate.getUTCMinutes())}Z`,
    day: localDate.getUTCDate(),
    month: localDate.getUTCMonth() + 1,
    year: localDate.getUTCFullYear(),
    source: p.sources.includes('radiosondy') ? 'radiosondy' : 'sondehub',
    approx: first ? undefined : true,
    association: p.geographic ? 'geographic' : p.sources.includes('radiosondy') ? 'startplace' : 'station',
    firstFrameUtc: fromRecord.firstFrameUtc ?? p.firstFrameUtc,
    receivers: fromRecord.receivers ?? p.receivers,
    receiverFrames: fromRecord.receiverFrames ?? p.receiverFrames,
    lastReceiver: fromRecord.lastReceiver ?? p.lastReceiver,
    lastReceiverAt: fromRecord.lastReceiverAt ?? p.lastReceiverAt,
    flightStats: fromRecord.flightStats,
    sources: sourcesFromRecord(rec, {
      radiosondy: p.sources.includes('radiosondy') || undefined,
      sondehub: p.sources.includes('sondehub') || p.sources.includes('archive') || undefined,
    }),
    position: {
      lat: p.lat, lon: p.lon, sondeNumber: p.serial, status: p.status,
      altitude: p.altitude, recoveredBy: p.recoveredBy, recoveryNote: p.recoveryNote,
    },
  }
}

// Ordenação: o instante do primeiro quadro tem minutos; launchInstantMs só
// conhece a hora sinótica cheia (é derivado do slot da Wyoming).
export function launchSortMs(l: Launch): number {
  return parseIso(l.firstFrameUtc)?.getTime() ?? launchInstantMs(l)
}

/**
 * Copia do registro pra dentro dos lançamentos que já existem: 1º quadro,
 * receptores, último sinal e — se a posição ainda é UNKNOWN — o status e o
 * relato de recuperação.
 */
export function applyRegistryToLaunches(launches: Launch[], records: Map<string, SondeRecord>): Launch[] {
  if (records.size === 0) return launches
  let changed = false
  const out = launches.map(l => {
    if (!isValidPosition(l.position)) return l
    const rec = records.get(l.position.sondeNumber)
    if (!rec) return l
    const f = launchFieldsFromRecord(rec)
    const position = l.position.status === 'UNKNOWN' && rec.status && rec.status !== 'UNKNOWN'
      ? {
          ...l.position,
          status: rec.status,
          ...(rec.status === 'FOUND' && rec.recoveryPos ? { lat: rec.recoveryPos.lat, lon: rec.recoveryPos.lon } : {}),
          recoveredBy: l.position.recoveredBy ?? rec.recoveredBy,
          recoveryNote: l.position.recoveryNote ?? rec.recoveryNote,
        }
      : l.position
    const next: Launch = {
      ...l,
      firstFrameUtc: f.firstFrameUtc ?? l.firstFrameUtc,
      receivers: f.receivers ?? l.receivers,
      receiverFrames: f.receiverFrames ?? l.receiverFrames,
      lastReceiver: f.lastReceiver ?? l.lastReceiver,
      lastReceiverAt: f.lastReceiverAt ?? l.lastReceiverAt,
      flightStats: f.flightStats ?? l.flightStats,
      sources: sourcesFromRecord(rec, l.sources),
      position,
    }
    if (JSON.stringify(next) === JSON.stringify(l)) return l
    changed = true
    return next
  })
  return changed ? out : launches
}

/**
 * Lançamentos da Wyoming (com o registro aplicado) + uma entrada por sonda do
 * período que não casou com nenhum deles, tudo ordenado por horário.
 */
export function launchesWithSondes(
  launches: Launch[], points: SondePoint[], records: Map<string, SondeRecord>,
): Launch[] {
  const base = applyRegistryToLaunches(launches, records)
  const known = new Set(launchSerials(base))
  const extras: Launch[] = []
  for (const p of points) {
    if (!p.serial || p.serial === '?' || known.has(p.serial)) continue
    known.add(p.serial)
    extras.push(pointToLaunch(p, records.get(p.serial)))
  }
  if (extras.length === 0) return base
  return [...base, ...extras].sort((a, b) => launchSortMs(a) - launchSortMs(b))
}
