/**
 * Posições de sondas vindas de TODAS as fontes, independentes de existir um
 * lançamento da Wyoming casado com elas. Antes cada mapa só desenhava
 * `launch.position` (+ radiosondy.info em alguns casos), então um pouso visto
 * só pelo SondeHub — ou um voo fora do horário sinótico — simplesmente não
 * aparecia até alguém clicar no dia exato. Aqui cada fonte vira um SondePoint,
 * deduplicado por serial, e os mapas desenham a união.
 */
import {
  fetchRadiosondyFeatures, launchUtcInstant,
  type RadiosondyFeature,
} from './radiosondy'
import {
  fetchSondeHubRecentFrames, fetchSondeHubRecentFramesSplit, fetchSondeHubArchiveLaunches, SONDEHUB_RECENT_SECONDS,
  type SondeHubRecentFrame,
} from './sondehub'
import { applyRecoveryToPosition, fetchRecoveries, type SondeRecovery } from './sondehubRecovery'
import { isValidPosition, launchInstantMs } from './launchData'
import { sondePopupHtml, type SondePopupOptions } from './mapPopups'
import type { SondeRecord } from './sondeRegistry'
import type { Launch, LaunchPosition } from './types'
import type { Station } from './stations'

export type SondePointSource = 'cache' | 'radiosondy' | 'sondehub' | 'archive' | 'registry'

export interface SondePoint {
  serial: string
  lat: number
  lon: number
  status: string // FOUND / LOST / UNKNOWN
  date: Date // instante (UTC) do último reporte conhecido
  altitude?: number
  sources: SondePointSource[]
  geographic?: boolean // true = só associado à estação por proximidade
  radiosondyUrl?: string
  recoveredBy?: string  // relato de recuperação do SondeHub (sondehubRecovery.ts)
  recoveryNote?: string
  // Quem participou da recepção RF, em ordem de quadros recebidos
  // (radiosondy.info e SondeHub, via registro no R2 — ver sondeRegistry.ts).
  receivers?: string[]
  receiverFrames?: Record<string, number>
  lastReceiver?: string   // de quem foi o último sinal recebido
  lastReceiverAt?: string // ISO UTC
  firstFrameUtc?: string  // ISO UTC — primeiro dado recebido (= lançamento exibido)
  maxAltM?: number
  frequencyMHz?: number
  sondeType?: string
}

function pointKey(p: SondePoint): string {
  return p.serial && p.serial !== '?' ? p.serial : `${p.lat.toFixed(4)}:${p.lon.toFixed(4)}`
}

function popupAltitude(html: string): number | undefined {
  const m = html.match(/Altitude:\s*(-?[\d.]+)/i)
  const v = m ? Number(m[1]) : NaN
  return Number.isFinite(v) ? v : undefined
}

export function pointFromFeature(f: RadiosondyFeature): SondePoint {
  return {
    serial: f.sondeNumber, lat: f.lat, lon: f.lon, status: f.status, date: f.date,
    altitude: popupAltitude(f.popupContent), sources: ['radiosondy'],
    radiosondyUrl: `https://radiosondy.info/sonde.php?sondenumber=${encodeURIComponent(f.sondeNumber)}`,
  }
}

export function pointsFromLaunches(launches: Launch[]): SondePoint[] {
  const out: SondePoint[] = []
  for (const l of launches) {
    if (!isValidPosition(l.position)) continue
    out.push({
      serial: l.position.sondeNumber, lat: l.position.lat, lon: l.position.lon,
      status: l.position.status, altitude: l.position.altitude,
      date: new Date(launchInstantMs(l)), sources: ['cache'],
      geographic: l.association === 'geographic' || undefined,
      recoveredBy: l.position.recoveredBy, recoveryNote: l.position.recoveryNote,
      receivers: l.receivers, receiverFrames: l.receiverFrames,
      lastReceiver: l.lastReceiver, lastReceiverAt: l.lastReceiverAt,
      firstFrameUtc: l.firstFrameUtc,
    })
  }
  return out
}

/**
 * Une listas de pontos por serial. Posição/instante vêm do reporte mais
 * recente (o último frame de RF do SondeHub costuma estar mais perto do chão
 * que o registro do radiosondy.info); status FOUND/LOST sobrevive a um
 * UNKNOWN de outra fonte; associação geográfica só fica se nenhuma fonte
 * ligar a sonda à estação.
 */
export function mergeSondePoints(...lists: SondePoint[][]): SondePoint[] {
  const byKey = new Map<string, SondePoint>()
  for (const list of lists) {
    for (const p of list) {
      const key = pointKey(p)
      const prev = byKey.get(key)
      if (!prev) { byKey.set(key, { ...p, sources: [...p.sources] }); continue }
      const newer = p.date.getTime() > prev.date.getTime() ? p : prev
      byKey.set(key, {
        ...prev,
        lat: newer.lat, lon: newer.lon, date: newer.date,
        altitude: newer.altitude ?? prev.altitude ?? p.altitude,
        status: prev.status !== 'UNKNOWN' ? prev.status : p.status,
        sources: [...new Set([...prev.sources, ...p.sources])],
        geographic: prev.geographic && p.geographic ? true : undefined,
        radiosondyUrl: prev.radiosondyUrl ?? p.radiosondyUrl,
        recoveredBy: prev.recoveredBy ?? p.recoveredBy,
        recoveryNote: prev.recoveryNote ?? p.recoveryNote,
        receivers: prev.receivers ?? p.receivers,
        receiverFrames: prev.receiverFrames ?? p.receiverFrames,
        lastReceiver: newer.lastReceiver ?? prev.lastReceiver ?? p.lastReceiver,
        lastReceiverAt: newer.lastReceiver ? newer.lastReceiverAt : prev.lastReceiverAt ?? p.lastReceiverAt,
        firstFrameUtc: [prev.firstFrameUtc, p.firstFrameUtc].filter(Boolean).sort()[0],
        maxAltM: Math.max(prev.maxAltM ?? 0, p.maxAltM ?? 0) || undefined,
        frequencyMHz: prev.frequencyMHz ?? p.frequencyMHz,
        sondeType: prev.sondeType ?? p.sondeType,
      })
    }
  }
  return [...byKey.values()]
}

function isoNoMs(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/**
 * Popup único de sonda, usado por TODOS os mapas (painel, mapa do ano, mapa
 * do lançamento) — visual e dados em app/lib/mapPopups.ts.
 */
export function sondePointPopup(p: SondePoint, opts?: SondePopupOptions): string {
  return sondePopupHtml(p, opts)
}

// ---------------------------------------------------------------------------
// Registro de sondas (R2) ↔ pontos do mapa. Ver sondeRegistry.ts.

function registryFields(r: SondeRecord): Partial<SondePoint> {
  const receivers = r.receivers?.map(x => x.callsign)
  const withFrames = r.receivers?.filter(x => x.frames) ?? []
  return {
    recoveredBy: r.recoveredBy, recoveryNote: r.recoveryNote,
    receivers: receivers?.length ? receivers : undefined,
    receiverFrames: withFrames.length ? Object.fromEntries(withFrames.map(x => [x.callsign, x.frames!])) : undefined,
    lastReceiver: r.lastReceiver, lastReceiverAt: r.lastReceiverAt,
    firstFrameUtc: r.firstFrameUtc, maxAltM: r.maxAltM,
    frequencyMHz: r.frequencyMHz, sondeType: r.type,
  }
}

/** Registro → ponto (fonte 'registry'). null se o registro não tem posição. */
export function pointFromRecord(r: SondeRecord): SondePoint | null {
  const where = r.status === 'FOUND' && r.recoveryPos ? r.recoveryPos : r.lastPos
  const when = r.lastPos?.at ?? r.lastFrameUtc ?? r.firstFrameUtc
  if (!where || !when) return null
  const date = new Date(when)
  if (isNaN(date.getTime())) return null
  return {
    serial: r.serial, lat: where.lat, lon: where.lon, status: r.status ?? 'UNKNOWN', date,
    altitude: r.lastPos?.alt, sources: ['registry'],
    ...registryFields(r),
  }
}

/**
 * Completa pontos vindos das fontes com o que o registro sabe (receptores,
 * último sinal, 1º quadro, recuperação). O dado ao vivo vence onde existir; o
 * registro preenche o resto — e promove status UNKNOWN → FOUND/LOST.
 */
export function applyRegistryToPoints(points: SondePoint[], records: Map<string, SondeRecord>): SondePoint[] {
  if (records.size === 0) return points
  let changed = false
  const out = points.map(p => {
    const r = records.get(p.serial)
    if (!r) return p
    const f = registryFields(r)
    // Último sinal: vale o mais recente entre o ponto e o registro.
    const pointNewer = !!p.lastReceiver && (!f.lastReceiverAt || (p.lastReceiverAt ?? '') >= f.lastReceiverAt)
    const next: SondePoint = {
      ...p,
      receivers: f.receivers ?? p.receivers,
      receiverFrames: f.receiverFrames ?? p.receiverFrames,
      lastReceiver: pointNewer ? p.lastReceiver : f.lastReceiver ?? p.lastReceiver,
      lastReceiverAt: pointNewer ? p.lastReceiverAt : f.lastReceiverAt ?? p.lastReceiverAt,
      firstFrameUtc: f.firstFrameUtc ?? p.firstFrameUtc,
      maxAltM: Math.max(p.maxAltM ?? 0, f.maxAltM ?? 0) || undefined,
      frequencyMHz: p.frequencyMHz ?? f.frequencyMHz,
      sondeType: p.sondeType ?? f.sondeType,
      recoveredBy: p.recoveredBy ?? f.recoveredBy,
      recoveryNote: p.recoveryNote ?? f.recoveryNote,
    }
    if (p.status === 'UNKNOWN' && r.status && r.status !== 'UNKNOWN') {
      next.status = r.status
      if (r.status === 'FOUND' && r.recoveryPos) { next.lat = r.recoveryPos.lat; next.lon = r.recoveryPos.lon }
    }
    if (JSON.stringify(next) === JSON.stringify(p)) return p
    changed = true
    return next
  })
  return changed ? out : points
}

/**
 * Registro + pontos das fontes: o registro entra como fonte própria (sondas
 * que as fontes não devolvem mais continuam no mapa) e completa os demais.
 * `include` restringe quais registros viram ponto novo (ex.: só os da
 * estação e do período); completar pontos existentes vale pra qualquer um.
 */
export function mergeWithRegistry(
  points: SondePoint[], records: Map<string, SondeRecord>,
  include?: (record: SondeRecord, point: SondePoint) => boolean,
): SondePoint[] {
  if (records.size === 0) return points
  const fromRegistry: SondePoint[] = []
  for (const r of records.values()) {
    const p = pointFromRecord(r)
    if (p && (!include || include(r, p))) fromRegistry.push(p)
  }
  return applyRegistryToPoints(mergeSondePoints(points, fromRegistry), records)
}

/**
 * Ponto visto numa fonte → registro parcial a gravar no R2. Pontos só do
 * cache de lançamentos (ou só do próprio registro) não têm reporte novo e não
 * viram posição.
 */
export function pointToRecord(p: SondePoint): ({ serial: string } & Partial<SondeRecord>) | null {
  if (!p.serial || p.serial === '?') return null
  const real = p.sources.some(s => s === 'radiosondy' || s === 'sondehub' || s === 'archive')
  if (!real) return null
  const at = isoNoMs(p.date)
  const found = p.status === 'FOUND' && !!p.recoveredBy
  return {
    serial: p.serial,
    status: p.status,
    ...(found ? { recoveryPos: { lat: p.lat, lon: p.lon } } : { lastPos: { lat: p.lat, lon: p.lon, alt: p.altitude, at }, lastFrameUtc: at }),
    recoveredBy: p.recoveredBy,
    recoveryNote: p.recoveryNote,
    lastReceiver: p.lastReceiver,
    lastReceiverAt: p.lastReceiverAt,
    frequencyMHz: p.frequencyMHz,
    type: p.sondeType,
  }
}

export function isPointInMonth(p: SondePoint, year: number, month: number): boolean {
  return p.date.getUTCFullYear() === year && p.date.getUTCMonth() + 1 === month
}

// O SondeHub só guarda ~7 dias no endpoint de telemetria recente.
export function monthOverlapsRecentWindow(year: number, month: number, now = Date.now()): boolean {
  const start = Date.UTC(year, month - 1, 1)
  const end = Date.UTC(year, month, 1)
  return end > now - SONDEHUB_RECENT_SECONDS * 1000 && start <= now
}

export async function fetchRadiosondyMonthPoints(startplace: string, year: number, month: number): Promise<SondePoint[]> {
  return (await fetchRadiosondyFeatures(year, month, startplace)).map(pointFromFeature)
}

function pointsFromRecentFrames(frames: SondeHubRecentFrame[]): SondePoint[] {
  return frames.map(({ serial, frame, association }) => ({
    serial, lat: frame.lat, lon: frame.lon, status: 'UNKNOWN', date: frame.reportDate,
    altitude: frame.alt, sources: ['sondehub'] as SondePointSource[], geographic: association === 'geographic' || undefined,
    lastReceiver: frame.uploaderCallsign,
    lastReceiverAt: frame.uploaderCallsign ? frame.reportDate.toISOString().replace(/\.\d{3}Z$/, 'Z') : undefined,
    frequencyMHz: frame.frequency,
    sondeType: frame.type,
  }))
}

export async function fetchRecentSondeHubPoints(station: Station): Promise<SondePoint[]> {
  return pointsFromRecentFrames(await fetchSondeHubRecentFrames(station.id, station.lat, station.lon))
}

/** Aplica relatos de recuperação do SondeHub nos pontos ainda UNKNOWN. */
export function applyRecoveriesToPoints(points: SondePoint[], recoveries: Map<string, SondeRecovery>): SondePoint[] {
  if (recoveries.size === 0) return points
  let changed = false
  const out = points.map(p => {
    if (p.status !== 'UNKNOWN') return p
    const rec = recoveries.get(p.serial)
    if (!rec) return p
    const pos = applyRecoveryToPosition(pointToPosition(p), rec)
    if (pos.status === 'UNKNOWN') return p
    changed = true
    return { ...p, status: pos.status, lat: pos.lat, lon: pos.lon, recoveredBy: pos.recoveredBy, recoveryNote: pos.recoveryNote }
  })
  return changed ? out : points
}

/** Seriais de pontos/lançamentos ainda UNKNOWN — os que valem consultar. */
export function unknownSerials(points: SondePoint[]): string[] {
  return [...new Set(points.filter(p => p.status === 'UNKNOWN' && p.serial && p.serial !== '?').map(p => p.serial))]
}

export async function enrichPointsWithRecoveries(points: SondePoint[]): Promise<SondePoint[]> {
  const serials = unknownSerials(points)
  if (serials.length === 0) return points
  return applyRecoveriesToPoints(points, await fetchRecoveries(serials))
}

export async function fetchArchiveMonthPoints(stationId: string, year: number, month: number): Promise<SondePoint[]> {
  const launches = await fetchSondeHubArchiveLaunches(stationId, year, month)
  return launches.flatMap(l => l.position ? [{
    serial: l.position.sondeNumber, lat: l.position.lat, lon: l.position.lon, status: l.position.status,
    altitude: l.position.altitude, sources: ['archive'] as SondePointSource[],
    date: launchUtcInstant(l.year, l.month, l.day, l.time_utc, l.time_local),
  }] : [])
}

export interface MonthPointsResult {
  points: SondePoint[]
  sources: SondePointSource[]
  failed: number
}

/** radiosondy.info do mês + SondeHub recente (se o mês cai nos últimos 7 dias) + arquivo (opcional).
 * onProgress recebe a união parcial a cada fonte que responde — o mapa não
 * precisa esperar a mais lenta pra desenhar as outras. */
export async function fetchMonthSondePoints(
  station: Station, year: number, month: number, opts: { archive?: boolean; recent?: boolean } = {},
  onProgress?: (points: SondePoint[]) => void,
): Promise<MonthPointsResult> {
  const tasks: Promise<SondePoint[]>[] = []
  if (station.radiosondyStartplace) tasks.push(fetchRadiosondyMonthPoints(station.radiosondyStartplace, year, month))
  if (opts.recent !== false && monthOverlapsRecentWindow(year, month)) {
    const split = fetchSondeHubRecentFramesSplit(station.id, station.lat, station.lon)
    const inMonth = (frames: SondeHubRecentFrame[]) => pointsFromRecentFrames(frames).filter(p => isPointInMonth(p, year, month))
    tasks.push(split.nearby.then(inMonth), split.site.then(inMonth))
  }
  if (opts.archive) tasks.push(fetchArchiveMonthPoints(station.id, year, month))
  const done: SondePoint[][] = []
  if (onProgress) {
    for (const t of tasks) t.then(ps => { done.push(ps); onProgress(mergeSondePoints(...done)) }).catch(() => {})
  }
  const results = await Promise.allSettled(tasks)
  const ok = results.flatMap(r => r.status === 'fulfilled' ? [r.value] : [])
  const points = mergeSondePoints(...ok)
  return {
    points,
    sources: [...new Set(points.flatMap(p => p.sources))],
    failed: results.length - ok.length,
  }
}

export function pointToPosition(p: SondePoint): LaunchPosition {
  return {
    lat: p.lat, lon: p.lon, sondeNumber: p.serial, status: p.status,
    altitude: p.altitude != null ? Math.round(p.altitude) : undefined,
  }
}

// Mesma janela do matching do radiosondy.info (MAX_MATCH_WINDOW_MS em
// radiosondy.ts), mas só para frente: aqui várias fontes são misturadas e há
// dias com 3 voos (Natal, 10/09/2026), então um pouso ANTES do horário nominal
// é quase sempre de outro lançamento.
const LANDING_WINDOW_MS = 4 * 60 * 60 * 1000

/**
 * Pouso mais próximo depois do horário do lançamento, ignorando seriais já
 * usados. Sondas ligadas à estação (radiosondy.info/startplace, site do
 * SondeHub) têm prioridade sobre as vistas só por proximidade: num raio de
 * 300 km também passam sondas de outros locais de lançamento.
 */
export function findPointForLaunch(launch: Launch, points: SondePoint[], usedSerials = new Set<string>()): SondePoint | null {
  const instant = launchInstantMs(launch)
  const closest = (candidates: SondePoint[]) => {
    let best: SondePoint | null = null
    for (const p of candidates) {
      if (usedSerials.has(p.serial)) continue
      const diff = p.date.getTime() - instant
      if (diff < 0 || diff > LANDING_WINDOW_MS) continue
      if (!best || diff < best.date.getTime() - instant) best = p
    }
    return best
  }
  return closest(points.filter(p => !p.geographic)) ?? closest(points)
}

/**
 * Preenche `position` de lançamentos sem posição com o pouso mais próximo
 * depois do horário de lançamento. Devolve o mesmo array quando nada muda
 * (seguro para usar em efeitos sem loop de renderização).
 */
export function attachPositions(launches: Launch[], points: SondePoint[]): { launches: Launch[]; changed: Launch[] } {
  if (points.length === 0) return { launches, changed: [] }
  const used = new Set(launches.flatMap(l => isValidPosition(l.position) ? [l.position.sondeNumber] : []))
  const pending = launches
    .filter(l => !isValidPosition(l.position))
    .sort((a, b) => launchInstantMs(a) - launchInstantMs(b))
  const resolved = new Map<Launch, Launch>()
  for (const l of pending) {
    const p = findPointForLaunch(l, points, used)
    if (!p) continue
    used.add(p.serial)
    resolved.set(l, { ...l, position: pointToPosition(p) })
  }
  if (resolved.size === 0) return { launches, changed: [] }
  return { launches: launches.map(l => resolved.get(l) ?? l), changed: [...resolved.values()] }
}
