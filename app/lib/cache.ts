/**
 * Cache storage para histórico de radiossondagens
 * Persiste dados no localStorage com validação e versionamento
 */

export interface CacheEntry {
  year: number
  month: number
  launches: any[]
  timestamp: number
  version: number // para detectar alterações de formato
  station?: string // ausente = estação padrão (82599), para compatibilidade com cache antigo
}

const CACHE_KEY = 'sondas_cache_v1'
const CACHE_VERSION = 1
const DEFAULT_STATION = '82599'

function stationOf(e: { station?: string }): string {
  return e.station ?? DEFAULT_STATION
}

/**
 * Lê todas as entradas de cache
 */
export function readCache(): CacheEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const data = localStorage.getItem(CACHE_KEY)
    if (!data) return []
    const entries = JSON.parse(data)
    if (!Array.isArray(entries)) return []
    return entries.filter(validateEntry)
  } catch {
    return []
  }
}

/**
 * Salva uma entrada de cache
 */
export function writeCache(entry: CacheEntry): void {
  if (typeof window === 'undefined') return
  try {
    const entries = readCache()
    const station = stationOf(entry)
    // Remove entrada antiga se existir
    const filtered = entries.filter(e => !(e.year === entry.year && e.month === entry.month && stationOf(e) === station))
    // Remove lançamentos com ano/mês errado antes de salvar (defesa contra dado corrompido da API)
    const sanitizedLaunches = (entry.launches ?? []).filter(
      (l: any) => l?.year === entry.year && l?.month === entry.month
    )
    filtered.push({ ...entry, launches: sanitizedLaunches, station, timestamp: Date.now(), version: CACHE_VERSION })
    localStorage.setItem(CACHE_KEY, JSON.stringify(filtered))
  } catch (e) {
    console.warn('Erro ao salvar cache:', e)
  }
}

/**
 * Lê cache para mês específico
 */
export function getCacheEntry(year: number, month: number, station: string = DEFAULT_STATION): CacheEntry | null {
  const entries = readCache()
  return entries.find(e => e.year === year && e.month === month && stationOf(e) === station) ?? null
}

/**
 * Lê todos os meses de um ano
 */
export function getCacheByYear(year: number, station: string = DEFAULT_STATION): CacheEntry[] {
  return readCache().filter(e => e.year === year && stationOf(e) === station)
}

/**
 * Remove cache de um mês específico
 */
export function clearMonth(year: number, month: number, station: string = DEFAULT_STATION): void {
  if (typeof window === 'undefined') return
  try {
    const entries = readCache()
    const filtered = entries.filter(e => !(e.year === year && e.month === month && stationOf(e) === station))
    localStorage.setItem(CACHE_KEY, JSON.stringify(filtered))
  } catch (e) {
    console.warn('Erro ao limpar cache do mês:', e)
  }
}

/**
 * Remove cache de um ano inteiro
 */
export function clearYear(year: number, station: string = DEFAULT_STATION): void {
  if (typeof window === 'undefined') return
  try {
    const entries = readCache()
    const filtered = entries.filter(e => !(e.year === year && stationOf(e) === station))
    localStorage.setItem(CACHE_KEY, JSON.stringify(filtered))
  } catch (e) {
    console.warn('Erro ao limpar cache do ano:', e)
  }
}

/**
 * Remove TODO o cache
 */
export function clearAllCache(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(CACHE_KEY)
  } catch (e) {
    console.warn('Erro ao limpar cache:', e)
  }
}

/**
 * Retorna estatísticas de cache
 */
export function getCacheStats() {
  const entries = readCache()
  const totalMonths = entries.length
  const years = [...new Set(entries.map(e => e.year))]
  const totalLaunches = entries.reduce((sum, e) => sum + (e.launches?.length ?? 0), 0)
  const oldestCache = entries.length > 0
    ? new Date(Math.min(...entries.map(e => e.timestamp)))
    : null

  return {
    totalMonths,
    years: years.sort((a, b) => b - a),
    totalLaunches,
    oldestCache,
  }
}

/**
 * Retorna tamanho do cache em bytes (estimativa via JSON serializado)
 */
export function getCacheSizeBytes(): number {
  if (typeof window === 'undefined') return 0
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? new Blob([raw]).size : 0
  } catch {
    return 0
  }
}

export interface StationCacheStats {
  station: string
  months: number
  launches: number
  years: { year: number; months: number[]; launches: number }[]
}

/**
 * Retorna estatísticas agrupadas por estação
 */
export function getCacheStatsByStation(): StationCacheStats[] {
  const entries = readCache()
  const byStation = new Map<string, CacheEntry[]>()
  for (const e of entries) {
    const s = stationOf(e)
    if (!byStation.has(s)) byStation.set(s, [])
    byStation.get(s)!.push(e)
  }

  const result: StationCacheStats[] = []
  for (const [station, stEntries] of byStation) {
    const byYear = new Map<number, CacheEntry[]>()
    for (const e of stEntries) {
      if (!byYear.has(e.year)) byYear.set(e.year, [])
      byYear.get(e.year)!.push(e)
    }
    const years = [...byYear.entries()]
      .sort(([a], [b]) => b - a)
      .map(([year, yEntries]) => ({
        year,
        months: yEntries.map(e => e.month).sort((a, b) => a - b),
        launches: yEntries.reduce((s, e) => s + (e.launches?.length ?? 0), 0),
      }))
    result.push({
      station,
      months: stEntries.length,
      launches: stEntries.reduce((s, e) => s + (e.launches?.length ?? 0), 0),
      years,
    })
  }
  return result.sort((a, b) => b.launches - a.launches)
}

/**
 * Remove todo o cache de uma estação
 */
export function clearStation(station: string): void {
  if (typeof window === 'undefined') return
  try {
    const entries = readCache()
    const filtered = entries.filter(e => stationOf(e) !== station)
    localStorage.setItem(CACHE_KEY, JSON.stringify(filtered))
  } catch (e) {
    console.warn('Erro ao limpar cache da estação:', e)
  }
}

/**
 * Valida estrutura de entrada
 */
function validateEntry(entry: any): entry is CacheEntry {
  return (
    typeof entry === 'object' &&
    typeof entry.year === 'number' &&
    typeof entry.month === 'number' &&
    Array.isArray(entry.launches) &&
    typeof entry.timestamp === 'number' &&
    entry.year >= 2020 && entry.year <= 2100 &&
    entry.month >= 1 && entry.month <= 12 &&
    entry.timestamp > 0
  )
}

/**
 * Exporta cache como JSON para download
 */
export function exportCache(): string {
  const entries = readCache()
  return JSON.stringify(
    {
      version: CACHE_VERSION,
      exportedAt: new Date().toISOString(),
      entries,
    },
    null,
    2
  )
}

/**
 * Importa cache de JSON
 */
export function importCache(jsonData: string): { success: boolean; message: string } {
  try {
    const data = JSON.parse(jsonData)
    if (!Array.isArray(data.entries)) {
      return { success: false, message: 'Formato inválido: falta array de entries' }
    }

    const entries = data.entries.filter(validateEntry)
    localStorage.setItem(CACHE_KEY, JSON.stringify(entries))
    return { success: true, message: `${entries.length} meses importados com sucesso` }
  } catch (e: any) {
    return { success: false, message: `Erro ao importar: ${e.message}` }
  }
}
