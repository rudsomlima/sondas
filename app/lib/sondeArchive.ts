/**
 * Primeiro quadro recebido de cada sonda (radiosondy.info
 * `sonde_archive.php`), lido via `/api/sonde-archive` — a página exige
 * User-Agent de navegador e não tem CORS, então quem busca é o servidor.
 *
 * É a partir daqui que o app passou a mostrar o horário de lançamento: em vez
 * do horário sinótico nominal da Wyoming (00Z/12Z, um por slot), cada sonda
 * tem o horário do seu **primeiro dado recebido**. Ver app/lib/sondeLaunches.ts
 * pra como isso vira uma entrada de lançamento por sonda.
 *
 * Mesmo padrão de cache do sondehubRecovery.ts: memória + localStorage, TTL
 * longo pro que já terminou, curto pro que ainda pode aparecer.
 */

export interface SondeArchiveInfo {
  serial: string
  firstFrameUtc?: string  // "YYYY-MM-DD HH:mm:ssz" (UTC), como vem da página
  lastFrameUtc?: string
  frames?: number
}

interface CacheEntry { at: number; info: SondeArchiveInfo | null }

const TTL_DONE_MS = 30 * 24 * 3600_000  // voo já encerrado: não muda mais
const TTL_RECENT_MS = 10 * 60_000       // ainda voando/recém-pousada
const TTL_NONE_MS = 60 * 60_000         // sem página no radiosondy.info (ainda)
const RECENT_FLIGHT_MS = 6 * 3600_000
const STORAGE_KEY = 'sondas_sonde_archive_v1'
const BATCH = 8                         // serials por requisição ao proxy
const MAX_SERIALS = 40                  // por chamada de fetchSondeArchives

const memory = new Map<string, CacheEntry>()
let storageLoaded = false

export function parseFrameDate(utcStr: string | undefined): Date | null {
  if (!utcStr) return null
  const d = new Date(utcStr.replace(' ', 'T').replace(/z$/i, '') + 'Z')
  return Number.isNaN(d.getTime()) ? null : d
}

function ttlFor(info: SondeArchiveInfo | null): number {
  if (!info) return TTL_NONE_MS
  const ref = parseFrameDate(info.lastFrameUtc ?? info.firstFrameUtc)
  if (!ref) return TTL_NONE_MS
  return Date.now() - ref.getTime() > RECENT_FLIGHT_MS ? TTL_DONE_MS : TTL_RECENT_MS
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
      if (now - entry.at < ttlFor(entry.info)) obj[serial] = entry
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj))
  } catch { /* localStorage cheio: segue só com a memória */ }
}

function cached(serial: string): CacheEntry | undefined {
  loadStorage()
  const entry = memory.get(serial)
  if (!entry) return undefined
  return Date.now() - entry.at < ttlFor(entry.info) ? entry : undefined
}

/** O que já está em cache válido, sem rede. */
export function cachedArchivesFor(serials: string[]): Map<string, SondeArchiveInfo> {
  const out = new Map<string, SondeArchiveInfo>()
  for (const serial of serials) {
    const info = cached(serial)?.info
    if (info) out.set(serial, info)
  }
  return out
}

/** Serials que ainda não têm resposta em cache (o que vale consultar). */
export function missingArchiveSerials(serials: string[]): string[] {
  loadStorage()
  return [...new Set(serials)].filter(s => s && s !== '?' && cached(s) === undefined)
}

/**
 * Busca os arquivos que faltam, em lotes. Nunca lança: o que falhar
 * simplesmente não entra no mapa (e é reconsultado depois).
 */
export async function fetchSondeArchives(serials: string[]): Promise<Map<string, SondeArchiveInfo>> {
  const wanted = [...new Set(serials.filter(s => s && s !== '?'))]
  const out = cachedArchivesFor(wanted)
  const todo = missingArchiveSerials(wanted).slice(0, MAX_SERIALS)
  for (let i = 0; i < todo.length; i += BATCH) {
    const chunk = todo.slice(i, i + BATCH)
    try {
      const res = await fetch(`/api/sonde-archive?serials=${encodeURIComponent(chunk.join(','))}`, { cache: 'no-store' })
      if (!res.ok) continue
      const json = await res.json() as { sondes?: Record<string, SondeArchiveInfo | null> }
      for (const serial of chunk) {
        const info = json?.sondes?.[serial] ?? null
        memory.set(serial, { at: Date.now(), info })
        if (info) out.set(serial, info)
      }
    } catch { /* rede instável: tenta de novo na próxima passada */ }
  }
  saveStorage()
  return out
}
