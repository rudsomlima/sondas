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

export interface SondeHubFrame {
  lat: number
  lon: number
  alt: number
  vel_v: number
  datetime: string
}

// Sonda ainda transmitindo recentemente = ainda em voo, mesmo critério
// conceitual usado pro feed ao vivo do radiosondy.info (presença = em voo).
const LIVE_STALE_MS = 10 * 60 * 1000

const GMT3 = -3 * 60 * 60 * 1000
function gmt3DateStr(date: Date): string {
  const local = new Date(date.getTime() + GMT3)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`
}

// Busca a telemetria das últimas 12h de toda sonda ativa no mundo e devolve
// só as de hoje (GMT-3) que estiverem a até `radiusKm` da estação dada —
// generaliza a bounding box fixa que antes só cobria Natal (RN_BOUNDS em
// radiosondy.ts) pra qualquer uma das estações cadastradas em app/lib/stations.ts.
export async function fetchSondeHubFlights(
  stationLat: number, stationLon: number, todayStr: string, radiusKm = 300
): Promise<TodayFlight[]> {
  const res = await fetch('https://api.v2.sondehub.org/sondes/telemetry?duration=12h', { cache: 'no-store' })
  if (!res.ok) throw new Error(`Erro ${res.status} ao consultar sondehub.org`)
  const data: Record<string, Record<string, SondeHubFrame>> = await res.json()

  const out: TodayFlight[] = []
  const now = Date.now()

  for (const [serial, frames] of Object.entries(data)) {
    const timestamps = Object.keys(frames).sort()
    const lastTs = timestamps[timestamps.length - 1]
    const last = frames[lastTs]
    if (!last || typeof last.lat !== 'number' || typeof last.lon !== 'number') continue

    if (haversineKm(stationLat, stationLon, last.lat, last.lon) > radiusKm) continue

    const reportDate = new Date(last.datetime)
    if (isNaN(reportDate.getTime())) continue
    if (gmt3DateStr(reportDate) !== todayStr) continue

    out.push({
      sondeNumber: serial,
      altitude: last.alt ?? 0,
      climbing: last.vel_v ?? 0,
      lat: last.lat,
      lon: last.lon,
      lastReportUtc: toReportStr(reportDate),
      isLive: now - reportDate.getTime() < LIVE_STALE_MS,
    })
  }

  return out
}

export interface LaunchPosition {
  lat: number
  lon: number
  sondeNumber: string
  status: string
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
  // Posição já em mãos (vem do mesmo frame de telemetria usado pra estimar o
  // horário) — sem custo extra de rede, persistida no servidor pra
  // LaunchMap.tsx não precisar refazer essa busca depois.
  position?: LaunchPosition
}

// Converte um instante UTC (proxy do horário de lançamento) num
// SondeHubApproxLaunch, com o mesmo cuidado de fronteira de mês usado em
// fetchRadiosondyLaunches (app/lib/radiosondy.ts): o ajuste de -3h pode
// empurrar a data pro mês anterior, e nesse caso mantemos a data em UTC.
function toApproxLaunch(utcMs: number, position?: LaunchPosition): SondeHubApproxLaunch {
  const pad = (n: number) => String(n).padStart(2, '0')
  const utcDate = new Date(utcMs)
  let localDate = new Date(utcMs + GMT3)
  if (localDate.getUTCFullYear() !== utcDate.getUTCFullYear() || localDate.getUTCMonth() !== utcDate.getUTCMonth()) {
    localDate = utcDate
  }
  return {
    date: `${localDate.getUTCFullYear()}-${pad(localDate.getUTCMonth() + 1)}-${pad(localDate.getUTCDate())}`,
    time_local: `${pad(localDate.getUTCHours())}:${pad(localDate.getUTCMinutes())}`,
    time_utc: `${pad(utcDate.getUTCHours())}:00Z`,
    day: localDate.getUTCDate(),
    month: localDate.getUTCMonth() + 1,
    year: localDate.getUTCFullYear(),
    source: 'sondehub',
    approx: true,
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
  stationLat: number, stationLon: number, year: number, month: number, radiusKm = 300
): Promise<SondeHubApproxLaunch[]> {
  const res = await fetch('https://api.v2.sondehub.org/sondes/telemetry?duration=3d', { cache: 'no-store' })
  if (!res.ok) throw new Error(`Erro ${res.status} ao consultar sondehub.org`)
  const data: Record<string, Record<string, SondeHubFrame>> = await res.json()

  // Um lançamento por hora sinótica (00/06/12/18Z) — mesma suposição de
  // fetchRadiosondyLaunches. Usa o PRIMEIRO frame de cada sonda já dentro do
  // raio como proxy do horário de lançamento (mais próximo do solo/decolagem
  // do que o último frame, usado em fetchSondeHubFlights) — e já guarda essa
  // posição, sem custo extra de rede, pra persistir no servidor.
  const byRoundedUtc = new Map<number, { serial: string; lat: number; lon: number }>()
  for (const [serial, frames] of Object.entries(data)) {
    const timestamps = Object.keys(frames).sort()
    for (const ts of timestamps) {
      const f = frames[ts]
      if (typeof f.lat !== 'number' || typeof f.lon !== 'number') continue
      if (haversineKm(stationLat, stationLon, f.lat, f.lon) > radiusKm) continue
      const launchDate = new Date(f.datetime)
      if (isNaN(launchDate.getTime())) break
      const rounded = roundToSynopticHour(launchDate).getTime()
      if (!byRoundedUtc.has(rounded)) byRoundedUtc.set(rounded, { serial, lat: f.lat, lon: f.lon })
      break
    }
  }

  return [...byRoundedUtc.entries()]
    .map(([utcMs, pos]) => toApproxLaunch(utcMs, { lat: pos.lat, lon: pos.lon, sondeNumber: pos.serial, status: 'UNKNOWN' }))
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
      const first = frames[0]
      const position = serialMatch && typeof first.lat === 'number' && typeof first.lon === 'number'
        ? { lat: first.lat, lon: first.lon, sondeNumber: serialMatch[1], status: 'UNKNOWN' }
        : undefined
      out.push(toApproxLaunch(roundToSynopticHour(launchDate).getTime(), position))
    } catch {
      // Falha pontual num arquivo: não bloqueia os demais dias do mês.
      continue
    }
  }
  return out
}
