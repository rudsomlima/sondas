import { NextRequest, NextResponse } from 'next/server'

const GMT3 = -3 * 60 * 60 * 1000
const STATION_ID = '82599'
const REGION = 'naconf'

function nowGMT3() {
  return new Date(Date.now() + GMT3 + new Date().getTimezoneOffset() * 60000)
}

const MONTH_MAP: Record<string, number> = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
}

async function fetchSounding(year: number, month: number): Promise<string> {
  const url = `https://weather.uwyo.edu/cgi-bin/sounding?region=${REGION}&TYPE=TEXT%3ALIST&YEAR=${year}&MONTH=${month.toString().padStart(2, '0')}&FROM=0100&TO=3123&STNM=${STATION_ID}`
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; SondasNatal/1.0)',
      'Accept': 'text/html,application/xhtml+xml',
    },
    next: { revalidate: 300 },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
  return res.text()
}

interface Launch {
  date: string
  time_local: string
  time_utc: string
  day: number
  month: number
  year: number
}

function parseLaunches(html: string, year: number, month: number): Launch[] {
  const pattern = /Observations at\s+(\d{2})Z\s+(\d{2})\s+(\w{3})\s+(\d{4})/gi
  const launches: Launch[] = []
  let m: RegExpExecArray | null

  while ((m = pattern.exec(html)) !== null) {
    const hourUtc = parseInt(m[1])
    const day = parseInt(m[2])
    const monStr = m[3].slice(0, 3)
    const yr = parseInt(m[4])
    const monNum = MONTH_MAP[monStr] ?? month

    // Build UTC date then shift to GMT-3
    const utcMs = Date.UTC(yr, monNum - 1, day, hourUtc, 0, 0)
    const localMs = utcMs + GMT3
    const localDate = new Date(localMs)

    const pad = (n: number) => n.toString().padStart(2, '0')
    const dateStr = `${localDate.getUTCFullYear()}-${pad(localDate.getUTCMonth() + 1)}-${pad(localDate.getUTCDate())}`

    launches.push({
      date: dateStr,
      time_local: `${pad(localDate.getUTCHours())}:${pad(localDate.getUTCMinutes())}`,
      time_utc: `${pad(hourUtc)}:00Z`,
      day: localDate.getUTCDate(),
      month: localDate.getUTCMonth() + 1,
      year: localDate.getUTCFullYear(),
    })
  }

  return launches
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
      })
    }

    if (action === 'month') {
      const year = parseInt(searchParams.get('year') ?? String(local.getFullYear()))
      const month = parseInt(searchParams.get('month') ?? String(local.getMonth() + 1))
      const html = await fetchSounding(year, month)
      const launches = parseLaunches(html, year, month)

      return NextResponse.json({ year, month, station: STATION_ID, count: launches.length, launches })
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
      })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
