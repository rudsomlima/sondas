/**
 * Integração com o radiosondy.info: descobre a posição da radiossonda
 * registrada com o horário mais próximo IMEDIATAMENTE DEPOIS de um lançamento.
 * O endpoint export_search.php devolve GeoJSON com CORS aberto, então a busca
 * é feita direto do navegador (sem precisar de proxy no nosso servidor).
 */

export interface RadiosondyFeature {
  date: Date
  lat: number
  lon: number
  sondeNumber: string
  status: string
  popupContent: string
}

// Bounding box aproximada do Rio Grande do Norte — só usada como fallback
// para o startplace de Natal, cobrindo sondas que sobrevoem o estado mesmo
// fora da posição exata de Barreira do Inferno.
const NATAL_STARTPLACE = 'Barreira do Inferno Launch Center (BR)'
const RN_BOUNDS = { minLat: -7, maxLat: -4, minLon: -38, maxLon: -34 }

export interface LiveSondePosition {
  sondeNumber: string
  startplace: string
  type: string
  frequency: string
  lat: number
  lon: number
  altitude: number
  climbing: number
  speed: string
  course: string
  lastReportUtc: string
  popupContent: string
}

// Feed ao vivo (global) usado pela própria home do radiosondy.info na seção
// "Now Flying!": cada sonda em voo aparece como um par de features (LineString
// com o rastro + Point com a posição atual). Quando a sonda pousa, ela some
// deste feed — por isso presença aqui já significa "em voo agora".
export async function fetchLiveFlights(): Promise<LiveSondePosition[]> {
  const url = 'https://radiosondy.info/export/export_map.php?live_map=1'
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Erro ${res.status} ao consultar radiosondy.info`)
  const geojson = await res.json()

  const out: LiveSondePosition[] = []
  for (const f of geojson?.features ?? []) {
    if (f?.geometry?.type !== 'Point') continue
    const p = f.properties ?? {}
    if (typeof p.latitude !== 'number' || typeof p.longitude !== 'number') continue
    out.push({
      sondeNumber: p.id ?? '?',
      startplace: p.startplace ?? '',
      type: p.type ?? '',
      frequency: p.frequency ?? '',
      lat: p.latitude,
      lon: p.longitude,
      altitude: parseFloat(p.altitude) || 0,
      climbing: parseFloat(p.climbing) || 0,
      speed: p.speed ?? '',
      course: p.course ?? '',
      lastReportUtc: p.report ?? '',
      popupContent: p.popupContent ?? '',
    })
  }
  return out
}

export function matchesStartplace(pos: LiveSondePosition, startplace: string): boolean {
  if (pos.startplace === startplace) return true
  if (startplace === NATAL_STARTPLACE) {
    return (
      pos.lat >= RN_BOUNDS.minLat && pos.lat <= RN_BOUNDS.maxLat &&
      pos.lon >= RN_BOUNDS.minLon && pos.lon <= RN_BOUNDS.maxLon
    )
  }
  return false
}

// Link para o mapa de rastreamento externo do SondeHub, centrado na última
// posição conhecida da própria sonde (em voo ou já pousada) — antes este
// centro era fixo em Natal/RN, errado para qualquer outra estação/sonde.
export function sondeHubUrl(sondeNumber: string, lat: number, lon: number, mz = 10): string {
  return `https://sondehub.org/?sondehub=1#!mt=Mapnik&mz=${mz}&qm=12h&mc=${lat},${lon}&f=${sondeNumber}&q=${sondeNumber}`
}

const GMT3 = -3 * 60 * 60 * 1000

function gmt3DateStr(date: Date): string {
  const local = new Date(date.getTime() + GMT3)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`
}

export interface TodayFlight {
  sondeNumber: string
  altitude: number
  climbing: number
  lat: number
  lon: number
  lastReportUtc: string // "YYYY-MM-DD HH:mm:ssz", igual ao formato do feed ao vivo
  isLive: boolean // true = ainda em voo agora; false = já pousou
}

export function toReportStr(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}z`
}

// Extrai do popupContent textual (HTML) de uma feature do export_search.php
// os mesmos campos de telemetria que o feed ao vivo expõe em "properties".
export function parsePopupTelemetry(html: string): { altitude: number; climbing: number; course: string } {
  const altMatch = html.match(/Altitude:\s*(-?[\d.]+)\s*m/)
  const climbMatch = html.match(/Climbing:\s*(-?[\d.]+)\s*m\/s/)
  const courseMatch = html.match(/Course:\s*([\d.]+)/)
  return {
    altitude: altMatch ? parseFloat(altMatch[1]) : 0,
    climbing: climbMatch ? parseFloat(climbMatch[1]) : 0,
    course: courseMatch ? courseMatch[1] : '',
  }
}

// Junta o que o radiosondy.info sabe sobre a(s) sonda(s) da estação dada
// hoje: em voo agora (fetchLiveFlights) e/ou já pousadas (export_search.php
// do mês atual, filtrando pela data de recuperação). Serve de alternativa ao
// contador/status da Wyoming, que atrasa para publicar o lançamento do dia.
export async function fetchTodayFlights(todayStr: string, startplace: string): Promise<TodayFlight[]> {
  const now = new Date()
  const bySondeNumber = new Map<string, TodayFlight>()

  const live = await fetchLiveFlights()
  for (const f of live) {
    if (!matchesStartplace(f, startplace)) continue
    if (gmt3DateStr(new Date(f.lastReportUtc.replace(' ', 'T').replace(/z$/i, '') + 'Z')) !== todayStr) continue
    bySondeNumber.set(f.sondeNumber, {
      sondeNumber: f.sondeNumber,
      altitude: f.altitude,
      climbing: f.climbing,
      lat: f.lat,
      lon: f.lon,
      lastReportUtc: f.lastReportUtc,
      isLive: true,
    })
  }

  const recovered = await fetchRadiosondyFeatures(now.getUTCFullYear(), now.getUTCMonth() + 1, startplace)
  for (const f of recovered) {
    if (gmt3DateStr(f.date) !== todayStr) continue
    if (bySondeNumber.has(f.sondeNumber)) continue // já temos o dado ao vivo, mais completo
    const { altitude, climbing } = parsePopupTelemetry(f.popupContent)
    bySondeNumber.set(f.sondeNumber, {
      sondeNumber: f.sondeNumber,
      altitude,
      climbing,
      lat: f.lat,
      lon: f.lon,
      lastReportUtc: toReportStr(f.date),
      isLive: false,
    })
  }

  return [...bySondeNumber.values()]
}

export function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

export function externalRadiosondyUrl(year: number, month: number, startplace: string): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const params = new URLSearchParams({
    kml: '1',
    search_limit: '1000',
    startplace,
    date_from: `${year}-${pad(month)}-01`,
    date_to: `${year}-${pad(month)}-${pad(lastDayOfMonth(year, month))}`,
  })
  return `https://radiosondy.info/maps/web_map.php?${params.toString()}`
}

// Reconstrói o instante exato do lançamento em UTC a partir dos campos do Launch
// (que guardam a data já corrigida para GMT-3, e o ajuste de virada de mês/dia).
export function launchUtcInstant(year: number, month: number, day: number, timeUtc: string, timeLocal: string): Date {
  const hourUtc = parseInt(timeUtc.slice(0, 2), 10)
  if (hourUtc === 0 && timeLocal !== '00:00') {
    // Caso normal: o -3h empurrou para o dia local anterior, então a data UTC real é +1 dia
    return new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0))
  }
  return new Date(Date.UTC(year, month - 1, day, hourUtc, 0, 0))
}

// Estações sem cobertura na Wyoming (Station.wyomingSupported === false) não
// têm horário de lançamento publicado em lugar nenhum — só o timestamp do
// ponto de posição/recuperação que o radiosondy.info registrou. Lançamentos
// de radiossonda seguem o ciclo sinótico padrão (00/06/12/18Z), então
// arredondar para baixo nessas horas aproxima razoavelmente o horário real.
export function roundToSynopticHour(date: Date): Date {
  const hour = Math.floor(date.getUTCHours() / 6) * 6
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour, 0, 0))
}

export interface ApproxLaunch {
  date: string
  time_local: string
  time_utc: string
  day: number
  month: number
  year: number
  source: 'radiosondy'
  approx: true
  // Posição já conhecida (a mesma feature usada para aproximar o horário),
  // embutida pra LaunchMap não precisar refazer o fetch+match por horário
  // exato (que não faz sentido aqui, já que o horário em si é aproximado).
  feature: RadiosondyFeature
}

// Histórico aproximado a partir do radiosondy.info, usado só para estações
// sem cobertura na Wyoming (ver Station.wyomingSupported em app/lib/stations.ts).
export async function fetchRadiosondyLaunches(year: number, month: number, startplace: string): Promise<ApproxLaunch[]> {
  const features = await fetchRadiosondyFeatures(year, month, startplace)
  const GMT3_MS = -3 * 60 * 60 * 1000
  const pad = (n: number) => String(n).padStart(2, '0')

  const byRoundedUtc = new Map<number, RadiosondyFeature>()
  for (const f of features) {
    const rounded = roundToSynopticHour(f.date).getTime()
    if (!byRoundedUtc.has(rounded)) byRoundedUtc.set(rounded, f)
  }

  const out: ApproxLaunch[] = []
  for (const [utcMs, feature] of byRoundedUtc) {
    const utcDate = new Date(utcMs)
    if (utcDate.getUTCFullYear() !== year || utcDate.getUTCMonth() + 1 !== month) continue

    // Mesmo cuidado de fronteira de mês usado em app/api/sounding/route.ts
    // (parseLaunches): o ajuste de -3h pode empurrar a data pro mês anterior.
    // Quando isso acontece, mantém a data original em UTC em vez da local.
    let localDate = new Date(utcMs + GMT3_MS)
    if (localDate.getUTCFullYear() !== year || localDate.getUTCMonth() + 1 !== month) {
      localDate = utcDate
    }
    out.push({
      date: `${localDate.getUTCFullYear()}-${pad(localDate.getUTCMonth() + 1)}-${pad(localDate.getUTCDate())}`,
      time_local: `${pad(localDate.getUTCHours())}:${pad(localDate.getUTCMinutes())}`,
      time_utc: `${pad(utcDate.getUTCHours())}:00Z`,
      day: localDate.getUTCDate(),
      month: localDate.getUTCMonth() + 1,
      year: localDate.getUTCFullYear(),
      source: 'radiosondy',
      approx: true,
      feature,
    })
  }
  return out
}

export async function fetchRadiosondyFeatures(year: number, month: number, startplace: string): Promise<RadiosondyFeature[]> {
  const pad = (n: number) => String(n).padStart(2, '0')
  const url = `https://radiosondy.info/export/export_search.php?kml=1&search_limit=1000&startplace=${encodeURIComponent(startplace)}&date_from=${year}-${pad(month)}-01&date_to=${year}-${pad(month)}-${pad(lastDayOfMonth(year, month))}`

  const res = await fetch(url)
  if (!res.ok) throw new Error(`Erro ${res.status} ao consultar radiosondy.info`)
  // O radiosondy.info devolve corpo vazio (200 OK, 0 bytes) em vez de um
  // GeoJSON com features=[] quando não há nenhum resultado pro filtro —
  // res.json() direto quebra ("Unexpected end of JSON input") nesse caso.
  const text = await res.text()
  const geojson = text.trim() ? JSON.parse(text) : { features: [] }

  const out: RadiosondyFeature[] = []
  for (const f of geojson?.features ?? []) {
    const coords = f?.geometry?.coordinates
    const html: string = f?.properties?.popupContent || ''
    if (!coords || !html) continue
    const dateMatch = html.match(/Date\/Time:\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})z/)
    if (!dateMatch) continue
    const sondeMatch = html.match(/sondenumber=(\w+)/)
    out.push({
      date: new Date(`${dateMatch[1]}T${dateMatch[2]}Z`),
      lon: coords[0],
      lat: coords[1],
      sondeNumber: sondeMatch ? sondeMatch[1] : '?',
      status: f.properties.icon || 'UNKNOWN',
      popupContent: html,
    })
  }
  return out
}

// Janela usada em findRecoveredMatch: 4h cobre voos mais longos sem risco de
// "roubar" o pouso do lançamento seguinte (lançamentos 00Z/12Z têm 12h entre
// si; o espaço entre o primeiro pouso ~2h30 e o segundo lançamento 12h depois
// é ~9h30 — 4h fica bem dentro disso). Ampliado de 3h para 4h depois de
// observar que alguns voos duram 3h10-3h30 e ficavam fora da janela anterior.
const MAX_MATCH_WINDOW_MS = 4 * 60 * 60 * 1000

// Janela separada para o "live check": tempo máximo desde o lançamento dentro
// do qual a sonda pode ainda estar transmitindo (feed ao vivo). Mantida em 3h
// porque após 3h o voo típico já terminou — o feed ao vivo não seria útil.
const LIVE_FLIGHT_WINDOW_MS = 3 * 60 * 60 * 1000

export type RecoveryMatch =
  | { kind: 'recovered'; feature: RadiosondyFeature; approx: boolean }
  | { kind: 'live'; position: LiveSondePosition }

// Indica se um lançamento é recente o suficiente para que ainda valha a pena
// checar o feed ao vivo (sonda pode ainda estar em voo). Fora dessa janela,
// não há razão pra gastar o fetch pesado do feed ao vivo (~1MB).
export function isWithinMatchWindow(launch: Date): boolean {
  return Math.abs(Date.now() - launch.getTime()) <= LIVE_FLIGHT_WINDOW_MS
}

// Passos 1 e 2 do matching, só com as posições de recuperação já buscadas
// (sem rede): resolve a esmagadora maioria dos casos (lançamentos antigos,
// já com pouso publicado) sem precisar do feed ao vivo.
// Ambos os passos respeitam a mesma MAX_MATCH_WINDOW_MS — não só o passo 2
// (fallback), mas também o 1 ("depois do lançamento"), pra evitar pular pra
// recuperação de um lançamento seguinte se o lançamento certo nunca for
// recuperado (mesmo tipo de contaminação, só na direção contrária).
// 1. Posição de recuperação (FOUND/LOST) com horário depois do lançamento,
//    a mais próxima dentro da janela — caso normal, sempre do voo certo.
// 2. Sem isso, a recuperação mais próxima antes do lançamento, também dentro
//    da mesma janela — tolera pequena imprecisão de relógio/arredondamento
//    entre o instante calculado do lançamento e o timestamp real de pouso.
export function findRecoveredMatch(
  features: RadiosondyFeature[], launch: Date
): { feature: RadiosondyFeature; approx: boolean } | null {
  let best: RadiosondyFeature | null = null
  let bestDiff = Infinity
  for (const f of features) {
    const diff = f.date.getTime() - launch.getTime()
    if (diff >= 0 && diff <= MAX_MATCH_WINDOW_MS && diff < bestDiff) {
      bestDiff = diff
      best = f
    }
  }
  if (best) return { feature: best, approx: false }

  let bestAbs: RadiosondyFeature | null = null
  let bestAbsDiff = Infinity
  for (const f of features) {
    const diff = Math.abs(f.date.getTime() - launch.getTime())
    if (diff <= MAX_MATCH_WINDOW_MS && diff < bestAbsDiff) {
      bestAbsDiff = diff
      bestAbs = f
    }
  }
  if (bestAbs) return { feature: bestAbs, approx: true }
  return null
}

// Passo 3 (só quando o passo síncrono não achou nada e o lançamento é
// recente): sonda pode ainda estar em voo — usa a última posição conhecida
// do feed ao vivo (fetchLiveFlights) para esse startplace.
export function findLiveMatch(liveFlights: LiveSondePosition[], startplace: string): LiveSondePosition | null {
  return liveFlights.find(f => matchesStartplace(f, startplace)) ?? null
}

// Conveniência que faz os 3 passos, buscando o feed ao vivo já pronto (uso
// típico: quem já tem liveFlights em mãos, ex. o job de sync em segundo
// plano, que busca uma vez só por execução em vez de uma vez por chamada).
export function findRecoveryMatch(
  features: RadiosondyFeature[], liveFlights: LiveSondePosition[], startplace: string, launch: Date
): RecoveryMatch | null {
  const recovered = findRecoveredMatch(features, launch)
  if (recovered) return { kind: 'recovered', ...recovered }
  if (isWithinMatchWindow(launch)) {
    const live = findLiveMatch(liveFlights, startplace)
    if (live) return { kind: 'live', position: live }
  }
  return null
}

// Azul/vermelho/amarelo: o verde original se confundia com áreas verdes do mapa
export function statusColor(status: string): string {
  if (status === 'FOUND' || status === 'startIcon') return '#3b82f6'
  if (status === 'LOST' || status === 'endIcon') return '#ef4444'
  return '#eab308'
}

// Mesma cor usada para o marcador de paraquedas (sonda ainda em voo, sem
// pouso registrado) em buildHighlightLiveBalloonIcon.
export const LIVE_COLOR = '#38bdf8'

export const LEGEND_ITEMS: { label: string; color: string }[] = [
  { label: 'Encontrada', color: statusColor('FOUND') },
  { label: 'Perdida', color: statusColor('LOST') },
  { label: 'Desconhecida', color: statusColor('UNKNOWN') },
]

let balloonIconCounter = 0

export interface IconLabel {
  day: number // dia do mês (GMT-3)
  month?: number // mês (GMT-3), só preenchido quando o rótulo precisa diferenciar meses (mapa do ano)
  daytime: boolean // true = lançamento diurno (sol), false = noturno (lua)
}

// Converte um instante UTC no dia do mês (GMT-3) e se cai no período diurno
// (mesmo critério já usado nos badges: 06h–18h local = dia).
export function gmt3IconLabel(date: Date): IconLabel {
  const local = new Date(date.getTime() + GMT3)
  return { day: local.getUTCDate(), daytime: local.getUTCHours() >= 6 && local.getUTCHours() < 18 }
}

// Mesma conversão de gmt3IconLabel, mas incluindo o mês — usado no mapa do
// ano (app/historico/YearMap.tsx), onde ícones de meses diferentes aparecem
// juntos e só o dia não basta para identificar o lançamento.
export function gmt3IconLabelWithMonth(date: Date): IconLabel {
  const local = new Date(date.getTime() + GMT3)
  return {
    day: local.getUTCDate(),
    month: local.getUTCMonth() + 1,
    daytime: local.getUTCHours() >= 6 && local.getUTCHours() < 18,
  }
}

// Ícones minúsculos de sol/lua (mesmo estilo do lucide-react usado nos
// badges) embutidos como SVG cru, já que divIcon do Leaflet não renderiza
// componentes React.
function sunMoonSvgMarkup(daytime: boolean): string {
  return daytime
    ? `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`
    : `<svg width="9" height="9" viewBox="0 0 24 24" fill="#fff"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`
}

// Rótulo abaixo do ícone: sol/lua + dia do mês. A cor de fundo (não só o
// desenho do ícone) já diferencia dia/noite à distância — mesmas cores dos
// badges de horário no calendário (amber = diurno, indigo = noturno), só que
// como preenchimento sólido em vez de texto, pra ficar legível em miniatura.
function iconLabelMarkup(label: IconLabel): string {
  const bg = label.daytime ? '#d97706' : '#4f46e5' // amber-600 / indigo-600
  const pad = (n: number) => String(n).padStart(2, '0')
  const text = label.month ? `${pad(label.day)}/${pad(label.month)}` : String(label.day)
  return `<div style="display:flex;align-items:center;justify-content:center;gap:2px;margin-top:2px;background:${bg};border:1px solid rgba(255,255,255,0.5);border-radius:4px;padding:1px 4px;white-space:nowrap;">${sunMoonSvgMarkup(label.daytime)}<span style="color:#fff;font-size:10px;font-family:monospace;font-weight:700;line-height:1.3;">${text}</span></div>`
}

const LABEL_HEIGHT_PX = 16

// Ícone do payload (cilindro) usado pelo próprio sondehub.org, recolorido na
// cor do status via gradiente (cor -> preto) e na elipse do topo, igual ao
// SVG original deles (só troca a CSS var --dynamic-color por um gradiente
// inline, já que divIcon não herda estilo de :root da página). Usado para
// posições já recuperadas (FOUND/LOST/aproximada).
function balloonSvgMarkup(color: string, widthPx: number, heightPx: number): string {
  const gradId = `payload-grad-${balloonIconCounter++}`
  return `
    <svg width="${widthPx}" height="${heightPx}" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 1px 3px rgba(0,0,0,0.6))">
      <defs>
        <linearGradient id="${gradId}" x1="0%" y1="0%" x2="150%" y2="0%">
          <stop offset="0%" stop-color="${color}"/>
          <stop offset="100%" stop-color="black"/>
        </linearGradient>
      </defs>
      <path d="M 2 9 V 31 A 18 7 0 0 0 38 31 V 9 Z" fill="url(#${gradId})" stroke="black" stroke-width="1"/>
      <path d="M 2.5 23 V 29 A 18 7 0 0 0 37.5 29 V 23 A 18 7 0 0 1 2.5 23 Z" fill="#FFF"/>
      <ellipse cx="20" cy="9" rx="18" ry="7" fill="${color}" stroke="black" stroke-width="1"/>
    </svg>`
}

// Ícone de balão com paraquedas (mesmo modelo do sondehub.org) usado quando a
// sonda AINDA está em voo (sem pouso registrado) — distingue visualmente da
// posição já recuperada (cilindro sozinho, sem paraquedas).
function parachuteSvgMarkup(color: string, widthPx: number, heightPx: number): string {
  const n = balloonIconCounter++
  const gradId = `parachute-grad-${n}`
  const whiteGradId = `parachute-white-${n}`
  const shadowId = `parachute-shadow-${n}`
  const clipId = `parachute-clip-${n}`
  return `
    <svg width="${widthPx}" height="${heightPx}" viewBox="0 0 100 200" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 1px 3px rgba(0,0,0,0.6))">
      <defs>
        <radialGradient id="${whiteGradId}" cx="0.5" cy="0.3" fr="0.3" r="0.6">
          <stop offset="0%" style="stop-color:white"/>
          <stop offset="100%" style="stop-color:black"/>
        </radialGradient>
        <linearGradient id="${gradId}" x1="0%" y1="0%" x2="150%" y2="0%">
          <stop offset="0%" stop-color="${color}"/>
          <stop offset="100%" stop-color="black"/>
        </linearGradient>
        <filter id="${shadowId}" filterUnits="userSpaceOnUse">
          <feDropShadow dx="0" dy="0" stdDeviation="0.4" flood-color="white"/>
        </filter>
        <clipPath id="${clipId}">
          <path d="M 98 40 C 98 8 60 5 50 5 C 40 5 2 8 2 40 C 2 60 40 63 50 63 C 60 63 98 60 98 40 Z"/>
        </clipPath>
      </defs>
      <path d="M 32 154 V 176 A 18 7 0 0 0 68 176 V 154 Z" fill="url(#${gradId})" stroke="black" stroke-width="1"/>
      <path d="M 32.5 168 V 174 A 18 7 0 0 0 67.5 174 V 168 A 18 7 0 0 1 32.5 168 Z" fill="#FFF"/>
      <ellipse cx="50" cy="154" rx="18" ry="7" fill="${color}" stroke="black" stroke-width="1"/>
      <line x1="50" y1="118" x2="50" y2="154" stroke="black" stroke-width="1.5" filter="url(#${shadowId})"/>
      <line x1="50" y1="120" x2="50" y2="63" stroke="black" stroke-width="0.5" filter="url(#${shadowId})"/>
      <line x1="50" y1="120" x2="62" y2="62" stroke="black" stroke-width="0.5" filter="url(#${shadowId})"/>
      <line x1="50" y1="120" x2="38" y2="62" stroke="black" stroke-width="0.5" filter="url(#${shadowId})"/>
      <line x1="50" y1="120" x2="75" y2="60" stroke="black" stroke-width="0.5" filter="url(#${shadowId})"/>
      <line x1="50" y1="120" x2="25" y2="60" stroke="black" stroke-width="0.5" filter="url(#${shadowId})"/>
      <line x1="50" y1="120" x2="90" y2="53" stroke="black" stroke-width="0.5" filter="url(#${shadowId})"/>
      <line x1="50" y1="120" x2="10" y2="53" stroke="black" stroke-width="0.5" filter="url(#${shadowId})"/>
      <rect x="0" y="0" width="100" height="63" fill="${color}" clip-path="url(#${clipId})"/>
      <path d="M 50 65 V 12 Q 35 30 35 64 Z" clip-path="url(#${clipId})" fill="#EEE"/>
      <path d="M 22 64 Q 22 20 50 12 Q 10 20 10 64 Z" clip-path="url(#${clipId})" fill="#EEE"/>
      <path d="M 2 50 Q 8 12 50 12 Q 8 8 0 40 Z" clip-path="url(#${clipId})" fill="#EEE"/>
      <path d="M 0 22 Q 25 7 50 12 Q 30 5 5 15 Z" clip-path="url(#${clipId})" fill="#EEE"/>
      <path d="M 25 5 Q 42 7 50 12 Q 45 2 35 5 Z" clip-path="url(#${clipId})" fill="#EEE"/>
      <path d="M 50 5 V 12 Q 50 9 60 2 Z" clip-path="url(#${clipId})" fill="#EEE"/>
      <path d="M 75 5 Q 58 7 50 12 Q 70 5 95 15 Z" clip-path="url(#${clipId})" fill="#EEE"/>
      <path d="M 100 22 Q 75 7 50 12 Q 92 8 100 40 Z" clip-path="url(#${clipId})" fill="#EEE"/>
      <path d="M 98 50 Q 92 12 50 12 Q 90 20 90 64 Z" clip-path="url(#${clipId})" fill="#EEE"/>
      <path d="M 78 64 Q 78 20 50 12 Q 65 30 65 64 Z" clip-path="url(#${clipId})" fill="#EEE"/>
      <rect x="0" y="0" width="100" height="63" fill="url(#${whiteGradId})" clip-path="url(#${clipId})" opacity="0.3"/>
    </svg>`
}

export function buildBalloonIcon(L: any, color: string, widthPx: number, label?: IconLabel) {
  const heightPx = widthPx
  const svg = balloonSvgMarkup(color, widthPx, heightPx)
  const labelHtml = label ? iconLabelMarkup(label) : ''
  const labelH = label ? LABEL_HEIGHT_PX : 0
  const html = `<div style="display:flex;flex-direction:column;align-items:center;width:${widthPx}px;">${svg}${labelHtml}</div>`
  return L.divIcon({
    html,
    className: '',
    iconSize: [widthPx, heightPx + labelH],
    iconAnchor: [widthPx / 2, heightPx - 1],
  })
}

// Mesmo tamanho dos demais ícones, mas com um brilho pulsante (radar) por trás
// para destacar a posição mais próxima do lançamento sem distorcer o layout
export function buildHighlightBalloonIcon(L: any, color: string, widthPx: number, label?: IconLabel) {
  const heightPx = widthPx
  const svg = balloonSvgMarkup(color, widthPx, heightPx)
  const glowSize = Math.round(widthPx * 3.8)
  const glowTop = Math.round(heightPx * 0.38 - glowSize / 2)
  const glowLeft = Math.round(widthPx / 2 - glowSize / 2)
  const labelHtml = label ? iconLabelMarkup(label) : ''
  const labelH = label ? LABEL_HEIGHT_PX : 0
  const html = `
    <div style="display:flex;flex-direction:column;align-items:center;width:${widthPx}px;">
      <div style="position:relative;width:${widthPx}px;height:${heightPx}px;">
        <div class="radar-pulse-ring" style="position:absolute;left:${glowLeft}px;top:${glowTop}px;width:${glowSize}px;height:${glowSize}px;border-radius:50%;background:${color};"></div>
        ${svg}
      </div>
      ${labelHtml}
    </div>`
  return L.divIcon({
    html,
    className: '',
    iconSize: [widthPx, heightPx + labelH],
    iconAnchor: [widthPx / 2, heightPx - 1],
  })
}

// Sonda ainda em voo (sem pouso registrado): balão com paraquedas, sempre em
// destaque (é o único resultado de um findRecoveryMatch "live"). Proporção
// 1:2 (a mesma do SVG original do sondehub.org), na mesma largura-base dos
// demais ícones do mapa.
export function buildHighlightLiveBalloonIcon(L: any, color: string, widthPx: number, label?: IconLabel) {
  const heightPx = widthPx * 2
  const svg = parachuteSvgMarkup(color, widthPx, heightPx)
  const glowSize = Math.round(widthPx * 3.8)
  const glowTop = Math.round(heightPx * 0.82 - glowSize / 2)
  const glowLeft = Math.round(widthPx / 2 - glowSize / 2)
  const labelHtml = label ? iconLabelMarkup(label) : ''
  const labelH = label ? LABEL_HEIGHT_PX : 0
  const html = `
    <div style="display:flex;flex-direction:column;align-items:center;width:${widthPx}px;">
      <div style="position:relative;width:${widthPx}px;height:${heightPx}px;">
        <div class="radar-pulse-ring" style="position:absolute;left:${glowLeft}px;top:${glowTop}px;width:${glowSize}px;height:${glowSize}px;border-radius:50%;background:${color};"></div>
        ${svg}
      </div>
      ${labelHtml}
    </div>`
  return L.divIcon({
    html,
    className: '',
    iconSize: [widthPx, heightPx + labelH],
    iconAnchor: [widthPx / 2, Math.round(heightPx * 0.88)],
  })
}
