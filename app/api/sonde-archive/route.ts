import { NextRequest, NextResponse } from 'next/server'

/**
 * Proxy do arquivo por sonda do radiosondy.info
 * (`sonde_archive.php?sondenumber=W3770311`), a única fonte que diz o
 * **primeiro quadro recebido** de cada sonda — hoje o horário de lançamento
 * exibido no app (ver app/lib/sondeArchive.ts).
 *
 * Precisa ser server-side por dois motivos:
 *  - a página devolve **403** sem um User-Agent de navegador;
 *  - é HTML puro, sem CORS, então o navegador não consegue ler a resposta.
 *
 * GET ?serials=W3770311,W3770329 → { sondes: { [serial]: info | null } }
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
const FETCH_TIMEOUT_MS = 12_000
const MAX_SERIALS = 12       // por requisição (o cliente já divide em lotes)
const CONCURRENCY = 3        // gentil com o radiosondy.info

// Cache em memória (por instância do servidor). Voo já terminado não muda
// mais; voo ainda recente e "sem página" podem mudar em minutos.
const FRESH_TTL_MS = 24 * 60 * 60 * 1000
const RECENT_TTL_MS = 10 * 60 * 1000
const MISS_TTL_MS = 60 * 60 * 1000
const RECENT_FLIGHT_MS = 6 * 60 * 60 * 1000

export interface SondeArchiveInfo {
  serial: string
  firstFrameUtc?: string  // "YYYY-MM-DD HH:mm:ssz" como vem da página
  lastFrameUtc?: string
  frames?: number
  receivers?: string[]
}

const cache = new Map<string, { value: SondeArchiveInfo | null; expiresAt: number }>()

function parseArchive(serial: string, html: string): SondeArchiveInfo | null {
  const first = html.match(/First Frame \[UTC\]:\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}z?)/i)
  const last = html.match(/Last Frame \[UTC\]:\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}z?)/i)
  const frames = html.match(/Received Frames:\s*(\d+)/i)
  if (!first && !last) return null
  return {
    serial,
    firstFrameUtc: first?.[1],
    lastFrameUtc: last?.[1],
    frames: frames ? Number(frames[1]) : undefined,
  }
}

function ttlFor(info: SondeArchiveInfo | null): number {
  if (!info) return MISS_TTL_MS
  const ref = info.lastFrameUtc ?? info.firstFrameUtc
  if (!ref) return MISS_TTL_MS
  const ms = new Date(ref.replace(' ', 'T').replace(/z$/i, '') + 'Z').getTime()
  if (Number.isNaN(ms)) return RECENT_TTL_MS
  return Date.now() - ms > RECENT_FLIGHT_MS ? FRESH_TTL_MS : RECENT_TTL_MS
}

async function fetchOne(serial: string): Promise<SondeArchiveInfo | null> {
  const hit = cache.get(serial)
  if (hit && hit.expiresAt > Date.now()) return hit.value
  const url = `https://radiosondy.info/sonde_archive.php?sondenumber=${encodeURIComponent(serial)}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': UA, 'Accept': 'text/html' },
      cache: 'no-store',
    })
    if (!res.ok) return null  // não cacheia erro de transporte
    const info = parseArchive(serial, await res.text())
    cache.set(serial, { value: info, expiresAt: Date.now() + ttlFor(info) })
    return info
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('serials') ?? req.nextUrl.searchParams.get('serial') ?? ''
  const serials = [...new Set(raw.split(',').map(s => s.trim()).filter(Boolean))]
    .filter(s => /^[A-Za-z0-9_-]{3,20}$/.test(s))
    .slice(0, MAX_SERIALS)
  if (serials.length === 0) return NextResponse.json({ sondes: {} })

  const sondes: Record<string, SondeArchiveInfo | null> = {}
  const queue = [...serials]
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (let serial = queue.shift(); serial; serial = queue.shift()) {
      sondes[serial] = await fetchOne(serial)
    }
  }))
  return NextResponse.json({ sondes })
}
