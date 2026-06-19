import { NextRequest, NextResponse } from 'next/server'

const GMT3 = -3 * 60 * 60 * 1000
const STATION_ID = '82599'
const REGION = 'naconf'
const TIMEOUT = 15000 // 15 segundos por requisição

// Cache em memória (persiste durante a sessão do servidor)
const memoryCache = new Map<string, { data: any; timestamp: number }>()

function nowGMT3() {
  return new Date(Date.now() + GMT3 + new Date().getTimezoneOffset() * 60000)
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

async function fetchSounding(year: number, month: number): Promise<string> {
  const cacheKey = `sounding_${year}_${String(month).padStart(2, '0')}`
  const now = new Date()
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1
  
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

  const url = `https://weather.uwyo.edu/cgi-bin/sounding?region=${REGION}&TYPE=TEXT%3ALIST&YEAR=${year}&MONTH=${String(month).padStart(2, '0')}&FROM=0100&TO=3123&STNM=${STATION_ID}`
  
  try {
    const html = await fetchWithTimeout(url, TIMEOUT)
    memoryCache.set(cacheKey, { data: html, timestamp: Date.now() })
    return html
  } catch (e: any) {
    if (e.name === 'AbortError') {
      throw new Error(`Timeout ao conectar com Wyoming (>${TIMEOUT}ms)`)
    }
    throw e
  }
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
      const localDate = new Date(localMs)

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

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action') ?? 'today'

  const local = nowGMT3()
  const pad2 = (n: number) => n.toString().padStart(2, '0')
  const todayStr = `${local.getFullYear()}-${pad2(local.getMonth() + 1)}-${pad2(local.getDate())}`

  try {
    if (action === 'today') {
      const year = local.getFullYear()
      const month = local.getMonth() + 1
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
      const year = parseInt(searchParams.get('year') ?? String(local.getFullYear()))
      const month = parseInt(searchParams.get('month') ?? String(local.getMonth() + 1))
      
      if (month < 1 || month > 12) {
        return NextResponse.json({ error: 'Mês inválido (1-12)' }, { status: 400 })
      }

      const html = await fetchSounding(year, month)
      const launches = parseLaunches(html, year, month)

      return NextResponse.json({ 
        year, month, station: STATION_ID, 
        count: launches.length, 
        launches,
        cached: false,
      })
    }

    if (action === 'year') {
      const year = parseInt(searchParams.get('year') ?? String(local.getFullYear()))
      const allLaunches: Launch[] = []
      const errors: { month: number; error: string }[] = []
      const maxMonth = year === local.getFullYear() ? local.getMonth() + 1 : 12

      for (let m = 1; m <= maxMonth; m++) {
        try {
          const html = await fetchSounding(year, m)
          const launches = parseLaunches(html, year, m)
          allLaunches.push(...launches)
        } catch (e: any) {
          errors.push({ month: m, error: e.message })
        }
      }

      return NextResponse.json({
        year, station: STATION_ID,
        count: allLaunches.length,
        launches: allLaunches,
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
