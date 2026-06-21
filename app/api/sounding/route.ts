import { NextRequest, NextResponse } from 'next/server'
import { readYearStore, writeYearStore, YearStore } from '@/app/lib/blobStore'

const GMT3 = -3 * 60 * 60 * 1000
const STATION_ID = '82599'
const REGION = 'naconf'
const TIMEOUT = 15000 // 15 segundos por requisição

// Cache em memória (persiste durante a sessão do servidor)
const memoryCache = new Map<string, { data: any; timestamp: number }>()

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

async function fetchSounding(year: number, month: number, fromDay = 0): Promise<string> {
  const cacheKey = `sounding_${year}_${String(month).padStart(2, '0')}_${fromDay}`
  const now = nowGMT3()
  const isCurrentMonth = year === now.getUTCFullYear() && month === now.getUTCMonth() + 1

  // Verifica cache em memória
  const cached = memoryCache.get(cacheKey)
  if (cached) {
    // Mês atual: válido por 1 hora
    if (isCurrentMonth && Date.now() - cached.timestamp < 3600000) {
      return cached.data
    }
    // Meses passados: permanente
    if (!isCurrentMonth) {
      return cached.data
    }
  }

  // Permite buscar só a partir de um dia específico, para atualizações incrementais.
  // TO precisa ser um dia válido do mês (a Wyoming responde 400 para TO=31 em meses com menos dias).
  const fromStr = fromDay > 0 ? `${String(fromDay).padStart(2, '0')}00` : '0100'
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const toStr = `${String(lastDay).padStart(2, '0')}23`
  const url = `https://weather.uwyo.edu/cgi-bin/sounding?region=${REGION}&TYPE=TEXT%3ALIST&YEAR=${year}&MONTH=${String(month).padStart(2, '0')}&FROM=${fromStr}&TO=${toStr}&STNM=${STATION_ID}`

  // A Wyoming falha de forma intermitente (400/403/500 aleatórios, sem relação
  // com o mês pedido) — tenta de novo algumas vezes antes de desistir.
  const RETRIES = 3
  let lastErr: any
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      const html = await fetchWithTimeout(url, TIMEOUT)
      memoryCache.set(cacheKey, { data: html, timestamp: Date.now() })
      return html
    } catch (e: any) {
      lastErr = e
      if (attempt < RETRIES - 1) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
    }
  }
  if (lastErr.name === 'AbortError') {
    throw new Error(`Timeout ao conectar com Wyoming (>${TIMEOUT}ms)`)
  }
  throw lastErr
}

interface Launch {
  date: string
  time_local: string
  time_utc: string
  day: number
  month: number
  year: number
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

function parseLaunches(html: string, year: number, month: number): Launch[] {
  const pattern = /Observations at\s+(\d{2})Z\s+(\d{2})\s+(\w{3})\s+(\d{4})/gi
  const launches: Launch[] = []
  let m: RegExpExecArray | null

  while ((m = pattern.exec(html)) !== null) {
    try {
      const hourUtc = parseInt(m[1])
      const day = parseInt(m[2])
      const monStr = m[3].slice(0, 3)
      const yr = parseInt(m[4])
      const monNum = MONTH_MAP[monStr] ?? month

      // Validação rápida antes de criar data
      if (hourUtc < 0 || hourUtc > 23 || day < 1 || day > 31) continue

      const utcMs = Date.UTC(yr, monNum - 1, day, hourUtc, 0, 0)
      const localMs = utcMs + GMT3
      let localDate = new Date(localMs)

      // O ajuste de -3h pode empurrar o lançamento de 00Z do dia 1 para o
      // último dia do mês anterior (ex: 1/Jan 00Z -> 31/Dez 21h). Isso fazia
      // o lançamento ser contado no mês errado. Quando isso cruzar a
      // fronteira do mês, mantemos a data/mês original em UTC.
      if (localDate.getUTCFullYear() !== yr || localDate.getUTCMonth() + 1 !== monNum) {
        localDate = new Date(utcMs)
      }

      const pad = (n: number) => n.toString().padStart(2, '0')
      const dateStr = `${localDate.getUTCFullYear()}-${pad(localDate.getUTCMonth() + 1)}-${pad(localDate.getUTCDate())}`

      const launch: Launch = {
        date: dateStr,
        time_local: `${pad(localDate.getUTCHours())}:${pad(localDate.getUTCMinutes())}`,
        time_utc: `${pad(hourUtc)}:00Z`,
        day: localDate.getUTCDate(),
        month: localDate.getUTCMonth() + 1,
        year: localDate.getUTCFullYear(),
      }

      if (validateLaunch(launch)) {
        launches.push(launch)
      }
    } catch (e) {
      // Skip invalid entries
      continue
    }
  }

  // Remove duplicatas
  const seen = new Set<string>()
  return launches.filter(l => {
    const key = `${l.date}_${l.time_utc}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Remove do YearStore qualquer mês posterior ao mês corrente (defesa contra
 * dados de meses futuros que possam ter sido gravados por engano, ex.: por
 * um cálculo de "hoje" incorreto em algum deploy anterior).
 */
function sanitizeFutureMonths(store: YearStore, currentYear: number, currentMonth: number): boolean {
  if (store.year < currentYear) return false
  const maxMonth = store.year === currentYear ? currentMonth : 0
  const before = store.launches.length
  store.launches = store.launches.filter(l => l.month <= maxMonth)
  store.monthsComplete = store.monthsComplete.filter(m => m <= maxMonth)
  return store.launches.length !== before
}

/**
 * Sincroniza um único mês dentro do YearStore: reaproveita o que já está
 * salvo, busca na origem só os dias novos (a partir do último dia salvo) e
 * mescla sem duplicar. Mês corrente nunca é marcado como "completo", pois
 * ainda pode ganhar lançamentos novos.
 */
async function syncMonth(
  store: YearStore, year: number, month: number, isCurrentMonth: boolean
): Promise<{ launches: Launch[]; updated: boolean }> {
  if (store.monthsComplete.includes(month)) {
    return { launches: store.launches.filter(l => l.month === month), updated: false }
  }

  const existingForMonth = store.launches.filter(l => l.month === month)
  const lastDay = existingForMonth.reduce((max, l) => Math.max(max, l.day), 0)

  const html = await fetchSounding(year, month, lastDay)
  const fresh = parseLaunches(html, year, month)

  const seen = new Set(existingForMonth.map(l => `${l.date}_${l.time_utc}`))
  const merged = existingForMonth.concat(fresh.filter(l => !seen.has(`${l.date}_${l.time_utc}`)))

  store.launches = store.launches.filter(l => l.month !== month).concat(merged)
  if (!isCurrentMonth) store.monthsComplete.push(month)

  return { launches: merged, updated: true }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action') ?? 'today'

  const local = nowGMT3()
  const pad2 = (n: number) => n.toString().padStart(2, '0')
  const todayStr = `${local.getUTCFullYear()}-${pad2(local.getUTCMonth() + 1)}-${pad2(local.getUTCDate())}`

  try {
    if (action === 'today') {
      const year = local.getUTCFullYear()
      const month = local.getUTCMonth() + 1
      const html = await fetchSounding(year, month)
      const launches = parseLaunches(html, year, month)
      const todayLaunches = launches.filter(l => l.date === todayStr)

      return NextResponse.json({
        today: todayStr,
        station: STATION_ID,
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
        return NextResponse.json({ year, month, station: STATION_ID, count: 0, launches: [], cached: false })
      }

      const isCurrentMonth = year === currentYear && month === currentMonth
      const store = (await readYearStore(year)) ?? { year, launches: [] as Launch[], monthsComplete: [] as number[], updatedAt: 0 }
      const sanitized = sanitizeFutureMonths(store, currentYear, currentMonth)
      const { launches, updated } = await syncMonth(store, year, month, isCurrentMonth)

      if (updated || sanitized) {
        store.updatedAt = Date.now()
        await writeYearStore(store)
      }

      return NextResponse.json({
        year, month, station: STATION_ID,
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
        return NextResponse.json({ year, station: STATION_ID, count: 0, launches: [], errors, cached: false })
      }

      const maxMonth = year === currentYear ? currentMonth : 12
      const store = (await readYearStore(year)) ?? { year, launches: [] as Launch[], monthsComplete: [] as number[], updatedAt: 0 }
      let changed = sanitizeFutureMonths(store, currentYear, currentMonth)

      for (let m = 1; m <= maxMonth; m++) {
        const isCurrentMonth = year === currentYear && m === currentMonth
        try {
          const { updated } = await syncMonth(store, year, m, isCurrentMonth)
          if (updated) changed = true
        } catch (e: any) {
          errors.push({ month: m, error: e.message })
        }
      }

      if (changed) {
        store.updatedAt = Date.now()
        await writeYearStore(store)
      }

      return NextResponse.json({
        year, station: STATION_ID,
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
