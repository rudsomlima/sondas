/**
 * Relatos de recuperação física do SondeHub (quem foi buscar a sonda e se
 * achou) — https://api.v2.sondehub.org/recovered?serial=X. Posições que vêm só
 * da telemetria RF do SondeHub nascem com status 'UNKNOWN'; isto transforma
 * em FOUND/LOST quando alguém registrou a recuperação no SondeHub (caso real:
 * X2932841 e X3043555, recuperadas por PS7BL em 09/09/2026, apareciam como
 * UNKNOWN no histórico).
 *
 * Só consulta por SERIAL: a busca por área (lat/lon/distance + datetime/
 * duration) é inconsistente — a mesma recuperação some ou aparece conforme a
 * data de referência (testado em 2026-09-15). Módulo puro, usado no navegador
 * (com cache em localStorage) e no cron do servidor (cache só em memória).
 */
import type { Launch, LaunchPosition } from './types'

export interface SondeRecovery {
  serial: string
  recovered: boolean // true = achada; false = foi buscar e não achou (ou planejada)
  planned: boolean   // true = recuperação só planejada, ainda não aconteceu
  recoveredBy?: string
  description?: string
  datetime?: string  // ISO UTC do relato
  lat?: number
  lon?: number
}

interface CacheEntry { at: number; rec: SondeRecovery | null }

// Relato "achada" não muda mais; "não achada/planejada" pode virar achada;
// sem relato nenhum pode ganhar um nas próximas horas/dias.
const TTL_FOUND_MS = 30 * 24 * 3600_000
const TTL_OTHER_MS = 6 * 3600_000
const TTL_NONE_MS = 3 * 3600_000
const STORAGE_KEY = 'sondas_recovery_v1'
const CONCURRENCY = 4

const memory = new Map<string, CacheEntry>()
let storageLoaded = false

function ttlFor(rec: SondeRecovery | null): number {
  if (!rec) return TTL_NONE_MS
  return rec.recovered ? TTL_FOUND_MS : TTL_OTHER_MS
}

function loadStorage() {
  if (storageLoaded || typeof window === 'undefined') return
  storageLoaded = true
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const obj = raw ? JSON.parse(raw) as Record<string, CacheEntry> : {}
    for (const [serial, entry] of Object.entries(obj)) {
      if (entry && typeof entry.at === 'number') memory.set(serial, entry)
    }
  } catch { /* cache inválido: ignora */ }
}

function saveStorage() {
  if (typeof window === 'undefined') return
  try {
    const now = Date.now()
    const obj: Record<string, CacheEntry> = {}
    for (const [serial, entry] of memory) {
      if (now - entry.at < ttlFor(entry.rec)) obj[serial] = entry
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj))
  } catch { /* localStorage cheio: segue só com a memória */ }
}

function cached(serial: string): CacheEntry | undefined {
  loadStorage()
  const entry = memory.get(serial)
  if (!entry) return undefined
  return Date.now() - entry.at < ttlFor(entry.rec) ? entry : undefined
}

/** Recuperação já conhecida (cache válido), sem rede. */
export function cachedRecovery(serial: string): SondeRecovery | null | undefined {
  return cached(serial)?.rec
}

async function fetchOne(serial: string): Promise<SondeRecovery | null> {
  const res = await fetch(`https://api.v2.sondehub.org/recovered?serial=${encodeURIComponent(serial)}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Erro ${res.status} ao consultar recuperação no sondehub.org`)
  const data: unknown = await res.json()
  if (!Array.isArray(data) || data.length === 0) return null
  // Pode haver mais de um relato (ex.: planejada e depois achada): vale o mais recente.
  const latest = [...data]
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .sort((a, b) => String(a.datetime ?? '').localeCompare(String(b.datetime ?? '')))
    .at(-1)
  if (!latest) return null
  return {
    serial,
    recovered: latest.recovered === true,
    planned: latest.planned === true,
    recoveredBy: typeof latest.recovered_by === 'string' ? latest.recovered_by : undefined,
    description: typeof latest.description === 'string' ? latest.description : undefined,
    datetime: typeof latest.datetime === 'string' ? latest.datetime : undefined,
    lat: typeof latest.lat === 'number' ? latest.lat : undefined,
    lon: typeof latest.lon === 'number' ? latest.lon : undefined,
  }
}

/** Busca (com cache) o relato de cada serial. Falha de rede num serial não
 * derruba os outros nem entra no cache. */
export async function fetchRecoveries(serials: string[]): Promise<Map<string, SondeRecovery>> {
  const out = new Map<string, SondeRecovery>()
  const pending: string[] = []
  for (const serial of new Set(serials.filter(s => s && s !== '?'))) {
    const entry = cached(serial)
    if (entry) { if (entry.rec) out.set(serial, entry.rec) }
    else pending.push(serial)
  }
  let dirty = false
  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    const batch = pending.slice(i, i + CONCURRENCY)
    const results = await Promise.allSettled(batch.map(fetchOne))
    results.forEach((r, j) => {
      if (r.status !== 'fulfilled') return
      memory.set(batch[j], { at: Date.now(), rec: r.value })
      dirty = true
      if (r.value) out.set(batch[j], r.value)
    })
  }
  if (dirty) saveStorage()
  return out
}

/** Status equivalente ao do radiosondy.info; null = relato não muda nada (só planejada). */
export function recoveryStatus(rec: SondeRecovery): 'FOUND' | 'LOST' | null {
  if (rec.recovered) return 'FOUND'
  if (!rec.planned) return 'LOST'
  return null
}

/** Aplica o relato numa posição UNKNOWN. Recuperada: usa as coordenadas do
 * relato (lugar onde a sonda foi achada, mais preciso que o último frame RF). */
export function applyRecoveryToPosition(pos: LaunchPosition, rec: SondeRecovery | undefined): LaunchPosition {
  if (!rec || pos.status !== 'UNKNOWN') return pos
  const status = recoveryStatus(rec)
  if (!status) return pos
  const useRecCoords = rec.recovered && typeof rec.lat === 'number' && typeof rec.lon === 'number' && !(rec.lat === 0 && rec.lon === 0)
  return {
    ...pos,
    status,
    lat: useRecCoords ? rec.lat! : pos.lat,
    lon: useRecCoords ? rec.lon! : pos.lon,
    recoveredBy: rec.recoveredBy,
    recoveryNote: rec.description,
  }
}

/** Seriais de lançamentos com posição UNKNOWN. */
export function unknownLaunchSerials(launches: Launch[]): string[] {
  return [...new Set(launches
    .map(l => l.position)
    .filter((p): p is LaunchPosition => !!p && p.status === 'UNKNOWN' && !!p.sondeNumber && p.sondeNumber !== '?')
    .map(p => p.sondeNumber))]
}

/** Aplica os relatos nos lançamentos; `changed` = só os que mudaram (pra gravar no cache). */
export function applyRecoveriesToLaunches(launches: Launch[], recoveries: Map<string, SondeRecovery>): { launches: Launch[]; changed: Launch[] } {
  const changed: Launch[] = []
  if (recoveries.size === 0) return { launches, changed }
  const out = launches.map(l => {
    if (!l.position || l.position.status !== 'UNKNOWN') return l
    const position = applyRecoveryToPosition(l.position, recoveries.get(l.position.sondeNumber))
    if (position === l.position) return l
    const next = { ...l, position }
    changed.push(next)
    return next
  })
  return { launches: changed.length > 0 ? out : launches, changed }
}

/** Só o que já está em cache (sem rede). */
export function cachedRecoveriesFor(serials: string[]): Map<string, SondeRecovery> {
  const out = new Map<string, SondeRecovery>()
  for (const s of serials) {
    const rec = cachedRecovery(s)
    if (rec) out.set(s, rec)
  }
  return out
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c] ?? c))
}

/** Linhas extras de popup (HTML) com quem recuperou e a nota. */
export function recoveryPopupHtml(recoveredBy?: string, note?: string): string {
  if (!recoveredBy && !note) return ''
  return (recoveredBy ? `<div><b>Recuperada por:</b> ${escapeHtml(recoveredBy)}</div>` : '') +
    (note ? `<div style="font-size:11px;font-style:italic;max-width:240px">“${escapeHtml(note)}”</div>` : '')
}
