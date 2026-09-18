/**
 * Integração com a API pública do sondehub.org (https://api.v2.sondehub.org),
 * fonte alternativa ao radiosondy.info: recebe telemetria em tempo real de uma
 * rede mundial de receptores amadores rodando radiosonde_auto_rx (decodificação
 * direta do sinal RF da sonda), em vez de depender de alguém registrar a
 * recuperação física do equipamento. Costuma ter o lançamento de hoje minutos
 * depois de decolar, bem antes do radiosondy.info ou da Wyoming.
 *
 * Sem filtro geográfico nativo na API — pedimos a telemetria global das
 * últimas 12h (CORS aberto, fetch direto do navegador) e filtramos por
 * distância da estação e pela data (GMT-3) no cliente. 12h cobre os dois
 * ciclos sinóticos típicos (00Z/12Z) sem ficar pesado demais (~350KB medido,
 * contra ~5MB para 1 dia inteiro) — uma janela menor (ex.: 1h) perde o voo
 * assim que ele pousa e fica quieto por mais de 1h, mesmo que o pouso tenha
 * sido hoje (e o radiosondy.info ainda não tenha processado a recuperação).
 */
import { TodayFlight, toReportStr, roundToSynopticHour } from './radiosondy'
import { haversineKm } from './geo'
import type { RawSondeFrame } from './receptionAnalysis'
import { gmt3DateStr, gmt3DateWithMonthGuard } from './launchUtils'

export interface SondeHubFrame {
  lat: number
  lon: number
  alt: number
  vel_v: number
  datetime: string
}

// Sonda ainda transmitindo recentemente = ainda em voo, mesmo critério
// conceitual usado pro feed ao vivo do radiosondy.info (presença = em voo).
export const LIVE_STALE_MS = 10 * 60 * 1000

// Só o último frame de cada sonda ativa no feed global — separado da busca
// em si pra quem for consultar VÁRIAS estações (ex. o cron do servidor, ver
// app/lib/liveFlightsCache.ts) poder buscar uma vez só e filtrar por estação
// em memória, em vez de refazer o fetch de ~350KB por estação.
export interface SondeHubLastFrame { lat: number; lon: number; alt: number; vel_v: number; reportDate: Date }

export async function fetchSondeHubLastFrames(): Promise<Map<string, SondeHubLastFrame>> {
  // /sondes returns one latest frame per serial and is substantially smaller
  // than polling the rate-limited, high-resolution /sondes/telemetry feed.
  const res = await fetch('https://api.v2.sondehub.org/sondes?last=43200', { cache: 'no-store' })
  if (!res.ok) throw new Error(`Erro ${res.status} ao consultar sondehub.org`)
  return latestFramesFromResponse(await res.json())
}

// Filtra os últimos frames (já buscados) pra uma estação — distância e data
// (GMT-3) de hoje — generaliza a bounding box fixa que antes só cobria Natal
// (RN_BOUNDS em radiosondy.ts) pra qualquer estação de app/lib/stations.ts.
export function filterSondeHubFlights(
  frames: Map<string, SondeHubLastFrame>, stationLat: number, stationLon: number, todayStr: string, radiusKm = 300
): TodayFlight[] {
  const out: TodayFlight[] = []
  const now = Date.now()
  for (const [serial, last] of frames) {
    if (haversineKm(stationLat, stationLon, last.lat, last.lon) > radiusKm) continue
    if (gmt3DateStr(last.reportDate) !== todayStr) continue
    out.push({
      sondeNumber: serial,
      altitude: last.alt,
      climbing: last.vel_v,
      lat: last.lat,
      lon: last.lon,
      lastReportUtc: toReportStr(last.reportDate),
      isLive: now - last.reportDate.getTime() < LIVE_STALE_MS,
      source: 'sondehub',
    })
  }
  return out
}

// Busca a telemetria das últimas 12h de toda sonda ativa no mundo e devolve
// só as de hoje (GMT-3) que estiverem a até `radiusKm` da estação dada —
// mantido pros chamadores de uma estação só (ex. useLiveFlights.ts). Quem
// for consultar várias estações deve usar fetchSondeHubLastFrames() +
// filterSondeHubFlights() direto, pra não refazer o fetch global por estação.
function latestFramesFromResponse(data: unknown): Map<string, SondeHubLastFrame> {
  const out = new Map<string, SondeHubLastFrame>()
  if (!data || typeof data !== 'object') return out
  for (const [serial, value] of Object.entries(data as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    // /sondes and /sondes/site return a flat last frame. Keep support for a
    // timestamp-keyed object as the API has used both shapes historically.
    const record = value as Record<string, any>
    const candidates = typeof record.lat === 'number'
      ? [record]
      : Object.values(record).filter(v => v && typeof v === 'object') as Record<string, any>[]
    const last = candidates
      .filter(f => typeof f.lat === 'number' && typeof f.lon === 'number' && typeof f.datetime === 'string')
      .sort((a, b) => String(a.datetime).localeCompare(String(b.datetime)))
      .at(-1)
    if (!last) continue
    const reportDate = new Date(last.datetime)
    if (Number.isNaN(reportDate.getTime())) continue
    out.set(serial, { lat: last.lat, lon: last.lon, alt: last.alt ?? 0, vel_v: last.vel_v ?? 0, reportDate })
  }
  return out
}

async function fetchSondeHubSiteFrames(stationId: string, lastSeconds = 3 * 24 * 3600) {
  const res = await fetch(
    `https://api.v2.sondehub.org/sondes/site/${encodeURIComponent(stationId)}?last=${lastSeconds}`,
    { cache: 'no-store' },
  )
  if (!res.ok) throw new Error(`Erro ${res.status} ao consultar estação no sondehub.org`)
  return latestFramesFromResponse(await res.json())
}

async function fetchSondeHubNearbyFrames(lat: number, lon: number, radiusKm: number, lastSeconds: number) {
  const url = `https://api.v2.sondehub.org/sondes?lat=${lat}&lon=${lon}` +
    `&distance=${Math.round(radiusKm * 1000)}&last=${lastSeconds}`
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Erro ${res.status} ao consultar área no sondehub.org`)
  return latestFramesFromResponse(await res.json())
}

// A API recusa janelas de 7 dias ou mais ("Duration too long") — 1h de folga.
export const SONDEHUB_RECENT_SECONDS = 7 * 24 * 3600 - 3600

export interface SondeHubRecentFrame {
  serial: string
  frame: SondeHubLastFrame
  association: 'station' | 'geographic'
}

/**
 * Último frame de cada sonda dos últimos ~7 dias ligada à estação: pelo
 * endpoint do launch site E por proximidade (raio), juntos — não um OU outro.
 * O site do SondeHub costuma vir vazio (confirmado em 2026-09 para Natal/82599,
 * enquanto a busca por raio tinha 16 sondas na mesma semana), e são essas
 * sondas que faltavam nos mapas quando o radiosondy.info não registrou o pouso.
 */
/** As duas buscas de fetchSondeHubRecentFrames separadas, pra quem quiser
 * desenhar cada uma assim que chega: o endpoint do site às vezes leva >10 s
 * pra devolver vazio (cache frio do SondeHub, medido em 2026-09-15), enquanto
 * a busca por raio responde em <1 s com as sondas de verdade. */
export function fetchSondeHubRecentFramesSplit(
  stationId: string, stationLat: number, stationLon: number, radiusKm = 300,
): { nearby: Promise<SondeHubRecentFrame[]>; site: Promise<SondeHubRecentFrame[]> } {
  const toList = (m: Map<string, SondeHubLastFrame>, association: SondeHubRecentFrame['association']) =>
    [...m].map(([serial, frame]) => ({ serial, frame, association }))
  return {
    nearby: fetchSondeHubNearbyFrames(stationLat, stationLon, radiusKm, SONDEHUB_RECENT_SECONDS).then(m => toList(m, 'geographic')),
    site: fetchSondeHubSiteFrames(stationId, SONDEHUB_RECENT_SECONDS).then(m => toList(m, 'station')),
  }
}

export async function fetchSondeHubRecentFrames(
  stationId: string, stationLat: number, stationLon: number, radiusKm = 300
): Promise<SondeHubRecentFrame[]> {
  const [site, nearby] = await Promise.allSettled([
    fetchSondeHubSiteFrames(stationId, SONDEHUB_RECENT_SECONDS),
    fetchSondeHubNearbyFrames(stationLat, stationLon, radiusKm, SONDEHUB_RECENT_SECONDS),
  ])
  if (site.status === 'rejected' && nearby.status === 'rejected') throw nearby.reason
  const out = new Map<string, SondeHubRecentFrame>()
  if (nearby.status === 'fulfilled') {
    for (const [serial, frame] of nearby.value) out.set(serial, { serial, frame, association: 'geographic' })
  }
  if (site.status === 'fulfilled') {
    for (const [serial, frame] of site.value) out.set(serial, { serial, frame, association: 'station' })
  }
  return [...out.values()]
}

/** Uses the launch-site endpoint first, then a geographic fallback. */
export async function fetchSondeHubFlights(
  stationId: string, stationLat: number, stationLon: number, todayStr: string, radiusKm = 300
): Promise<TodayFlight[]> {
  const lastSeconds = 3 * 24 * 3600
  let siteFrames = new Map<string, SondeHubLastFrame>()
  try { siteFrames = await fetchSondeHubSiteFrames(stationId, lastSeconds) } catch {}

  // Site attribution is stronger than proximity and remains valid after a
  // long drift, so do not discard it merely for leaving the search radius.
  const siteFlights = filterSondeHubFlights(siteFrames, stationLat, stationLon, todayStr, Number.POSITIVE_INFINITY)
    .map(f => ({ ...f, source: 'sondehub-site' as const }))
  if (siteFlights.length > 0) return siteFlights

  const nearby = await fetchSondeHubNearbyFrames(stationLat, stationLon, radiusKm, lastSeconds)
  return filterSondeHubFlights(nearby, stationLat, stationLon, todayStr, radiusKm)
}

/**
 * "Meu receptor": telemetria filtrada pelo uploader_callsign de um receptor
 * do próprio usuário (rdzTTGOsonde/auto_rx) que já sobe frames pro SondeHub.
 *
 * Usa `GET /sondes?lat=&lon=&distance=&last=` — devolve o ÚLTIMO frame de
 * cada sonda ativa num raio (payload de poucos KB, com filtro geográfico
 * server-side, ao contrário do /sondes/telemetry global usado acima). Schema
 * verificado em produção (2026-07): objeto `{serial: frame}` plano, e o frame
 * traz `uploader_callsign`/`rssi`/`snr`/`frequency`/`software_name` do
 * ÚLTIMO uploader apenas — quando várias estações recebem a mesma sonda, o
 * callsign "pisca" entre polls. Por isso o consumidor (useReceiverStatus)
 * mantém memória sticky por sessão dos serials já vistos com o callsign do
 * usuário, em vez de confiar num único poll.
 *
 * Upgrade futuro se um dia precisarmos de latência ~1s: assinar só
 * `sondes/{serial}` no feed MQTT-over-WebSocket público
 * (wss://ws-reader.v2.sondehub.org/) DEPOIS que este polling descobrir o
 * serial — nunca o tópico global, que é a telemetria do mundo inteiro.
 */
export interface NearbySonde {
  serial: string
  lat: number
  lon: number
  alt: number
  vel_v: number
  datetime: string // ISO UTC do frame
  frequency?: number // MHz
  type?: string // RS41, DFM, M20...
  uploaderCallsign?: string
  // rssi/snr nem sempre vêm (dependem do software e do tipo de sonda).
  rssi?: number
  snr?: number
  softwareName?: string
  battV?: number // bateria DA SONDA (volts), quando o frame traz
}

interface NearbySondeApiFrame {
  lat?: number
  lon?: number
  alt?: number
  vel_v?: number
  datetime?: string
  frequency?: number
  type?: string
  uploader_callsign?: string
  rssi?: number
  snr?: number
  software_name?: string
  batt?: number
}

/**
 * Quadros CRUS de um voo recente, um registro por (quadro, uploader) — é o
 * único endpoint que diz QUEM recebeu cada quadro, e por isso a base do
 * diagnóstico de recepção (app/lib/receptionAnalysis.ts). `fetchLiveTrajectory`
 * (trajectory.ts) usa a mesma URL, mas descarta o uploader e o RSSI.
 *
 * Só vale pra voos recentes (a janela ao vivo do SondeHub, ~3 dias): passado
 * isso a API responde 404/302 e o arquivo S3 não guarda o uploader por quadro.
 */
export async function fetchSondeHubRawFrames(serial: string): Promise<RawSondeFrame[]> {
  const res = await fetch(`https://api.v2.sondehub.org/sonde/${encodeURIComponent(serial)}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Erro ${res.status} ao consultar os quadros da sonda no sondehub.org`)
  const data: unknown = await res.json()
  const list: any[] = Array.isArray(data) ? data : Object.values(data ?? {})
  const out: RawSondeFrame[] = []
  for (const f of list) {
    if (!f || typeof f !== 'object') continue
    if (typeof f.lat !== 'number' || typeof f.lon !== 'number' || !f.datetime) continue
    out.push({
      serial: typeof f.serial === 'string' ? f.serial : serial,
      datetime: f.datetime,
      lat: f.lat,
      lon: f.lon,
      alt: typeof f.alt === 'number' ? f.alt : 0,
      rssi: typeof f.rssi === 'number' ? f.rssi : undefined,
      snr: typeof f.snr === 'number' ? f.snr : undefined,
      frequency: typeof f.frequency === 'number' ? f.frequency : undefined,
      uploaderCallsign: typeof f.uploader_callsign === 'string' ? f.uploader_callsign : '?',
      uploaderAntenna: typeof f.uploader_antenna === 'string' ? f.uploader_antenna : undefined,
      softwareName: typeof f.software_name === 'string' ? f.software_name : undefined,
      softwareVersion: typeof f.software_version === 'string' ? f.software_version : undefined,
    })
  }
  return out
}

export async function fetchNearbySondes(
  lat: number, lon: number, radiusKm: number, lastSeconds = 3 * 3600
): Promise<NearbySonde[]> {
  const url = `https://api.v2.sondehub.org/sondes?lat=${lat}&lon=${lon}` +
    `&distance=${Math.round(radiusKm * 1000)}&last=${lastSeconds}`
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Erro ${res.status} ao consultar sondehub.org`)
  const data: Record<string, NearbySondeApiFrame | Record<string, NearbySondeApiFrame>> = await res.json()

  const out: NearbySonde[] = []
  for (const [serial, value] of Object.entries(data)) {
    const record = value as Record<string, any>
    const f = (typeof record.lat === 'number' ? record : Object.values(record)
      .filter(v => v && typeof v === 'object')
      .sort((a: any, b: any) => String(a.datetime ?? '').localeCompare(String(b.datetime ?? '')))
      .at(-1)) as NearbySondeApiFrame | undefined
    if (!f || typeof f.lat !== 'number' || typeof f.lon !== 'number' || !f.datetime) continue
    out.push({
      serial,
      lat: f.lat,
      lon: f.lon,
      alt: f.alt ?? 0,
      vel_v: f.vel_v ?? 0,
      datetime: f.datetime,
      frequency: typeof f.frequency === 'number' ? f.frequency : undefined,
      type: f.type,
      uploaderCallsign: f.uploader_callsign,
      rssi: typeof f.rssi === 'number' ? f.rssi : undefined,
      snr: typeof f.snr === 'number' ? f.snr : undefined,
      softwareName: f.software_name,
      battV: typeof f.batt === 'number' ? f.batt : undefined,
    })
  }
  return out
}

// Compara callsigns tolerando espaços e caixa — o firmware grava livre.
export function sameCallsign(a: string | undefined, b: string): boolean {
  return (a ?? '').trim().toUpperCase() === b.trim().toUpperCase()
}

// Sondas cujo último frame veio do callsign dado. Helper puro; ver nota acima
// sobre o "pisca" quando há mais de um uploader — o chamador deve combinar
// isto com memória sticky, não usar o resultado de um poll isolado.
export function filterByUploader(sondes: NearbySonde[], callsign: string): NearbySonde[] {
  if (!callsign.trim()) return []
  return sondes.filter(s => sameCallsign(s.uploaderCallsign, callsign))
}

export interface ReceiverStatus {
  online: boolean
  lastHeardUtc: string | null // datetime do frame mais recente do callsign
}

// "Online" = algum frame do callsign nos últimos 30 min. Importante: o
// receptor só sobe frames quando há sonda decodificável no ar — "offline"
// aqui costuma significar apenas "sem sonda agora", não receptor desligado.
const RECEIVER_ONLINE_MS = 30 * 60 * 1000

export function deriveReceiverStatus(mySondes: NearbySonde[], now = Date.now()): ReceiverStatus {
  let lastMs = -Infinity
  let lastHeardUtc: string | null = null
  for (const s of mySondes) {
    const t = new Date(s.datetime).getTime()
    if (!isNaN(t) && t > lastMs) { lastMs = t; lastHeardUtc = s.datetime }
  }
  return { online: now - lastMs < RECEIVER_ONLINE_MS, lastHeardUtc }
}

export interface LaunchPosition {
  lat: number
  lon: number
  sondeNumber: string
  status: string
  altitude?: number
}

export interface SondeHubApproxLaunch {
  date: string
  time_local: string
  time_utc: string
  day: number
  month: number
  year: number
  source: 'sondehub'
  approx: true
  association: 'station' | 'geographic'
  // Posição já em mãos (vem do mesmo frame de telemetria usado pra estimar o
  // horário) — sem custo extra de rede, persistida no servidor pra
  // LaunchMap.tsx não precisar refazer essa busca depois.
  position?: LaunchPosition
}

// Converte um instante UTC (proxy do horário de lançamento) num
// SondeHubApproxLaunch, com o mesmo cuidado de fronteira de mês usado em
// fetchRadiosondyLaunches (app/lib/radiosondy.ts): o ajuste de -3h pode
// empurrar a data pro mês anterior, e nesse caso mantemos a data em UTC.
function toApproxLaunch(utcMs: number, position: LaunchPosition | undefined, association: SondeHubApproxLaunch['association']): SondeHubApproxLaunch {
  const pad = (n: number) => String(n).padStart(2, '0')
  const utcDate = new Date(utcMs)
  const localDate = gmt3DateWithMonthGuard(utcMs)
  return {
    date: `${localDate.getUTCFullYear()}-${pad(localDate.getUTCMonth() + 1)}-${pad(localDate.getUTCDate())}`,
    time_local: `${pad(localDate.getUTCHours())}:${pad(localDate.getUTCMinutes())}`,
    time_utc: `${pad(utcDate.getUTCHours())}:00Z`,
    day: localDate.getUTCDate(),
    month: localDate.getUTCMonth() + 1,
    year: localDate.getUTCFullYear(),
    source: 'sondehub',
    approx: true,
    association,
    position,
  }
}

/**
 * Histórico aproximado a partir do sondehub.org (feed ao vivo, ~3 dias), para
 * preencher o mesmo papel de `fetchRadiosondyLaunches` (app/lib/radiosondy.ts)
 * em estações sem cobertura na Wyoming — mas usando telemetria de RF em vez
 * de recuperação física. Existe porque o radiosondy.info só registra um voo
 * se alguém cadastrar manualmente o achado do equipamento.
 *
 * IMPORTANTE: a API de telemetria do sondehub.org só aceita uma janela
 * relativa a "agora" (`duration`, no máximo 3d antes de ficar pesado demais —
 * não existe busca histórica por intervalo de data arbitrário aqui). Por
 * isso esta função só encontra lançamentos dos últimos 3 dias — para meses
 * passados, ver `fetchSondeHubArchiveLaunches`, que usa o arquivo histórico
 * (bucket S3) em vez desse feed ao vivo. Deve ser chamada só ao sincronizar
 * o mês corrente, como complemento ao radiosondy.info e ao arquivo.
 */
export async function fetchSondeHubApproxLaunches(
  stationLat: number, stationLon: number, year: number, month: number, radiusKm = 300, stationId?: string
): Promise<SondeHubApproxLaunch[]> {
  if (stationId) {
    try {
      const siteFrames = await fetchSondeHubSiteFrames(stationId)
      if (siteFrames.size > 0) {
        const byRounded = new Map<number, { serial: string; frame: SondeHubLastFrame }>()
        for (const [serial, frame] of siteFrames) {
          const rounded = roundToSynopticHour(frame.reportDate).getTime()
          if (!byRounded.has(rounded)) byRounded.set(rounded, { serial, frame })
        }
        return [...byRounded.entries()]
          .map(([utcMs, { serial, frame }]) => toApproxLaunch(utcMs, {
            lat: frame.lat, lon: frame.lon, sondeNumber: serial, status: 'UNKNOWN', altitude: frame.alt,
          }, 'station'))
          .filter(l => l.year === year && l.month === month)
      }
    } catch {
      // Geographic telemetry remains the fallback.
    }
  }
  const nearbyFrames = await fetchSondeHubNearbyFrames(stationLat, stationLon, radiusKm, 3 * 24 * 3600)

  // One mission per synoptic slot. The filtered /sondes endpoint returns the
  // latest frame only; this is enough for slot association and avoids polling
  // the documented rate-limited global high-resolution telemetry endpoint.
  const byRoundedUtc = new Map<number, { serial: string; lat: number; lon: number }>()
  for (const [serial, frame] of nearbyFrames) {
    const rounded = roundToSynopticHour(frame.reportDate).getTime()
    if (!byRoundedUtc.has(rounded)) byRoundedUtc.set(rounded, { serial, lat: frame.lat, lon: frame.lon })
  }

  return [...byRoundedUtc.entries()]
    .map(([utcMs, pos]) => toApproxLaunch(utcMs, { lat: pos.lat, lon: pos.lon, sondeNumber: pos.serial, status: 'UNKNOWN' }, 'geographic'))
    .filter(l => l.year === year && l.month === month)
}

const HISTORY_BUCKET = 'https://sondehub-history.s3.amazonaws.com'

interface S3ListResult {
  keys: string[]
  nextToken: string | null
}

// Parsing simples por regex (sem dependência de XML parser) — a mesma
// abordagem já usada no resto do projeto pra extrair dados de HTML/GeoJSON.
function parseS3List(xml: string): S3ListResult {
  const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map(m => m[1])
  const tokenMatch = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)
  return { keys, nextToken: tokenMatch ? tokenMatch[1] : null }
}

export interface SondeHubArchivedSonde {
  serial: string
  lat: number
  lon: number
}

// Baixa o arquivo completo de frames de um voo arquivado de um dia — o mesmo
// JSON usado por fetchSondeHubArchiveSondeForDay, mas devolvendo TODOS os
// frames (trajetória inteira: subida → estouro → descida), não só o último.
// Usado por app/lib/trajectory.ts.
export async function fetchSondeHubArchiveFramesForDay(
  stationId: string, year: number, month: number, day: number
): Promise<{ serial: string; frames: SondeHubFrame[] } | null> {
  const prefix = `launchsites/${stationId}/${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}/`
  const res = await fetch(`${HISTORY_BUCKET}/?list-type=2&prefix=${encodeURIComponent(prefix)}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Erro ${res.status} ao consultar arquivo do sondehub.org`)
  const { keys } = parseS3List(await res.text())
  const key = keys[0]
  if (!key) return null
  const serialMatch = key.match(/\/([^/]+)\.json$/)
  if (!serialMatch) return null

  const fileRes = await fetch(`${HISTORY_BUCKET}/${key}`, { cache: 'no-store' })
  if (!fileRes.ok) return null
  const frames: SondeHubFrame[] = await fileRes.json()
  if (!frames.length) return null
  return { serial: serialMatch[1], frames }
}

// Acha a sonda arquivada de um dia específico (só a posição final) — usado
// quando se quer focar o pouso no mapa sem precisar da trajetória inteira.
export async function fetchSondeHubArchiveSondeForDay(
  stationId: string, year: number, month: number, day: number
): Promise<SondeHubArchivedSonde | null> {
  const result = await fetchSondeHubArchiveFramesForDay(stationId, year, month, day)
  if (!result) return null
  const last = result.frames[result.frames.length - 1]
  if (typeof last.lat !== 'number' || typeof last.lon !== 'number') return null
  return { serial: result.serial, lat: last.lat, lon: last.lon }
}

/**
 * Histórico real (não aproximado por proximidade temporal, e sim por
 * lançamento efetivamente registrado) a partir do arquivo permanente do
 * sondehub.org — um bucket S3 público, organizado por
 * `launchsites/{STNM}/{ano}/{mês}/{dia}/{serial}.json`, listável diretamente
 * (`?list-type=2&prefix=...`). Cobre voos rastreados só por RF que nunca
 * tiveram recuperação física registrada no radiosondy.info — caso real
 * confirmado: Fernando de Noronha (82400), voo de 2026-03-12, serial
 * V2931576, ausente do export_search.php do radiosondy.info mas presente
 * neste arquivo.
 *
 * O arquivo tem um atraso de meses em relação ao "agora" (confirmado: o mais
 * recente registro de Natal/82599 neste bucket, em teste real, era de
 * 2026-03, já em junho/2026) — não serve pra lançamentos recentes, daí ainda
 * precisarmos de `fetchSondeHubApproxLaunches` (feed ao vivo) pro mês
 * corrente. Mas pra meses passados, é estritamente melhor que o
 * radiosondy.info: não depende de ninguém recuperar o equipamento.
 */
export async function fetchSondeHubArchiveLaunches(
  stationId: string, year: number, month: number
): Promise<SondeHubApproxLaunch[]> {
  const prefix = `launchsites/${stationId}/${year}/${String(month).padStart(2, '0')}/`
  const keys: string[] = []
  let continuationToken: string | null = null

  do {
    const url = `${HISTORY_BUCKET}/?list-type=2&prefix=${encodeURIComponent(prefix)}` +
      (continuationToken ? `&continuation-token=${encodeURIComponent(continuationToken)}` : '')
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) throw new Error(`Erro ${res.status} ao consultar arquivo do sondehub.org`)
    const { keys: pageKeys, nextToken } = parseS3List(await res.text())
    keys.push(...pageKeys)
    continuationToken = nextToken
  } while (continuationToken)

  // Um lançamento por dia (o path já tem ano/mês/dia — não precisamos do
  // conteúdo do arquivo pra isso). Pra estimar o horário, busca só o primeiro
  // arquivo de cada dia (o conteúdo é o histórico completo de telemetria
  // daquele voo; o primeiro frame é o proxy mais próximo da decolagem).
  const byDay = new Map<string, string>() // day -> key
  for (const key of keys) {
    const m = key.match(/^launchsites\/[^/]+\/(\d{4})\/(\d{2})\/(\d{2})\/[^/]+\.json$/)
    if (!m) continue
    const day = m[3]
    if (!byDay.has(day)) byDay.set(day, key)
  }

  const out: SondeHubApproxLaunch[] = []
  for (const key of byDay.values()) {
    try {
      const res = await fetch(`${HISTORY_BUCKET}/${key}`, { cache: 'no-store' })
      if (!res.ok) continue
      const frames: SondeHubFrame[] = await res.json()
      if (!frames.length) continue
      const launchDate = new Date(frames[0].datetime)
      if (isNaN(launchDate.getTime())) continue
      const serialMatch = key.match(/\/([^/]+)\.json$/)
      // The launch timestamp comes from the first frame, but a map position
      // must use the final valid frame (landing/last reception), not launchsite.
      const last = [...frames].reverse().find(f => typeof f.lat === 'number' && typeof f.lon === 'number')
      const position = serialMatch && last
        ? { lat: last.lat, lon: last.lon, sondeNumber: serialMatch[1], status: 'UNKNOWN', altitude: last.alt }
        : undefined
      out.push(toApproxLaunch(roundToSynopticHour(launchDate).getTime(), position, 'station'))
    } catch {
      // Falha pontual num arquivo: não bloqueia os demais dias do mês.
      continue
    }
  }
  return out
}
