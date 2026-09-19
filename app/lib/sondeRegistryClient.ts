/**
 * Lado do navegador do registro permanente de sondas (ver sondeRegistry.ts e
 * /api/sonde-registry). Três operações:
 *
 *  - `fetchRegistryYear` — lê do R2 tudo que já se sabe das sondas de um ano
 *    (filtrado por estação). É o "complemento" dos mapas: o que as fontes não
 *    devolvem mais continua aparecendo.
 *  - `enrichSondes` — pede ao servidor que consulte as fontes pesadas
 *    (radiosondy.info página + dados, SondeHub telemetria + recuperação) pras
 *    sondas ainda incompletas; o servidor grava no R2 e devolve.
 *  - `reportSondes` — manda pro R2 o que o navegador viu nas fontes leves
 *    (posições, status, último receptor). Agrupado e sem repetir o mesmo dado.
 *
 * Cache: memória + localStorage (`sondas_registry_v1`), pra abrir os mapas
 * instantaneamente com o que já se sabia.
 */
import { mergeSondeRecords, needsEnrichment, type SondeRecord } from './sondeRegistry'

const STORAGE_KEY = 'sondas_registry_v1'
const MAX_STORED = 2500
const YEAR_TTL_MS = 60_000
const ENRICH_BATCH = 6
const REPORT_DEBOUNCE_MS = 2500
const REPORT_MIN_INTERVAL_MS = 60_000

const memory = new Map<string, SondeRecord>()
let storageLoaded = false
const listeners = new Set<() => void>()

function loadStorage() {
  if (storageLoaded || typeof window === 'undefined') return
  storageLoaded = true
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const obj = raw ? JSON.parse(raw) as Record<string, SondeRecord> : {}
    for (const [serial, rec] of Object.entries(obj)) {
      if (rec && typeof rec.serial === 'string') memory.set(serial, rec)
    }
  } catch { /* cache inválido: ignora */ }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSave() {
  if (typeof window === 'undefined' || saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    try {
      const all = [...memory.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_STORED)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(all.map(r => [r.serial, r]))))
    } catch { /* localStorage cheio: segue só com a memória */ }
  }, 1000)
}

function absorb(records: SondeRecord[]): boolean {
  loadStorage()
  let changed = false
  for (const r of records) {
    if (!r?.serial) continue
    const prev = memory.get(r.serial)
    const merged = mergeSondeRecords(prev, r)
    if (prev && JSON.stringify(prev) === JSON.stringify(merged)) continue
    memory.set(r.serial, merged)
    changed = true
  }
  if (changed) {
    scheduleSave()
    for (const l of listeners) l()
  }
  return changed
}

/** Avisa quando o cache local muda (pra hooks re-renderizarem). */
export function subscribeRegistry(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function cachedRecords(serials?: Iterable<string>): Map<string, SondeRecord> {
  loadStorage()
  if (!serials) return new Map(memory)
  const out = new Map<string, SondeRecord>()
  for (const s of serials) {
    const r = memory.get(s)
    if (r) out.set(s, r)
  }
  return out
}

// ---------------------------------------------------------------------------

const yearFetches = new Map<string, { at: number; promise: Promise<SondeRecord[]> }>()

export function fetchRegistryYear(year: number, station?: string): Promise<SondeRecord[]> {
  const key = `${year}_${station ?? ''}`
  const hit = yearFetches.get(key)
  if (hit && Date.now() - hit.at < YEAR_TTL_MS) return hit.promise
  const qs = new URLSearchParams({ year: String(year) })
  if (station) qs.set('station', station)
  const promise = fetch(`/api/sonde-registry?${qs}`, { cache: 'no-store' })
    .then(r => r.ok ? r.json() : { records: [] })
    .then((j: { records?: SondeRecord[] }) => {
      const records = Array.isArray(j?.records) ? j.records : []
      absorb(records)
      return records
    })
    .catch(() => [] as SondeRecord[])
  yearFetches.set(key, { at: Date.now(), promise })
  return promise
}

// ---------------------------------------------------------------------------

// Uma tentativa por serial por sessão (além do que needsEnrichment decide):
// sem isso uma sonda sem dados em fonte nenhuma seria repedida a cada render.
const attempted = new Map<string, number>()
const ATTEMPT_RETRY_MS = 10 * 60_000

export function serialsNeedingEnrichment(serials: Iterable<string>): string[] {
  loadStorage()
  const now = Date.now()
  const out: string[] = []
  for (const s of new Set(serials)) {
    if (!s || s === '?') continue
    const last = attempted.get(s)
    if (last && now - last < ATTEMPT_RETRY_MS) continue
    const plan = needsEnrichment(memory.get(s), now)
    if (plan.radiosondy || plan.sondehub || plan.recovered) out.push(s)
  }
  return out
}

let enrichChain: Promise<unknown> = Promise.resolve()

/**
 * Pede enriquecimento em lotes pequenos, um lote por vez (cada lote pode
 * baixar alguns MB no servidor). `max` limita quantos serials por chamada.
 */
export function enrichSondes(serials: string[], station?: string, max = 60): Promise<Map<string, SondeRecord>> {
  const todo = serialsNeedingEnrichment(serials).slice(0, max)
  const now = Date.now()
  for (const s of todo) attempted.set(s, now)
  const run = async () => {
    const out = new Map<string, SondeRecord>()
    for (let i = 0; i < todo.length; i += ENRICH_BATCH) {
      const chunk = todo.slice(i, i + ENRICH_BATCH)
      try {
        const res = await fetch('/api/sonde-registry/enrich', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serials: chunk, station }),
        })
        if (!res.ok) continue
        const j = await res.json() as { records?: SondeRecord[] }
        const records = Array.isArray(j?.records) ? j.records : []
        absorb(records)
        for (const r of records) out.set(r.serial, r)
      } catch { /* rede: fica pra próxima */ }
    }
    return out
  }
  // Serializa entre chamadores (painel + mapa do ano abertos juntos).
  const p = enrichChain.then(run, run)
  enrichChain = p.catch(() => {})
  return p
}

// ---------------------------------------------------------------------------

const pending = new Map<string, { rec: Partial<SondeRecord> & { serial: string }; station?: string }>()
const lastSent = new Map<string, { json: string; at: number }>()
let reportTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Envia pro R2 o que foi visto nas fontes. Não repete um conteúdo já enviado
 * e manda cada serial no máximo uma vez por minuto (sondas ao vivo mudam a
 * cada poll de 20 s — não precisa de uma gravação por poll).
 */
export function reportSondes(records: (Partial<SondeRecord> & { serial: string })[], station?: string) {
  if (typeof window === 'undefined') return
  for (const rec of records) {
    if (!rec?.serial || rec.serial === '?') continue
    pending.set(`${station ?? ''}|${rec.serial}`, { rec, station })
  }
  // Também já entra no cache local (a tela usa na hora).
  absorb(records.map(r => ({ sources: ['app'], updatedAt: Date.now(), ...r }) as SondeRecord))
  if (!reportTimer) reportTimer = setTimeout(flushReports, REPORT_DEBOUNCE_MS)
}

async function flushReports() {
  reportTimer = null
  const now = Date.now()
  const byStation = new Map<string, (Partial<SondeRecord> & { serial: string })[]>()
  for (const [key, { rec, station }] of pending) {
    const json = JSON.stringify(rec)
    const prev = lastSent.get(key)
    if (prev && (prev.json === json || now - prev.at < REPORT_MIN_INTERVAL_MS)) {
      if (prev.json === json) pending.delete(key)
      continue // o intervalo mínimo ainda não passou: fica pendente
    }
    pending.delete(key)
    lastSent.set(key, { json, at: now })
    const list = byStation.get(station ?? '') ?? []
    list.push(rec)
    byStation.set(station ?? '', list)
  }
  for (const [station, recs] of byStation) {
    for (let i = 0; i < recs.length; i += 200) {
      const chunk = recs.slice(i, i + 200)
      let ok = false
      try {
        const res = await fetch('/api/sonde-registry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ records: chunk, station: station || undefined }),
        })
        ok = res.ok
      } catch { /* rede */ }
      // Falhou: esquece o "já enviado" pra o mesmo dado ser reenviado no
      // próximo reporte, em vez de ficar perdido por ser igual ao anterior.
      if (!ok) for (const r of chunk) lastSent.delete(`${station}|${r.serial}`)
    }
  }
  if (pending.size > 0 && !reportTimer) reportTimer = setTimeout(flushReports, REPORT_MIN_INTERVAL_MS)
}
