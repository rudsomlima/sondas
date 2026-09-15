/**
 * Posições de sondas vindas de TODAS as fontes, independentes de existir um
 * lançamento da Wyoming casado com elas. Antes cada mapa só desenhava
 * `launch.position` (+ radiosondy.info em alguns casos), então um pouso visto
 * só pelo SondeHub — ou um voo fora do horário sinótico — simplesmente não
 * aparecia até alguém clicar no dia exato. Aqui cada fonte vira um SondePoint,
 * deduplicado por serial, e os mapas desenham a união.
 */
import {
  fetchRadiosondyFeatures, sondeHubUrl, launchUtcInstant,
  type RadiosondyFeature,
} from './radiosondy'
import {
  fetchSondeHubRecentFrames, fetchSondeHubRecentFramesSplit, fetchSondeHubArchiveLaunches, SONDEHUB_RECENT_SECONDS,
  type SondeHubRecentFrame,
} from './sondehub'
import { applyRecoveryToPosition, fetchRecoveries, recoveryPopupHtml, type SondeRecovery } from './sondehubRecovery'
import { isValidPosition, launchInstantMs } from './launchData'
import { GMT3 } from './types'
import type { Launch, LaunchPosition } from './types'
import type { Station } from './stations'

export type SondePointSource = 'cache' | 'radiosondy' | 'sondehub' | 'archive'

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
}

const SOURCE_LABELS: Record<SondePointSource, string> = {
  cache: 'histórico consolidado',
  radiosondy: 'radiosondy.info',
  sondehub: 'SondeHub',
  archive: 'arquivo SondeHub',
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
      })
    }
  }
  return [...byKey.values()]
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c] ?? c))
}

export function sondePointPopup(p: SondePoint): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const local = new Date(p.date.getTime() + GMT3)
  const localTime = `${pad(local.getUTCDate())}/${pad(local.getUTCMonth() + 1)}/${local.getUTCFullYear()} ` +
    `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`
  const onlyCache = p.sources.length === 1 && p.sources[0] === 'cache'
  const links = [
    p.radiosondyUrl ? `<a href="${p.radiosondyUrl}" target="_blank" rel="noopener noreferrer">radiosondy.info ↗</a>` : '',
    `<a href="${sondeHubUrl(p.serial, p.lat, p.lon)}" target="_blank" rel="noopener noreferrer">SondeHub ↗</a>`,
    `<a href="https://www.openstreetmap.org/directions?route=%3B${p.lat},${p.lon}" target="_blank" rel="noopener noreferrer">Navegar ↗</a>`,
  ].filter(Boolean).join(' · ')
  return `<div style="min-width:200px;line-height:1.45">` +
    `<div style="font-size:15px;font-weight:700;margin-bottom:3px">${escapeHtml(p.serial)}</div>` +
    `<div><b>Status:</b> ${escapeHtml(p.status)}</div>` +
    recoveryPopupHtml(p.recoveredBy, p.recoveryNote) +
    `<div><b>${onlyCache ? 'Lançamento' : 'Último reporte'}:</b> ${localTime} GMT-3</div>` +
    (p.altitude != null ? `<div><b>Altitude:</b> ${Math.round(p.altitude).toLocaleString('pt-BR')} m</div>` : '') +
    `<div><b>Posição:</b> ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}</div>` +
    `<div><b>Fonte:</b> ${p.sources.map(s => SOURCE_LABELS[s]).join(' + ')}</div>` +
    (p.geographic ? `<div style="font-size:11px;color:#b45309">Associada por proximidade — pode ser de outra estação</div>` : '') +
    `<div style="margin-top:6px">${links}</div>` +
    `</div>`
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
