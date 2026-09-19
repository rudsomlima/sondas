/**
 * Coletores das fontes externas pro registro de sondas (sondeRegistry.ts).
 * **Só servidor**: usa node:zlib e busca páginas que exigem User-Agent de
 * navegador (radiosondy.info devolve 403 sem ele) e não têm CORS. Importe
 * apenas de rotas em app/api.
 *
 * Cada coletor devolve um SondeRecord parcial (só o que aquela fonte sabe)
 * ou null quando a fonte não tem a sonda; erros de rede lançam, pra quem
 * chama distinguir "não existe" (marca como consultado) de "falhou" (tenta
 * de novo depois).
 */
import { inflateRawSync } from 'node:zlib'
import { fetchRecoveryDirect, recoveryStatus } from './sondehubRecovery'
import { toIsoUtc, type ReceiverStat, type SondeRecord } from './sondeRegistry'
import { parseUploaderPosition, stationKey, type ReceiverStation } from './receiverStations'
import { analyzeTrajectory, type TrajectoryPoint } from './trajectory'
import type { RegistryFlight } from './sondeRegistry'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
const TIMEOUT_MS = 20_000

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    // radiosondy.info responde 302 pra sonda desconhecida (tratado como "não
    // existe"), por isso o padrão é não seguir; o SondeHub redireciona pro
    // arquivo real e pede redirect: 'follow'.
    return await fetch(url, {
      redirect: 'manual',
      ...init,
      signal: controller.signal,
      headers: { 'User-Agent': UA, ...(init.headers ?? {}) },
      cache: 'no-store',
    })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Estatísticas do voo a partir da trilha inteira. `complete` exige o 1º ponto
 * perto do chão — a janela da fonte pode começar no meio do voo (caso real:
 * W3770721 começava a 11,8 km), e aí duração/deriva não valem como do voo.
 */
function flightFromPoints(points: TrajectoryPoint[], source: RegistryFlight['source']): RegistryFlight | undefined {
  const pts = points
    .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Number.isFinite(p.alt) && Number.isFinite(p.timeMs))
    .sort((a, b) => a.timeMs - b.timeMs)
  if (pts.length < 2) return undefined
  const a = analyzeTrajectory(pts)
  const round1 = (v: number | null) => v == null ? undefined : Math.round(v * 10) / 10
  return {
    burstAltM: Math.round(a.maxAltM),
    durationMin: a.durationMin ?? undefined,
    distanceKm: round1(a.distanceKm),
    bearingDeg: a.bearingDeg == null ? undefined : Math.round(a.bearingDeg),
    ascentRateMs: round1(a.ascentRateMs),
    descentRateMs: round1(a.descentRateMs),
    points: pts.length,
    complete: pts[0].alt < 3000,
    source,
  }
}

/**
 * O voo propriamente dito dentro de uma lista de quadros: separa em blocos
 * onde há mais de 2 h sem quadro e fica com o bloco que tem a maior altitude.
 * Existe porque as fontes guardam quadros soltos de muito depois — casos
 * reais: V5041139 voou em 11/2025 e U0460617 em 2022, mas o SondeHub tem
 * quadros delas em 2026 (sonda achada e religada). Sem isso duração, deriva,
 * último sinal e até o ano do registro saíam absurdos.
 */
const FLIGHT_GAP_MS = 2 * 3600_000
export function mainFlightSegment<T extends { timeMs: number; alt: number }>(items: T[]): T[] {
  const sorted = items.filter(i => Number.isFinite(i.timeMs)).sort((a, b) => a.timeMs - b.timeMs)
  if (sorted.length === 0) return sorted
  const segments: T[][] = [[sorted[0]]]
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].timeMs - sorted[i - 1].timeMs > FLIGHT_GAP_MS) segments.push([])
    segments[segments.length - 1].push(sorted[i])
  }
  const peak = (seg: T[]) => Math.max(...seg.map(x => (Number.isFinite(x.alt) ? x.alt : -Infinity)))
  return segments.reduce((best, seg) => {
    const pb = peak(best), ps = peak(seg)
    return ps > pb || (ps === pb && seg.length > best.length) ? seg : best
  })
}

function base(serial: string, source: SondeRecord['sources'][number]): SondeRecord {
  return { serial, sources: [source], updatedAt: Date.now() }
}

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ')
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

// ---------------------------------------------------------------------------
// radiosondy.info — página do arquivo (sonde_archive.php)

export async function fetchRadiosondyArchivePage(serial: string): Promise<SondeRecord | null> {
  const res = await fetchWithTimeout(`https://radiosondy.info/sonde_archive.php?sondenumber=${encodeURIComponent(serial)}`)
  // 302 = sonda desconhecida (redireciona pra home). Não é erro de rede.
  if (res.status >= 300 && res.status < 400) return null
  if (!res.ok) throw new Error(`radiosondy.info respondeu ${res.status}`)
  const html = await res.text()
  const field = (label: string) => {
    const m = html.match(new RegExp(`${label}:\\s*([^<]+)</h4>`, 'i'))
    return m ? decodeEntities(m[1]).trim() : undefined
  }
  const first = field('First Frame \\[UTC\\]')
  const last = field('Last Frame \\[UTC\\]')
  if (!first && !last) return null

  const receiversMatch = html.match(/id="receivers-list"[^>]*>\s*<p[^>]*>([^<]+)<\/p>/i)
  const receivers: ReceiverStat[] | undefined = receiversMatch
    ? decodeEntities(receiversMatch[1]).split(',').map(s => s.trim()).filter(Boolean).map(callsign => ({ callsign }))
    : undefined

  const rec = base(serial, 'radiosondy-archive')
  rec.firstFrameUtc = toIsoUtc(first)
  rec.lastFrameUtc = toIsoUtc(last)
  rec.frames = Number(field('Received Frames')) || undefined
  rec.receivers = receivers?.length ? receivers : undefined
  rec.launchSite = field('Launch Site')
  rec.type = field('Type')
  const freq = parseFloat(field('Frequency') ?? '')
  rec.frequencyMHz = Number.isFinite(freq) && freq > 0 ? freq : undefined
  const maxAlt = parseFloat(field('Max Altitude') ?? '')
  rec.maxAltM = Number.isFinite(maxAlt) && maxAlt > 0 ? maxAlt : undefined
  const status = field('Status')?.toUpperCase()
  if (status && ['FOUND', 'LOST', 'UNKNOWN'].includes(status)) rec.status = status

  // Tabela "Status Changes": a linha mais recente diz quem achou (Finder) e a
  // descrição. Só usada como relato de recuperação quando o status é FOUND.
  const tbody = html.match(/id="Table6"[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/i)?.[1]
  const rows = tbody ? [...tbody.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)].map(r => [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c => stripTags(c[1]))) : []
  const row = rows[0]
  if (row && row.length >= 8) {
    const [, , , , rowStatus, finder, landing, description, changedBy] = row
    if (rowStatus?.toUpperCase() === 'FOUND') {
      rec.status = 'FOUND'
      rec.recoveredBy = finder || changedBy?.split(' - ')[0] || undefined
      rec.recoveryNote = description || undefined
      const at = changedBy?.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}z?)/)?.[1]
      rec.recoveredAt = toIsoUtc(at)
      const [lat, lon] = (landing ?? '').split(',').map(v => parseFloat(v))
      if (Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0)) {
        rec.recoveryPos = { lat, lon, at: rec.recoveredAt }
      }
    } else if (description && !rec.recoveryNote && rowStatus) {
      rec.recoveryNote = description
    }
  }
  return rec
}

// ---------------------------------------------------------------------------
// radiosondy.info — "Get Data" (zip com CSV: uma linha por quadro, com a
// estação que o recebeu). É daqui que sai o último receptor e a contagem de
// quadros por estação dos voos antigos.

/** Extrai um arquivo de um .zip (deflate/stored) sem dependências. */
export function unzipEntry(buf: Buffer, match: (name: string) => boolean): Buffer | null {
  // End of Central Directory: assinatura 0x06054b50 nos últimos ~64 KB.
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) return null
  const entries = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  for (let n = 0; n < entries && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) return null
    const method = buf.readUInt16LE(p + 10)
    const compSize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOffset = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    p += 46 + nameLen + extraLen + commentLen
    if (!match(name)) continue
    if (buf.readUInt32LE(localOffset) !== 0x04034b50) return null
    const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28)
    const data = buf.subarray(dataStart, dataStart + compSize)
    if (method === 0) return Buffer.from(data)
    if (method === 8) return inflateRawSync(data)
    return null
  }
  return null
}

function splitCsvLine(line: string, sep = ';'): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++ } else quoted = !quoted
    } else if (c === sep && !quoted) { out.push(cur); cur = '' } else cur += c
  }
  out.push(cur)
  return out
}

export function parseRadiosondyCsv(serial: string, csv: string): SondeRecord | null {
  const lines = csv.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return null
  const header = splitCsvLine(lines[0]).map(h => h.trim().toUpperCase())
  const idx = (name: string) => header.indexOf(name)
  const iStation = idx('STATION'), iTime = idx('DATETIME'), iLat = idx('LATITUDE'), iLon = idx('LONGITUDE')
  const iAlt = idx('ALTITUDE'), iDesc = idx('DESCRIPTION')
  if (iStation < 0 || iTime < 0) return null

  // Linhas → quadros com instante, e só o trecho principal do voo.
  const rows = mainFlightSegment(lines.slice(1).map(line => {
    const c = splitCsvLine(line)
    const at = toIsoUtc(c[iTime]?.trim())
    return { c, at, timeMs: at ? new Date(at).getTime() : NaN, alt: parseFloat(c[iAlt]) }
  }).filter(r => r.at))

  const stats = new Map<string, ReceiverStat>()
  let first: { at: string; lat: number; lon: number; alt: number } | null = null
  let last: { at: string; lat: number; lon: number; alt: number; station: string } | null = null
  let maxAlt = 0
  let freq: number | undefined
  let type: string | undefined
  let frames = 0
  const track: TrajectoryPoint[] = []
  for (const { c, at: rowAt } of rows) {
    const station = c[iStation]?.trim()
    const at = rowAt
    if (!station || !at) continue
    frames++
    const lat = parseFloat(c[iLat]), lon = parseFloat(c[iLon]), alt = parseFloat(c[iAlt])
    const t = new Date(at).getTime()
    const s = stats.get(station) ?? { callsign: station, frames: 0 }
    s.frames = (s.frames ?? 0) + 1
    if (!s.firstAt || t < new Date(s.firstAt).getTime()) s.firstAt = at
    if (!s.lastAt || t > new Date(s.lastAt).getTime()) s.lastAt = at
    stats.set(station, s)
    if (Number.isFinite(alt) && alt > maxAlt) maxAlt = alt
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      if (Number.isFinite(alt)) track.push({ lat, lon, alt, velV: 0, timeMs: t })
      if (!first || t < new Date(first.at).getTime()) first = { at, lat, lon, alt }
      if (!last || t > new Date(last.at).getTime()) last = { at, lat, lon, alt, station }
    }
    if (iDesc >= 0 && (!freq || !type)) {
      const d = c[iDesc] ?? ''
      freq ??= parseFloat(d.match(/([\d.]+)\s*MHz/i)?.[1] ?? '') || undefined
      type ??= d.match(/Type=([A-Za-z0-9-]+)/)?.[1]
    }
  }
  if (frames === 0) return null
  const rec = base(serial, 'radiosondy-data')
  rec.receivers = [...stats.values()]
  rec.frames = frames
  rec.maxAltM = maxAlt || undefined
  rec.frequencyMHz = freq
  rec.type = type
  rec.flight = flightFromPoints(track, 'radiosondy-data')
  if (first) {
    rec.firstFrameUtc = first.at
    rec.launchPos = { lat: first.lat, lon: first.lon, alt: first.alt, at: first.at }
  }
  if (last) {
    rec.lastFrameUtc = last.at
    rec.lastPos = { lat: last.lat, lon: last.lon, alt: last.alt, at: last.at }
    rec.lastReceiver = last.station
    rec.lastReceiverAt = last.at
  }
  return rec
}

export async function fetchRadiosondyData(serial: string, type = 'RS41'): Promise<SondeRecord | null> {
  const res = await fetchWithTimeout('https://radiosondy.info/zip_download.php', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: `https://radiosondy.info/sonde_archive.php?sondenumber=${encodeURIComponent(serial)}`,
    },
    body: `sondenumber=${encodeURIComponent(serial)}&type=${encodeURIComponent(type)}`,
  })
  if (res.status >= 300 && res.status < 400) return null
  if (!res.ok) throw new Error(`radiosondy.info (dados) respondeu ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) return null // não é zip (sonda sem dados)
  const csv = unzipEntry(buf, name => name.toLowerCase().endsWith('.csv'))
  return csv ? parseRadiosondyCsv(serial, csv.toString('utf8')) : null
}

// ---------------------------------------------------------------------------
// SondeHub — telemetria por uploader (/sonde/{serial}): o voo inteiro, com o
// uploader de cada quadro, guardado por meses. Cada quadro fica atribuído a
// um único uploader (deduplicado), então as contagens são mínimas — mas o
// último quadro diz de quem foi o último sinal.

export async function fetchSondeHubTelemetry(serial: string): Promise<{ record: SondeRecord; stations: ReceiverStation[] } | null> {
  const res = await fetchWithTimeout(`https://api.v2.sondehub.org/sonde/${encodeURIComponent(serial)}`, { redirect: 'follow' })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`sondehub.org respondeu ${res.status}`)
  const data: unknown = await res.json()
  const list: any[] = Array.isArray(data) ? data : Object.values(data ?? {})
  const valid = list.filter(f => f && typeof f.lat === 'number' && typeof f.lon === 'number' && f.datetime)
  const frames = mainFlightSegment(valid.map(f => ({
    ...f, timeMs: new Date(f.datetime).getTime(), alt: typeof f.alt === 'number' ? f.alt : NaN,
  })))
  if (frames.length === 0) return null

  const stats = new Map<string, ReceiverStat>()
  // Posição de cada estação no quadro mais recente dela (frames já em ordem).
  const stations = new Map<string, ReceiverStation>()
  let maxAlt = 0
  for (const f of frames) {
    const call = typeof f.uploader_callsign === 'string' ? f.uploader_callsign.trim() : ''
    if (typeof f.alt === 'number' && f.alt > maxAlt) maxAlt = f.alt
    if (!call) continue
    const at = toIsoUtc(f.datetime)
    const where = parseUploaderPosition(f.uploader_position)
    if (where) {
      stations.set(stationKey(call), {
        callsign: call, lat: where.lat, lon: where.lon,
        alt: typeof f.uploader_alt === 'number' ? f.uploader_alt : where.alt,
        antenna: typeof f.uploader_antenna === 'string' && f.uploader_antenna.trim() ? f.uploader_antenna.trim() : undefined,
        software: [f.software_name, f.software_version].filter((v: unknown) => typeof v === 'string' && v).join(' ') || undefined,
        lastSeenAt: toIsoUtc(f.time_received ?? f.datetime),
        sources: ['sondehub-frame'], updatedAt: Date.now(),
      })
    }
    const s: ReceiverStat = stats.get(call) ?? { callsign: call, frames: 0, firstAt: at }
    s.frames = (s.frames ?? 0) + 1
    s.lastAt = at
    stats.set(call, s)
  }
  const first = frames[0]
  const last = frames[frames.length - 1]
  const rec = base(serial, 'sondehub-telemetry')
  rec.receivers = [...stats.values()]
  rec.frames = frames.length
  rec.maxAltM = maxAlt || undefined
  rec.type = typeof last.type === 'string' ? last.type : undefined
  rec.frequencyMHz = typeof last.frequency === 'number' ? last.frequency : undefined
  // A janela ao vivo pode começar no meio do voo (caso real W3770721: 1º quadro
  // a 11,8 km): só vale como "lançamento" se a sonda ainda estava baixa.
  if (typeof first.alt !== 'number' || first.alt < 3000) {
    rec.firstFrameUtc = toIsoUtc(first.datetime)
    rec.launchPos = { lat: first.lat, lon: first.lon, alt: first.alt, at: rec.firstFrameUtc }
  }
  rec.lastFrameUtc = toIsoUtc(last.datetime)
  rec.lastPos = { lat: last.lat, lon: last.lon, alt: last.alt, at: rec.lastFrameUtc }
  if (typeof last.uploader_callsign === 'string' && last.uploader_callsign.trim()) {
    rec.lastReceiver = last.uploader_callsign.trim()
    rec.lastReceiverAt = rec.lastFrameUtc
  }
  rec.stationsCaptured = true
  rec.flight = flightFromPoints(frames.map(f => ({
    lat: f.lat, lon: f.lon, alt: typeof f.alt === 'number' ? f.alt : NaN, velV: 0, timeMs: new Date(f.datetime).getTime(),
  })), 'sondehub-telemetry')
  return { record: rec, stations: [...stations.values()] }
}

// ---------------------------------------------------------------------------
// SondeHub — estações ativas (/listeners/telemetry): posição, antena,
// software e último contato de cada uma. Resposta do mundo todo (~400 KB).

export async function fetchSondeHubListeners(duration = '1d'): Promise<ReceiverStation[]> {
  const res = await fetchWithTimeout(`https://api.v2.sondehub.org/listeners/telemetry?duration=${encodeURIComponent(duration)}`, { redirect: 'follow' })
  if (!res.ok) throw new Error(`sondehub.org (listeners) respondeu ${res.status}`)
  const data = await res.json() as Record<string, unknown>
  const out: ReceiverStation[] = []
  for (const [callsign, value] of Object.entries(data ?? {})) {
    const list: any[] = Array.isArray(value) ? value : Object.values(value ?? {})
    // Última entrada com posição válida.
    let best: any = null
    for (const e of list) {
      if (!e || !parseUploaderPosition(e.uploader_position)) continue
      if (!best || String(e.ts ?? '') >= String(best.ts ?? '')) best = e
    }
    if (!best) continue
    const where = parseUploaderPosition(best.uploader_position)!
    out.push({
      callsign,
      lat: where.lat, lon: where.lon,
      alt: typeof best.uploader_alt === 'number' ? best.uploader_alt : where.alt,
      antenna: typeof best.uploader_antenna === 'string' && best.uploader_antenna.trim() ? best.uploader_antenna.trim() : undefined,
      software: [best.software_name, best.software_version].filter((v: unknown) => typeof v === 'string' && v).join(' ') || undefined,
      lastSeenAt: toIsoUtc(best.ts),
      sources: ['sondehub-listener'],
      updatedAt: Date.now(),
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// SondeHub — relato de recuperação física (/recovered).

export async function fetchSondeHubRecovered(serial: string): Promise<SondeRecord | null> {
  const r = await fetchRecoveryDirect(serial)
  if (!r) return null
  const status = recoveryStatus(r)
  if (!status) return null // só planejada: nada a registrar ainda
  const rec = base(serial, 'sondehub-recovered')
  rec.status = status
  rec.recoveredBy = r.recoveredBy
  rec.recoveryNote = r.description
  rec.recoveredAt = toIsoUtc(r.datetime)
  if (r.recovered && typeof r.lat === 'number' && typeof r.lon === 'number' && !(r.lat === 0 && r.lon === 0)) {
    rec.recoveryPos = { lat: r.lat, lon: r.lon, at: rec.recoveredAt }
  }
  return rec
}
