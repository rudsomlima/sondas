/**
 * Núcleo do enriquecimento do registro de sondas — **só servidor**. Usado por
 * /api/sonde-registry/enrich (pedido do navegador) e pelo /api/poll (preenche
 * o registro aos poucos, a cada ping do cron externo, mesmo sem ninguém com o
 * app aberto).
 */
import { readReceiverStations, readSondeRegistry, readYearStore, updateReceiverStations, updateSondeRegistry } from './blobStore'
import { mergeSondeRecords, needsEnrichment, recordYear, sameRecord, toIsoUtc, type SondeRecord } from './sondeRegistry'
import { launchInstantMs } from './launchData'
import {
  fetchRadiosondyArchivePage, fetchRadiosondyData, fetchSondeHubListeners, fetchSondeHubRecovered, fetchSondeHubTelemetry,
} from './sondeSources'
import { mergeStations, sameStation, stationKey, type ReceiverStation } from './receiverStations'

const CONCURRENCY = 3

/** Consulta as fontes que ainda valem a pena pra uma sonda e mescla. null = nada a fazer. */
export async function enrichRecord(
  serial: string, existing: SondeRecord | undefined, force = false, stationsOut?: ReceiverStation[],
): Promise<SondeRecord | null> {
  const plan = force ? { radiosondy: true, sondehub: true, recovered: true } : needsEnrichment(existing)
  if (!plan.radiosondy && !plan.sondehub && !plan.recovered) return null

  const now = Date.now()
  const parts: SondeRecord[] = []
  const checked: NonNullable<SondeRecord['checked']> = {}

  // Cada fonte isolada: falha de rede não derruba as outras nem marca
  // "consultado" (assim é tentada de novo na próxima vez).
  const tasks: Promise<void>[] = []
  if (plan.radiosondy) {
    tasks.push((async () => {
      try {
        const page = await fetchRadiosondyArchivePage(serial)
        if (page) {
          parts.push(page)
          // O zip (~1 MB, CSV com a estação de cada quadro) só quando a página
          // confirma que há quadros.
          if ((page.frames ?? 0) > 0) {
            try {
              const data = await fetchRadiosondyData(serial, page.type || existing?.type || 'RS41')
              if (data) parts.push(data)
            } catch { return /* a página valeu; o zip tenta de novo depois */ }
          }
        }
        checked.radiosondy = now
      } catch { /* rede */ }
    })())
  }
  if (plan.sondehub) {
    tasks.push((async () => {
      try {
        const tel = await fetchSondeHubTelemetry(serial)
        if (tel) { parts.push(tel.record); stationsOut?.push(...tel.stations) }
        checked.sondehub = now
      } catch { /* rede */ }
    })())
  }
  if (plan.recovered) {
    tasks.push((async () => {
      try {
        const rec = await fetchSondeHubRecovered(serial)
        if (rec) parts.push(rec)
        checked.recovered = now
      } catch { /* rede */ }
    })())
  }
  await Promise.all(tasks)

  let merged: SondeRecord = existing ?? { serial, sources: [], updatedAt: now }
  for (const part of parts) merged = mergeSondeRecords(merged, part)
  return { ...merged, checked: { ...merged.checked, ...checked } }
}

/** Registros conhecidos (ano corrente e anterior) pros serials pedidos. */
export async function findRecords(serials: string[]): Promise<Map<string, SondeRecord>> {
  const known = new Map<string, SondeRecord>()
  const thisYear = new Date().getUTCFullYear()
  for (const year of [thisYear, thisYear - 1]) {
    try {
      const reg = await readSondeRegistry(year)
      for (const s of serials) {
        const r = reg?.records?.[s]
        if (r && !known.has(s)) known.set(s, r)
      }
    } catch { /* R2 fora: segue só com as fontes */ }
  }
  return known
}

/** Grava (mesclando) no R2, agrupado por ano; ignora o que não mudou. */
export async function saveRecords(records: SondeRecord[], known?: Map<string, SondeRecord>): Promise<void> {
  const byYear = new Map<number, SondeRecord[]>()
  for (const rec of records) {
    if (known && sameRecord(known.get(rec.serial), rec)) continue
    const year = recordYear(rec)
    if (year == null) continue
    const list = byYear.get(year)
    if (list) list.push(rec); else byYear.set(year, [rec])
  }
  for (const [year, list] of byYear) {
    await updateSondeRegistry(year, current => {
      const next = { ...current.records }
      let changed = false
      for (const rec of list) {
        const merged = mergeSondeRecords(next[rec.serial], rec)
        if (sameRecord(next[rec.serial], merged)) continue
        next[rec.serial] = merged
        changed = true
      }
      return changed ? { year, updatedAt: Date.now(), records: next } : null
    })
  }
}

/** Enriquece e grava um lote de serials. Devolve os registros resultantes. */
export async function enrichAndSave(
  serials: string[], opts: { station?: string; force?: boolean } = {},
): Promise<SondeRecord[]> {
  const known = await findRecords(serials)
  const results = new Map<string, SondeRecord>()
  const stations: ReceiverStation[] = []
  const queue = [...serials]
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (let serial = queue.shift(); serial; serial = queue.shift()) {
      const enriched = await enrichRecord(serial, known.get(serial), opts.force, stations)
      let rec = enriched ?? known.get(serial)
      if (!rec) continue
      if (opts.station && !rec.stations?.includes(opts.station)) {
        rec = { ...rec, stations: [...(rec.stations ?? []), opts.station] }
      }
      results.set(serial, rec)
    }
  }))
  try { await saveRecords([...results.values()], known) } catch { /* grava na próxima */ }
  try { await saveStations(stations) } catch { /* grava na próxima */ }
  return [...results.values()]
}

/** Mescla estações receptoras no R2 (posição, antena, software, último contato). */
export async function saveStations(stations: ReceiverStation[], listenersCheckedAt?: number): Promise<void> {
  if (stations.length === 0 && listenersCheckedAt == null) return
  await updateReceiverStations(current => {
    const next = { ...current.stations }
    let changed = false
    for (const st of stations) {
      const key = stationKey(st.callsign)
      const merged = mergeStations(next[key], st)
      if (sameStation(next[key], merged)) continue
      next[key] = merged
      changed = true
    }
    if (!changed && listenersCheckedAt == null) return null
    return {
      updatedAt: Date.now(),
      listenersCheckedAt: listenersCheckedAt ?? current.listenersCheckedAt,
      stations: next,
    }
  })
}

const LISTENERS_REFRESH_MS = 6 * 3600_000

/**
 * Atualiza as estações ATIVAS (SondeHub /listeners/telemetry) — no máximo a
 * cada 6 h. Só guarda estações que aparecem como receptoras no registro de
 * sondas (do ano corrente ou anterior): a resposta é o mundo todo, e o app só
 * desenha quem recebeu alguma sonda que ele mostra.
 */
export async function refreshListeners(force = false): Promise<{ saved: number } | null> {
  const file = await readReceiverStations().catch(() => null)
  if (!force && file?.listenersCheckedAt && Date.now() - file.listenersCheckedAt < LISTENERS_REFRESH_MS) return null
  const year = new Date().getUTCFullYear()
  const wanted = new Set<string>()
  for (const y of [year, year - 1]) {
    const reg = await readSondeRegistry(y).catch(() => null)
    for (const r of Object.values(reg?.records ?? {})) {
      for (const rx of r.receivers ?? []) wanted.add(stationKey(rx.callsign))
      if (r.lastReceiver) wanted.add(stationKey(r.lastReceiver))
    }
  }
  const all = await fetchSondeHubListeners('1d')
  const mine = all.filter(st => wanted.has(stationKey(st.callsign)))
  await saveStations(mine, Date.now())
  return { saved: mine.length }
}

/**
 * Passo de manutenção pro cron. Duas etapas:
 *  1. semeia o registro com as posições de lançamento da estação padrão que
 *     ele ainda não tem (uma gravação só; é o que garante que o registro cubra
 *     tudo que o app já conheceu, e dá um ano a cada sonda pra poder guardar
 *     o "já consultado" mesmo quando nenhuma fonte a conhece);
 *  2. enriquece até `limit` sondas que ainda valem consulta, mais recentes
 *     primeiro. Pensado pra caber folgado no maxDuration do /api/poll.
 */
export async function backfillRegistry(limit = 6, defaultStation = '82599'): Promise<{ seeded: number; checked: string[]; listeners?: number }> {
  const year = new Date().getUTCFullYear()
  let reg = await readSondeRegistry(year).catch(() => null)

  const store = await readYearStore(defaultStation, year).catch(() => null)
  const inRegistry = new Set(Object.keys(reg?.records ?? {}))
  const seeds: SondeRecord[] = []
  for (const l of store?.launches ?? []) {
    const pos = l.position
    if (!pos?.sondeNumber || pos.sondeNumber === '?' || inRegistry.has(pos.sondeNumber)) continue
    inRegistry.add(pos.sondeNumber)
    const at = toIsoUtc(launchInstantMs(l))
    seeds.push({
      serial: pos.sondeNumber,
      stations: [defaultStation],
      lastPos: { lat: pos.lat, lon: pos.lon, alt: pos.altitude, at },
      status: pos.status,
      recoveredBy: pos.recoveredBy,
      recoveryNote: pos.recoveryNote,
      sources: ['app'],
      updatedAt: Date.now(),
    })
  }
  if (seeds.length > 0) {
    try { await saveRecords(seeds); reg = await readSondeRegistry(year).catch(() => reg) } catch { /* tenta no próximo ping */ }
  }

  const now = Date.now()
  const lastMs = (r: SondeRecord) => new Date(r.lastFrameUtc ?? r.lastPos?.at ?? r.firstFrameUtc ?? 0).getTime() || 0
  const batch = Object.values(reg?.records ?? {})
    .filter(r => { const p = needsEnrichment(r, now); return p.radiosondy || p.sondehub || p.recovered })
    .sort((a, b) => lastMs(b) - lastMs(a))
    .slice(0, limit)
  if (batch.length > 0) await enrichAndSave(batch.map(r => r.serial))
  let listeners: number | undefined
  try { listeners = (await refreshListeners())?.saved } catch { /* tenta no próximo ping */ }
  return { seeded: seeds.length, checked: batch.map(r => r.serial), listeners }
}
