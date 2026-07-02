import { NextRequest, NextResponse } from 'next/server'
import { readYearStore, writeYearStore, YearStore } from '@/app/lib/blobStore'
import { findStation, Station } from '@/app/lib/stations'
import { fetchRadiosondyLaunches } from '@/app/lib/radiosondy'
import { fetchSondeHubApproxLaunches, fetchSondeHubArchiveLaunches } from '@/app/lib/sondehub'

const GMT3 = -3 * 60 * 60 * 1000
const DEFAULT_STATION_ID = '82599'
const WYOMING_BASE = 'https://weather.uwyo.edu/wsgi/sounding'
const WYOMING_SRC = 'FM35'
const TIMEOUT = 15000 // 15 segundos por requisição

// Cache em memória (persiste durante a sessão do servidor)
const memoryCache = new Map<string, { data: any; timestamp: number }>()
// Cache de inventário anual separado (mais estável que sondagens individuais)
const inventoryCache = new Map<string, { datetimes: string[]; timestamp: number }>()

// Date.now() já é um instante absoluto (UTC); somar getTimezoneOffset() aqui
// fazia o resultado depender do fuso horário configurado na máquina/servidor
// (ex: certo na Vercel, que roda em UTC, mas errado num dev local em GMT-3,
// ou vice-versa). Sem esse termo, o cálculo é determinístico em qualquer ambiente.
function nowGMT3() {
  return new Date(Date.now() + GMT3)
}

const MONTH_MAP: Record<string, number> = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
}

async function fetchWithTimeout(url: string, timeout: number): Promise<string> {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeout)

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SondasNatal/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
    return res.text()
  } finally {
    clearTimeout(id)
  }
}

// Extrai datetimes do HTML de inventário anual da Wyoming.
// Links têm formato: datetime=2026-06-01 12:00:00 (espaço literal no HTML).
function parseInventory(html: string, year: number): string[] {
  const pattern = /datetime=(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2})/g
  const seen = new Set<string>()
  const result: string[] = []
  let m: RegExpExecArray | null
  while ((m = pattern.exec(html)) !== null) {
    const dt = m[1].replace('T', ' ')
    if (dt.startsWith(String(year)) && !seen.has(dt)) {
      seen.add(dt)
      result.push(dt)
    }
  }
  return result.sort()
}

// Converte datetime do inventário ("YYYY-MM-DD HH:MM:SS") para chave de dedup.
// Usa a data UTC original do inventário + hora UTC — assim 2026-07-02 00:00:00
// vira "2026-07-02_00:00Z", diferente de "2026-07-01_00:00Z".
function inventoryDtToKey(dt: string): string {
  const [date, time] = dt.split(' ')
  return `${date}_${time.slice(0, 2)}:00Z`
}

// Reconstrói a chave de inventário a partir de um launch armazenado,
// revertendo a conversão GMT-3 → UTC: se utcHour < localHour, o UTC é no dia
// seguinte (ex: local 21:00 → UTC 00:00 do dia +1).
function launchToInventoryKey(l: { date: string; time_local: string; time_utc: string }): string {
  const utcHour = parseInt(l.time_utc.slice(0, 2))
  const localHour = parseInt(l.time_local.slice(0, 2))
  let date = l.date
  if (utcHour < localHour) {
    const d = new Date(l.date + 'T00:00:00Z')
    d.setUTCDate(d.getUTCDate() + 1)
    date = d.toISOString().slice(0, 10)
  }
  return `${date}_${l.time_utc}`
}

async function fetchInventory(station: string, year: number): Promise<string[]> {
  const cacheKey = `inventory_${station}_${year}`
  const now = nowGMT3()
  const isCurrentYear = year === now.getUTCFullYear()

  const cached = inventoryCache.get(cacheKey)
  if (cached) {
    if (isCurrentYear && Date.now() - cached.timestamp < 3600000) return cached.datetimes
    if (!isCurrentYear) return cached.datetimes
  }

  // O datetime exato não importa para o inventário — a Wyoming retorna o ano todo.
  // Usa data de referência no meio do ano para evitar edge-cases de virada de ano.
  const refDate = isCurrentYear
    ? (() => {
        const pad = (n: number) => String(n).padStart(2, '0')
        return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`
      })()
    : `${year}-07-01`
  const url = `${WYOMING_BASE}?datetime=${(refDate + ' 12:00:00').replace(' ', '%20')}&id=${station}&type=INVENTORY&src=${WYOMING_SRC}`

  const RETRIES = 3
  let lastErr: any
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      const html = await fetchWithTimeout(url, TIMEOUT)
      const datetimes = parseInventory(html, year)
      inventoryCache.set(cacheKey, { datetimes, timestamp: Date.now() })
      return datetimes
    } catch (e: any) {
      lastErr = e
      if (attempt < RETRIES - 1) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
    }
  }
  throw lastErr
}

// Parseia o HTML de uma única sondagem e retorna um Launch.
// Novo formato: "Observations for Station 82599 at 12 UTC 01 Jul 2026"
// Compatível com formato antigo: "Observations at 12Z 01 Jul 2026"
function parseSingleSounding(html: string): Launch | null {
  const m = html.match(/Observations(?:\s+for\s+Station\s+\d+)?\s+at\s+(\d{1,2})\s*(?:Z|UTC)\s+(\d{1,2})\s+(\w{3})\s+(\d{4})/i)
  if (!m) return null

  const hourUtc = parseInt(m[1])
  const day = parseInt(m[2])
  const monStr = m[3].slice(0, 3)
  const yr = parseInt(m[4])
  const monNum = MONTH_MAP[monStr]
  if (!monNum || hourUtc < 0 || hourUtc > 23 || day < 1 || day > 31) return null

  const utcMs = Date.UTC(yr, monNum - 1, day, hourUtc, 0, 0)
  let localDate = new Date(utcMs + GMT3)
  // Mesmo boundary guard do parseLaunches original: mantém data UTC quando
  // o ajuste de -3h cruzaria fronteira de mês/ano.
  if (localDate.getUTCFullYear() !== yr || localDate.getUTCMonth() + 1 !== monNum) {
    localDate = new Date(utcMs)
  }

  const pad = (n: number) => n.toString().padStart(2, '0')
  const launch: Launch = {
    date: `${localDate.getUTCFullYear()}-${pad(localDate.getUTCMonth() + 1)}-${pad(localDate.getUTCDate())}`,
    time_local: `${pad(localDate.getUTCHours())}:${pad(localDate.getUTCMinutes())}`,
    time_utc: `${pad(hourUtc)}:00Z`,
    day: localDate.getUTCDate(),
    month: localDate.getUTCMonth() + 1,
    year: localDate.getUTCFullYear(),
  }
  return validateLaunch(launch) ? launch : null
}

async function fetchSingleSounding(station: string, datetime: string): Promise<Launch | null> {
  const cacheKey = `sounding_${station}_${datetime}`
  const cached = memoryCache.get(cacheKey)
  if (cached) return cached.data

  const url = `${WYOMING_BASE}?datetime=${datetime.replace(' ', '%20')}&id=${station}&src=${WYOMING_SRC}&type=TEXT:LIST`

  const RETRIES = 3
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(TIMEOUT),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SondasNatal/1.0)', 'Accept': 'text/html,application/xhtml+xml' },
      })
      // 400 = slot sem dados (determinístico) — não faz retry, cacheia null
      if (res.status === 400) {
        memoryCache.set(cacheKey, { data: null, timestamp: Date.now() })
        return null
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const html = await res.text()
      const launch = parseSingleSounding(html)
      memoryCache.set(cacheKey, { data: launch, timestamp: Date.now() })
      return launch
    } catch (e: any) {
      if (attempt < RETRIES - 1) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
    }
  }
  return null
}

// Busca todas as sondagens Wyoming de um mês que ainda não estão em cache.
// Retorna apenas as novas (a mesclagem com existentes fica em syncMonth).
async function fetchWyomingMonth(
  station: string, year: number, month: number, existingKeys: Set<string>
): Promise<Launch[]> {
  const allDatetimes = await fetchInventory(station, year)
  const monthStr = String(month).padStart(2, '0')
  const missing = allDatetimes
    .filter(dt => dt.startsWith(`${year}-${monthStr}`))
    .filter(dt => !existingKeys.has(inventoryDtToKey(dt)))

  if (missing.length === 0) return []

  // Busca em lotes paralelos para não sobrecarregar o servidor da Wyoming.
  const BATCH = 5
  const result: Launch[] = []
  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH)
    const settled = await Promise.allSettled(batch.map(dt => fetchSingleSounding(station, dt)))
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) result.push(r.value)
    }
  }
  return result
}

interface LaunchPosition {
  lat: number
  lon: number
  sondeNumber: string
  status: string
  altitude?: number
  course?: string
}

interface Launch {
  date: string
  time_local: string
  time_utc: string
  day: number
  month: number
  year: number
  // Preenchido pelo sync em segundo plano (app/api/radiosondy-sync/route.ts).
  radiosondyMatch?: 'yes' | 'no'
  // Posição final da sonda (radiosondy.info ou sondehub.org) — ver
  // app/historico/LaunchMap.tsx, que usa isso pra não precisar de fetch ao vivo.
  position?: LaunchPosition
  // Estações sem cobertura na Wyoming (Station.wyomingSupported === false):
  // 'radiosondy' = horário aproximado, derivado de fetchRadiosondyLaunches
  // (app/lib/radiosondy.ts); 'sondehub' = idem, via fetchSondeHubApproxLaunches
  // (app/lib/sondehub.ts) — cobre voos sem recuperação física registrada no
  // radiosondy.info, mas só alcança os últimos 3 dias (sem busca histórica).
  // Ausente = Wyoming (comportamento padrão, todas as estações antigas).
  source?: 'wyoming' | 'radiosondy' | 'sondehub'
  approx?: boolean
}

function validateLaunch(launch: Launch): boolean {
  // Validação básica
  return (
    typeof launch.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(launch.date) &&
    typeof launch.time_local === 'string' && /^\d{2}:\d{2}$/.test(launch.time_local) &&
    typeof launch.time_utc === 'string' && /^\d{2}:\d{2}Z$/.test(launch.time_utc) &&
    typeof launch.day === 'number' && launch.day >= 1 && launch.day <= 31 &&
    typeof launch.month === 'number' && launch.month >= 1 && launch.month <= 12 &&
    typeof launch.year === 'number' && launch.year >= 2020 && launch.year <= 2100
  )
}


/**
 * Limpa o YearStore de entradas inválidas que podem ter sido gravadas por
 * versões antigas do código:
 * - lançamentos de outro ano (ex.: um "31/Dez" de virada de ano armazenado
 *   por engano dentro do arquivo do ano seguinte, antes da correção de
 *   fronteira de mês/ano existir);
 * - meses posteriores ao mês corrente (defesa contra cálculo de "hoje"
 *   incorreto em algum deploy anterior).
 */
function sanitizeStore(store: YearStore, currentYear: number, currentMonth: number): boolean {
  const maxMonth = store.year < currentYear ? 12 : store.year === currentYear ? currentMonth : 0
  const before = store.launches.length
  store.launches = store.launches.filter(l => l.year === store.year && l.month <= maxMonth)
  const changed = store.launches.length !== before
  // Algo de inválido foi removido: força um resync (ainda incremental, a
  // partir do que restou de cada mês) para reparar o dado em vez de só apagar.
  if (changed) store.monthsComplete = []
  return changed
}

/**
 * Sincroniza um único mês dentro do YearStore: reaproveita o que já está
 * salvo, busca na origem só os dias novos (a partir do último dia salvo) e
 * mescla sem duplicar. Mês corrente nunca é marcado como "completo", pois
 * ainda pode ganhar lançamentos novos.
 */
// Busca um mês de uma estação sem cobertura na Wyoming (ver
// Station.wyomingSupported em app/lib/stations.ts), combinando 3 fontes
// aproximadas em paralelo — nenhuma sozinha é completa:
// 1. radiosondy.info (fetchRadiosondyLaunches) — só registra um voo se
//    alguém cadastrar manualmente o achado físico do equipamento.
// 2. Arquivo histórico do sondehub.org (fetchSondeHubArchiveLaunches) — um
//    bucket S3 público por estação/ano/mês/dia, não depende de recuperação
//    física, mas tem atraso de meses (confirmado: o registro mais recente de
//    Natal/82599 lá era de 2026-03, já em junho/2026) — cobre meses passados
//    que o radiosondy.info não tem (caso real: Fernando de Noronha,
//    12/03/2026, serial V2931576, ausente do export_search.php).
// 3. Feed ao vivo do sondehub.org (fetchSondeHubApproxLaunches) — só os
//    últimos ~3 dias, mas sem o atraso do arquivo; só vale a pena no mês
//    corrente.
// Falha pontual numa fonte não bloqueia as outras (Promise.allSettled).
// Extrai a posição (lat/lon/serial/status) da feature já buscada em vez de
// descartá-la — persistida no servidor, LaunchMap.tsx não precisa refazer
// essa busca depois.
function radiosondyApproxToLaunch({ feature, ...launch }: Awaited<ReturnType<typeof fetchRadiosondyLaunches>>[number]): Launch {
  return { ...launch, position: { lat: feature.lat, lon: feature.lon, sondeNumber: feature.sondeNumber, status: feature.status } }
}

async function fetchApproxLaunches(
  stationInfo: Station | undefined, year: number, month: number, isCurrentMonth: boolean
): Promise<Launch[]> {
  if (!stationInfo) return []

  const results = await Promise.allSettled([
    stationInfo.radiosondyStartplace
      ? fetchRadiosondyLaunches(year, month, stationInfo.radiosondyStartplace).then(approx => approx.map(radiosondyApproxToLaunch))
      : Promise.resolve([]),
    fetchSondeHubArchiveLaunches(stationInfo.id, year, month),
    isCurrentMonth
      ? fetchSondeHubApproxLaunches(stationInfo.lat, stationInfo.lon, year, month)
      : Promise.resolve([]),
  ])

  const byKey = new Map<string, Launch>()
  for (const r of results) {
    if (r.status !== 'fulfilled') continue
    for (const l of r.value) {
      const key = `${l.date}_${l.time_utc}`
      if (!byKey.has(key)) byKey.set(key, l)
    }
  }
  return [...byKey.values()]
}

// Complementa a Wyoming no mês corrente com fontes "ao vivo" (radiosondy.info
// + feed ao vivo do sondehub.org) — não o arquivo S3 do sondehub.org, que tem
// meses de atraso e só vale a pena pra preencher estações sem Wyoming de uma
// vez (ver fetchApproxLaunches). A Wyoming é lenta pra publicar (confirmado:
// em 2026-06-29 ela só tinha Natal/82599 até 26/06) — sem isso, qualquer
// lançamento mais recente que a última publicação da Wyoming simplesmente
// não aparece no histórico/"Ao vivo", mesmo já sabido por outra fonte.
async function fetchComplementaryLaunches(
  stationInfo: Station, year: number, month: number
): Promise<Launch[]> {
  const results = await Promise.allSettled([
    stationInfo.radiosondyStartplace
      ? fetchRadiosondyLaunches(year, month, stationInfo.radiosondyStartplace).then(approx => approx.map(radiosondyApproxToLaunch))
      : Promise.resolve([]),
    fetchSondeHubApproxLaunches(stationInfo.lat, stationInfo.lon, year, month),
  ])

  const byKey = new Map<string, Launch>()
  for (const r of results) {
    if (r.status !== 'fulfilled') continue
    for (const l of r.value) {
      const key = `${l.date}_${l.time_utc}`
      if (!byKey.has(key)) byKey.set(key, l)
    }
  }
  return [...byKey.values()]
}

async function syncMonth(
  store: YearStore, station: string, year: number, month: number, isCurrentMonth: boolean
): Promise<{ launches: Launch[]; updated: boolean }> {
  if (store.monthsComplete.includes(month)) {
    return { launches: store.launches.filter(l => l.month === month), updated: false }
  }

  const stationInfo = findStation(station)

  if (stationInfo?.wyomingSupported === false) {
    const merged = await fetchApproxLaunches(stationInfo, year, month, isCurrentMonth)
    store.launches = store.launches.filter(l => l.month !== month).concat(merged)
    if (!isCurrentMonth) store.monthsComplete.push(month)
    return { launches: merged, updated: true }
  }

  const existingForMonth = store.launches.filter(l => l.month === month)
  const existingWyoming = existingForMonth.filter(l => !l.source)
  const existingApprox = existingForMonth.filter(l => l.source)

  let wyomingOk = false
  let merged: Launch[] = existingForMonth

  try {
    const existingKeys = new Set(existingWyoming.map(launchToInventoryKey))
    const fresh = await fetchWyomingMonth(station, year, month, existingKeys)
    wyomingOk = true

    const seenWyoming = new Set(existingWyoming.map(l => `${l.date}_${l.time_utc}`))
    const mergedWyoming = existingWyoming.concat(fresh.filter(l => !seenWyoming.has(`${l.date}_${l.time_utc}`)))

    // Descarta entradas aproximadas que a Wyoming já confirmou no horário exato.
    const wyomingKeys = new Set(mergedWyoming.map(l => `${l.date}_${l.time_utc}`))
    merged = mergedWyoming.concat(existingApprox.filter(l => !wyomingKeys.has(`${l.date}_${l.time_utc}`)))
  } catch {
    // Wyoming indisponível — usa fontes alternativas (radiosondy.info + sondehub)
    // para não deixar o mês vazio enquanto a Wyoming estiver fora.
  }

  // Fontes complementares: sempre no mês corrente; também em meses passados
  // quando a Wyoming falhou (para não retornar vazio).
  if (stationInfo && (isCurrentMonth || !wyomingOk)) {
    try {
      const complementary = isCurrentMonth
        ? await fetchComplementaryLaunches(stationInfo, year, month)
        : await fetchApproxLaunches(stationInfo, year, month, false)
      const knownKeys = new Set(merged.map(l => `${l.date}_${l.time_utc}`))
      merged = merged.concat(complementary.filter(l => !knownKeys.has(`${l.date}_${l.time_utc}`)))
    } catch {
      // Falha pontual nas fontes complementares.
    }
  }

  store.launches = store.launches.filter(l => l.month !== month).concat(merged)
  // Só marca completo se a Wyoming respondeu (dados definitivos); se só temos
  // fontes aproximadas, não marca — próxima sync tenta Wyoming de novo.
  if (!isCurrentMonth && wyomingOk) store.monthsComplete.push(month)

  return { launches: merged, updated: true }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action') ?? 'today'
  const station = searchParams.get('station') ?? DEFAULT_STATION_ID

  const local = nowGMT3()
  const pad2 = (n: number) => n.toString().padStart(2, '0')
  const todayStr = `${local.getUTCFullYear()}-${pad2(local.getUTCMonth() + 1)}-${pad2(local.getUTCDate())}`

  try {
    if (action === 'today') {
      const year = local.getUTCFullYear()
      const month = local.getUTCMonth() + 1
      const stationInfo = findStation(station)
      let launches: Launch[]
      if (stationInfo?.wyomingSupported === false) {
        launches = await fetchApproxLaunches(stationInfo, year, month, true)
      } else {
        let wyomingOk = false
        try {
          // Para "today", busca o mês inteiro via inventário (cache torna isso barato em chamadas repetidas).
          launches = await fetchWyomingMonth(station, year, month, new Set())
          wyomingOk = true
        } catch {
          launches = []
        }
        if (stationInfo) {
          try {
            const complementary = wyomingOk
              ? await fetchComplementaryLaunches(stationInfo, year, month)
              : await fetchApproxLaunches(stationInfo, year, month, true)
            const knownKeys = new Set(launches.map(l => `${l.date}_${l.time_utc}`))
            launches = launches.concat(complementary.filter(l => !knownKeys.has(`${l.date}_${l.time_utc}`)))
          } catch {
            // Falha pontual nas fontes complementares.
          }
        }
      }
      const todayLaunches = launches.filter(l => l.date === todayStr)

      return NextResponse.json({
        today: todayStr,
        station,
        launched_today: todayLaunches.length > 0,
        count: todayLaunches.length,
        launches: todayLaunches,
        all_this_month: launches,
        cached: false,
      })
    }

    if (action === 'month') {
      const year = parseInt(searchParams.get('year') ?? String(local.getUTCFullYear()))
      const month = parseInt(searchParams.get('month') ?? String(local.getUTCMonth() + 1))

      if (month < 1 || month > 12) {
        return NextResponse.json({ error: 'Mês inválido (1-12)' }, { status: 400 })
      }

      const currentYear = local.getUTCFullYear()
      const currentMonth = local.getUTCMonth() + 1

      // Mês futuro: sem dados ainda, não consulta a origem
      const isFuture = year > currentYear || (year === currentYear && month > currentMonth)
      if (isFuture) {
        return NextResponse.json({ year, month, station, count: 0, launches: [], cached: false })
      }

      const isCurrentMonth = year === currentYear && month === currentMonth
      const store = (await readYearStore(station, year)) ?? { year, launches: [] as Launch[], monthsComplete: [] as number[], updatedAt: 0 }
      const sanitized = sanitizeStore(store, currentYear, currentMonth)
      const { launches, updated } = await syncMonth(store, station, year, month, isCurrentMonth)

      if (updated || sanitized) {
        store.updatedAt = Date.now()
        await writeYearStore(station, store)
      }

      return NextResponse.json({
        year, month, station,
        count: launches.length,
        launches,
        cached: !updated,
      })
    }

    if (action === 'year') {
      const year = parseInt(searchParams.get('year') ?? String(local.getUTCFullYear()))
      const currentYear = local.getUTCFullYear()
      const currentMonth = local.getUTCMonth() + 1
      const errors: { month: number; error: string }[] = []

      // Ano futuro: sem dados, não consulta a origem
      if (year > currentYear) {
        return NextResponse.json({ year, station, count: 0, launches: [], errors, cached: false })
      }

      const maxMonth = year === currentYear ? currentMonth : 12
      const store = (await readYearStore(station, year)) ?? { year, launches: [] as Launch[], monthsComplete: [] as number[], updatedAt: 0 }
      let changed = sanitizeStore(store, currentYear, currentMonth)

      for (let m = 1; m <= maxMonth; m++) {
        const isCurrentMonth = year === currentYear && m === currentMonth
        try {
          const { updated } = await syncMonth(store, station, year, m, isCurrentMonth)
          if (updated) changed = true
        } catch (e: any) {
          errors.push({ month: m, error: e.message })
        }
      }

      if (changed) {
        store.updatedAt = Date.now()
        await writeYearStore(station, store)
      }

      return NextResponse.json({
        year, station,
        count: store.launches.length,
        launches: store.launches,
        errors,
        cached: false,
      })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e: any) {
    console.error('[API Error]', e.message)
    return NextResponse.json({ 
      error: e.message || 'Erro ao processar requisição',
      details: process.env.NODE_ENV === 'development' ? e.stack : undefined,
    }, { status: 500 })
  }
}
