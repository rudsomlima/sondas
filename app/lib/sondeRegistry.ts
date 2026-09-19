/**
 * Registro permanente de sondas no R2 — tudo que qualquer fonte já disse
 * sobre uma sonda, guardado pra sempre e mesclado de forma aditiva.
 *
 * Por quê: as fontes externas esquecem. O feed ao vivo do SondeHub só guarda
 * uns poucos dias de quadros por uploader, o radiosondy.info às vezes não tem
 * a sonda, e a busca por área do SondeHub é inconsistente. O que o app viu uma
 * vez fica aqui, e os mapas usam isto pra completar o que a fonte não devolve
 * mais — com o tempo o registro fica mais completo que qualquer fonte sozinha.
 *
 * Armazenamento: `sondas/sondes/{ano}.json` → `{ year, updatedAt, records }`,
 * uma entrada por serial (o serial é único no mundo, não depende de estação).
 * O ano é o do primeiro dado conhecido da sonda (ver `recordYear`).
 *
 * Módulo puro (sem rede, sem R2): tipos, mesclagem e conversões.
 */

export type SondeRecordSource =
  | 'radiosondy-archive'  // página sonde_archive.php (status, receptores, 1º/último quadro)
  | 'radiosondy-data'     // CSV do "Get Data" (estação de cada quadro)
  | 'radiosondy-search'   // export_search.php (último ponto + status)
  | 'sondehub-telemetry'  // /sonde/{serial} (quadros por uploader)
  | 'sondehub-recent'     // /sondes (último quadro de cada sonda)
  | 'sondehub-archive'    // arquivo S3 do SondeHub
  | 'sondehub-recovered'  // /recovered (quem achou a sonda)
  | 'app'                 // visto pelo app sem fonte mais específica

export interface RegistryPosition {
  lat: number
  lon: number
  alt?: number
  at?: string // ISO UTC
}

export interface ReceiverStat {
  callsign: string
  frames?: number
  firstAt?: string // ISO UTC
  lastAt?: string  // ISO UTC
}

// Estatísticas do voo, calculadas no enriquecimento a partir da trilha
// inteira (CSV do radiosondy.info ou telemetria do SondeHub) — alimentam a
// página de Análises. `complete` = a trilha começa perto do chão (senão
// duração/deriva ficam subestimadas: a janela da fonte pode começar no meio).
export interface RegistryFlight {
  burstAltM: number
  durationMin?: number
  distanceKm?: number
  bearingDeg?: number
  ascentRateMs?: number
  descentRateMs?: number
  points: number
  complete: boolean
  source: 'radiosondy-data' | 'sondehub-telemetry'
}

export interface SondeRecord {
  serial: string
  type?: string
  frequencyMHz?: number
  launchSite?: string
  // Estações (id Wyoming) em cujos mapas a sonda já apareceu — é por aqui que
  // o registro vira fonte de pontos de um mapa, sem adivinhar por geografia.
  stations?: string[]
  firstFrameUtc?: string // ISO UTC — "lançamento" exibido pelo app
  lastFrameUtc?: string  // ISO UTC
  launchPos?: RegistryPosition
  lastPos?: RegistryPosition // último ponto conhecido (pouso ou perda de sinal)
  maxAltM?: number
  status?: string // FOUND / LOST / UNKNOWN
  recoveredBy?: string
  recoveryNote?: string
  recoveredAt?: string
  recoveryPos?: RegistryPosition // onde foi achada (relato de recuperação)
  receivers?: ReceiverStat[] // quem participou da recepção
  lastReceiver?: string      // de quem foi o último sinal recebido
  lastReceiverAt?: string
  frames?: number
  // A telemetria do SondeHub já foi lida capturando a posição de cada estação
  // receptora (receiverStations.ts). Registros antigos, de antes disso, são
  // relidos uma vez só pra desenhar as estações nos mapas.
  stationsCaptured?: boolean
  flight?: RegistryFlight
  // Versão do enriquecimento que gerou o registro (ENRICH_VERSION). Quando o
  // app passa a extrair algo novo das fontes, sobe a versão e os registros
  // antigos são relidos UMA vez, sem esperar a regra de 24 h.
  enrichVersion?: number
  sources: SondeRecordSource[]
  // Última tentativa de consulta pesada por fonte (epoch ms) — evita rebaixar
  // 1-2 MB a cada visita. Ver needsEnrichment.
  checked?: Partial<Record<'radiosondy' | 'sondehub' | 'recovered', number>>
  updatedAt: number
}

export interface SondeRegistryYear {
  year: number
  updatedAt: number
  records: Record<string, SondeRecord>
}

// ---------------------------------------------------------------------------

export function toIsoUtc(value: string | number | Date | undefined | null): string | undefined {
  if (value == null || value === '') return undefined
  let d: Date
  if (value instanceof Date) d = value
  else if (typeof value === 'number') d = new Date(value)
  else {
    // "YYYY-MM-DD HH:mm:ss[z]" (radiosondy) e ISO (SondeHub)
    const s = value.trim()
    d = /[zZ]$|[+-]\d\d:?\d\d$/.test(s) && s.includes('T')
      ? new Date(s)
      : new Date(s.replace(' ', 'T').replace(/z$/i, '') + 'Z')
  }
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function ms(iso: string | undefined): number {
  if (!iso) return NaN
  return new Date(iso).getTime()
}

/** Ano ao qual a sonda pertence no registro (primeiro dado conhecido). */
export function recordYear(r: Pick<SondeRecord, 'firstFrameUtc' | 'lastFrameUtc' | 'lastPos'>): number | null {
  const ref = r.firstFrameUtc ?? r.lastFrameUtc ?? r.lastPos?.at
  const t = ms(ref)
  return Number.isFinite(t) ? new Date(t).getUTCFullYear() : null
}

function union<T>(a: T[] | undefined, b: T[] | undefined): T[] | undefined {
  if (!a?.length) return b?.length ? [...b] : undefined
  if (!b?.length) return [...a]
  return [...new Set([...a, ...b])]
}

function earliest(a?: string, b?: string): string | undefined {
  if (!a) return b
  if (!b) return a
  return ms(a) <= ms(b) ? a : b
}

function latest(a?: string, b?: string): string | undefined {
  if (!a) return b
  if (!b) return a
  return ms(a) >= ms(b) ? a : b
}

function mergeReceivers(a?: ReceiverStat[], b?: ReceiverStat[]): ReceiverStat[] | undefined {
  if (!a?.length && !b?.length) return undefined
  const byCall = new Map<string, ReceiverStat>()
  for (const r of [...(a ?? []), ...(b ?? [])]) {
    const key = r.callsign.trim().toUpperCase()
    if (!key) continue
    const prev = byCall.get(key)
    if (!prev) { byCall.set(key, { ...r, callsign: r.callsign.trim() }); continue }
    byCall.set(key, {
      callsign: prev.callsign,
      // Fontes diferentes contam quadros diferentes (radiosondy via APRS,
      // SondeHub deduplicado): fica a maior contagem, nunca a soma.
      frames: Math.max(prev.frames ?? 0, r.frames ?? 0) || undefined,
      firstAt: earliest(prev.firstAt, r.firstAt),
      lastAt: latest(prev.lastAt, r.lastAt),
    })
  }
  return [...byCall.values()].sort((x, y) => (y.frames ?? 0) - (x.frames ?? 0) || x.callsign.localeCompare(y.callsign))
}

const STATUS_RANK: Record<string, number> = { FOUND: 3, LOST: 2, UNKNOWN: 1 }

// Trilha completa vence a truncada; entre iguais, a com mais pontos.
function betterFlight(a?: RegistryFlight, b?: RegistryFlight): RegistryFlight | undefined {
  if (!a) return b
  if (!b) return a
  if (a.complete !== b.complete) return a.complete ? a : b
  return b.points > a.points ? b : a
}

/**
 * Mescla aditiva: nunca apaga um dado conhecido por falta dele na outra cópia.
 * Primeiro quadro = o mais antigo; último quadro/posição/último receptor = o
 * mais recente; status FOUND > LOST > UNKNOWN; receptores = união.
 */
export function mergeSondeRecords(a: SondeRecord | undefined, b: SondeRecord): SondeRecord {
  if (!a) return { ...b, sources: [...(b.sources ?? [])] }
  const lastPosNewer = (b.lastPos && !a.lastPos) ||
    (!!b.lastPos && !!a.lastPos && ms(b.lastPos.at) > ms(a.lastPos.at))
  const receiverFromB = !!b.lastReceiver && (!a.lastReceiver || ms(b.lastReceiverAt) > ms(a.lastReceiverAt))
  const statusA = a.status ?? 'UNKNOWN'
  const statusB = b.status ?? 'UNKNOWN'
  const statusWinner = (STATUS_RANK[statusB] ?? 0) > (STATUS_RANK[statusA] ?? 0) ? b : a
  return {
    serial: a.serial,
    type: a.type ?? b.type,
    frequencyMHz: a.frequencyMHz ?? b.frequencyMHz,
    launchSite: a.launchSite ?? b.launchSite,
    stations: union(a.stations, b.stations),
    firstFrameUtc: earliest(a.firstFrameUtc, b.firstFrameUtc),
    lastFrameUtc: latest(a.lastFrameUtc, b.lastFrameUtc),
    launchPos: (a.launchPos && b.launchPos)
      ? (ms(b.launchPos.at) < ms(a.launchPos.at) ? b.launchPos : a.launchPos)
      : a.launchPos ?? b.launchPos,
    lastPos: lastPosNewer ? b.lastPos : a.lastPos ?? b.lastPos,
    maxAltM: Math.max(a.maxAltM ?? 0, b.maxAltM ?? 0) || undefined,
    status: statusWinner.status ?? a.status ?? b.status,
    // Relato de recuperação acompanha o status vencedor; senão, qualquer um.
    recoveredBy: statusWinner.recoveredBy ?? a.recoveredBy ?? b.recoveredBy,
    recoveryNote: statusWinner.recoveryNote ?? a.recoveryNote ?? b.recoveryNote,
    recoveredAt: statusWinner.recoveredAt ?? a.recoveredAt ?? b.recoveredAt,
    recoveryPos: statusWinner.recoveryPos ?? a.recoveryPos ?? b.recoveryPos,
    receivers: mergeReceivers(a.receivers, b.receivers),
    lastReceiver: receiverFromB ? b.lastReceiver : a.lastReceiver ?? b.lastReceiver,
    lastReceiverAt: receiverFromB ? b.lastReceiverAt : a.lastReceiverAt ?? b.lastReceiverAt,
    frames: Math.max(a.frames ?? 0, b.frames ?? 0) || undefined,
    stationsCaptured: a.stationsCaptured || b.stationsCaptured || undefined,
    flight: betterFlight(a.flight, b.flight),
    enrichVersion: Math.max(a.enrichVersion ?? 0, b.enrichVersion ?? 0) || undefined,
    sources: union(a.sources, b.sources) ?? [],
    checked: { ...a.checked, ...b.checked },
    updatedAt: Math.max(a.updatedAt, b.updatedAt),
  }
}

/** Igualdade de conteúdo (ignora updatedAt) — pra não regravar o R2 à toa. */
export function sameRecord(a: SondeRecord | undefined, b: SondeRecord): boolean {
  if (!a) return false
  const strip = (r: SondeRecord) => JSON.stringify({ ...r, updatedAt: 0 })
  return strip(a) === strip(b)
}

// ---------------------------------------------------------------------------
// Validação de entrada (POST do navegador): só campos conhecidos, tamanhos
// limitados. O app não tem login — isto impede lixo, não um atacante decidido.

const SERIAL_RE = /^[A-Za-z0-9_-]{3,20}$/
const CALLSIGN_RE = /^[A-Za-z0-9/_ .-]{2,40}$/

function str(v: unknown, max: number): string | undefined {
  return typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : undefined
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function pos(v: unknown): RegistryPosition | undefined {
  if (!v || typeof v !== 'object') return undefined
  const p = v as Record<string, unknown>
  const lat = num(p.lat), lon = num(p.lon)
  if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return undefined
  return { lat, lon, alt: num(p.alt), at: toIsoUtc(str(p.at, 40)) }
}

export function sanitizeRecord(input: unknown): SondeRecord | null {
  if (!input || typeof input !== 'object') return null
  const r = input as Record<string, unknown>
  const serial = str(r.serial, 20)
  if (!serial || !SERIAL_RE.test(serial)) return null
  const receivers = Array.isArray(r.receivers)
    ? r.receivers.slice(0, 40).flatMap(x => {
        const o = (typeof x === 'string' ? { callsign: x } : x) as Record<string, unknown>
        const callsign = str(o?.callsign, 40)
        if (!callsign || !CALLSIGN_RE.test(callsign)) return []
        return [{ callsign, frames: num(o.frames), firstAt: toIsoUtc(str(o.firstAt, 40)), lastAt: toIsoUtc(str(o.lastAt, 40)) }]
      })
    : undefined
  const lastReceiver = str(r.lastReceiver, 40)
  const status = str(r.status, 10)?.toUpperCase()
  return {
    serial,
    type: str(r.type, 20),
    frequencyMHz: num(r.frequencyMHz),
    launchSite: str(r.launchSite, 120),
    stations: Array.isArray(r.stations)
      ? r.stations.slice(0, 10).flatMap(s => (typeof s === 'string' && /^[A-Za-z0-9_-]{1,20}$/.test(s) ? [s] : []))
      : undefined,
    firstFrameUtc: toIsoUtc(str(r.firstFrameUtc, 40)),
    lastFrameUtc: toIsoUtc(str(r.lastFrameUtc, 40)),
    launchPos: pos(r.launchPos),
    lastPos: pos(r.lastPos),
    maxAltM: num(r.maxAltM),
    status: status && STATUS_RANK[status] ? status : undefined,
    recoveredBy: str(r.recoveredBy, 60),
    recoveryNote: str(r.recoveryNote, 500),
    recoveredAt: toIsoUtc(str(r.recoveredAt, 40)),
    recoveryPos: pos(r.recoveryPos),
    receivers: receivers?.length ? receivers : undefined,
    lastReceiver: lastReceiver && CALLSIGN_RE.test(lastReceiver) ? lastReceiver : undefined,
    lastReceiverAt: toIsoUtc(str(r.lastReceiverAt, 40)),
    frames: num(r.frames),
    // Navegador só declara o que viu; fontes "pesadas" são marcadas pelo servidor.
    sources: ['app'],
    updatedAt: Date.now(),
  }
}

// ---------------------------------------------------------------------------

const HOUR = 3600_000
const RECENT_FLIGHT_MS = 6 * HOUR
// 2 = dados de voo (estouro/duração/deriva) + só o trecho principal do voo.
export const ENRICH_VERSION = 2

/**
 * O que ainda vale consultar nas fontes pesadas pra este registro. Voo
 * encerrado com receptores conhecidos não muda mais; o relato de recuperação
 * pode chegar dias depois, então é reconsultado por 30 dias.
 */
export function needsEnrichment(r: SondeRecord | undefined, now = Date.now()): { radiosondy: boolean; sondehub: boolean; recovered: boolean } {
  const last = ms(r?.lastFrameUtc ?? r?.lastPos?.at)
  const recent = !Number.isFinite(last) || now - last < RECENT_FLIGHT_MS
  const retry = (checkedAt: number | undefined, freshMs: number) => !checkedAt || now - checkedAt > freshMs
  const hasReceivers = !!r?.receivers?.length && !!r?.lastReceiver
  const hasFirst = !!r?.firstFrameUtc
  // Registros de antes dos dados de voo existirem são relidos uma vez.
  const hasFlight = !!r?.flight
  // Voo antigo que a fonte já disse não conhecer (consultada, sem dados):
  // não vai aparecer lá depois de uma semana — para de perguntar.
  const oldFlight = !recent && Number.isFinite(last) && now - last > 7 * 24 * HOUR
  const radiosondyGaveUp = oldFlight && !!r?.checked?.radiosondy && !r.sources.includes('radiosondy-archive')
  const sondehubGaveUp = oldFlight && !!r?.checked?.sondehub && !r.sources.includes('sondehub-telemetry')
  // Registro de versão antiga: relê as fontes que ele tem, uma vez só.
  const outdated = !!r && (r.enrichVersion ?? 0) < ENRICH_VERSION
  if (outdated && !recent) {
    return {
      radiosondy: !radiosondyGaveUp,
      sondehub: !sondehubGaveUp,
      recovered: r.status !== 'FOUND' && retry(r.checked?.recovered, 6 * HOUR),
    }
  }
  return {
    radiosondy: recent ? retry(r?.checked?.radiosondy, 10 * 60_000)
      : !radiosondyGaveUp && !(hasReceivers && hasFirst && hasFlight && r?.sources.includes('radiosondy-data')) &&
        retry(r?.checked?.radiosondy, 24 * HOUR),
    // O /sonde/{serial} do SondeHub guarda o voo inteiro, com o uploader de
    // cada quadro, por meses (conferido em 2026-09 com voos de janeiro).
    sondehub: recent ? retry(r?.checked?.sondehub, 10 * 60_000)
      : !sondehubGaveUp && !(hasReceivers && hasFlight && r?.sources.includes('sondehub-telemetry') && r?.stationsCaptured) &&
        retry(r?.checked?.sondehub, 24 * HOUR),
    recovered: r?.status !== 'FOUND' && (!Number.isFinite(last) || now - last < 30 * 24 * HOUR) &&
      retry(r?.checked?.recovered, 6 * HOUR),
  }
}
