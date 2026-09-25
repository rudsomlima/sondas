/**
 * Renderiza um PNG de mapa (tiles do OpenStreetMap — os MESMOS usados no
 * navegador em leafletBase.ts) com marcadores, sem depender de nenhuma API
 * de mapa estático de terceiro: a maioria hoje exige cadastro/chave, e o
 * serviço gratuito sem chave mais usado (staticmap.openstreetmap.de) saiu
 * do ar. Server-only — usa `sharp` pra colar os tiles e desenhar os pinos.
 */
import sharp, { type OverlayOptions } from 'sharp'

const TILE_SIZE = 256
// OSM pede um User-Agent identificando a aplicação (política de uso de
// tiles) — sem isso, alguns pedidos podem ser recusados.
const USER_AGENT = 'SondasNatalApp/1.0 (+https://sondas.vercel.app)'
const MAX_CONCURRENT_TILE_REQUESTS = 2
let activeTileRequests = 0
const tileRequestQueue: Array<() => void> = []

async function withTileRequestSlot<T>(request: () => Promise<T>): Promise<T> {
  if (activeTileRequests >= MAX_CONCURRENT_TILE_REQUESTS) {
    await new Promise<void>(resolve => tileRequestQueue.push(resolve))
  }
  activeTileRequests++
  try {
    return await request()
  } finally {
    activeTileRequests--
    tileRequestQueue.shift()?.()
  }
}

function lonLatToTilePoint(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom
  const x = (lon + 180) / 360 * n
  const latRad = lat * Math.PI / 180
  const y = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n
  return { x, y }
}

async function fetchTile(z: number, x: number, y: number): Promise<Buffer | null> {
  const n = 2 ** z
  if (y < 0 || y >= n) return null // fora do mapa (perto do polo) — sem wrap vertical
  const xw = ((x % n) + n) % n // wrap horizontal (antimeridiano)
  const subdomains = ['a', 'b', 'c']
  const firstSubdomain = Math.abs(x + y) % subdomains.length
  for (let attempt = 0; attempt < 3; attempt++) {
    const subdomain = subdomains[(firstSubdomain + attempt) % subdomains.length]
    const url = `https://${subdomain}.tile.openstreetmap.org/${z}/${xw}/${y}.png`
    try {
      const result = await withTileRequestSlot(async () => {
        const res = await fetch(url, {
          headers: { 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(5000),
        })
        if (!res.ok) return { retry: res.status === 408 || res.status === 429 || res.status >= 500, tile: null }
        const tile = Buffer.from(await res.arrayBuffer())
        const isPng = tile.length >= 8 && tile.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        return { retry: !isPng, tile: isPng ? tile : null }
      })
      if (result.tile) return result.tile
      if (!result.retry) return null
    } catch {
      // Reattempt on another subdomain after a timeout or network failure.
    }
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)))
  }
  return null
}

function pinSvg(color: string): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30">` +
    `<path d="M15 1C8.9 1 4 5.9 4 12c0 8.4 11 16.6 11 16.6S26 20.4 26 12c0-6.1-4.9-11-11-11z" ` +
    `fill="${color}" stroke="#111" stroke-width="1.4"/>` +
    `<circle cx="15" cy="12" r="4.5" fill="#fff"/></svg>`,
  )
}

export interface MapMarker {
  lat: number
  lon: number
  color: string // cor CSS do pino, ex.: "#ef4444"
  label?: string
}

export interface LandingPlace {
  city?: string
  atSea: boolean
}

const BRAZIL_STATE_UFS: Record<string, string> = {
  acre: 'AC', alagoas: 'AL', amapa: 'AP', amazonas: 'AM', bahia: 'BA', ceara: 'CE',
  'distrito federal': 'DF', 'espirito santo': 'ES', goias: 'GO', maranhao: 'MA',
  'mato grosso': 'MT', 'mato grosso do sul': 'MS', 'minas gerais': 'MG', para: 'PA',
  paraiba: 'PB', parana: 'PR', pernambuco: 'PE', piaui: 'PI', 'rio de janeiro': 'RJ',
  'rio grande do norte': 'RN', 'rio grande do sul': 'RS', rondonia: 'RO', roraima: 'RR',
  'santa catarina': 'SC', 'sao paulo': 'SP', sergipe: 'SE', tocantins: 'TO',
}

function brazilStateUf(state?: string, isoCode?: string): string | undefined {
  const isoMatch = isoCode?.toUpperCase().match(/(?:BR[- ])?([A-Z]{2})$/)
  if (isoMatch) return isoMatch[1]
  if (!state) return undefined
  if (/^[A-Z]{2}$/i.test(state.trim())) return state.trim().toUpperCase()
  const normalizedState = state.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
  return BRAZIL_STATE_UFS[normalizedState]
}

/** Identifica a cidade ou o mar mais próximo com busca reversa (melhor esforço). */
export async function lookupLandingPlace(lat: number, lon: number): Promise<LandingPlace> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&zoom=10&addressdetails=1`
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' },
      signal: AbortSignal.timeout(2500),
      cache: 'no-store',
    })
    if (!res.ok) return { atSea: false }
    const result = await res.json() as { class?: string; type?: string; addresstype?: string; name?: string; address?: Record<string, string> }
    const waterKinds = new Set(['sea', 'ocean', 'bay', 'strait'])
    const kind = `${result.type ?? ''} ${result.addresstype ?? ''}`.toLowerCase()
    const atSea = waterKinds.has(result.type ?? '') || waterKinds.has(result.addresstype ?? '') ||
      ((result.class === 'natural' || result.class === 'waterway') && /sea|ocean|bay|strait/.test(kind)) ||
      !!(result.address && ['sea', 'ocean'].some(k => k in result.address!))
    if (atSea) return { atSea, city: result.name || result.address?.sea || result.address?.ocean || 'Mar' }
    const address = result.address ?? {}
    const locality = address.city || address.town || address.village || address.municipality || address.hamlet
    const stateUf = brazilStateUf(address.state || address.state_district, address['ISO3166-2-lvl4'])
    return { atSea: false, city: locality ? `${locality}${stateUf ? `-${stateUf}` : ''}` : undefined }
  } catch {
    return { atSea: false }
  }
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function markerLabelSvg(text: string, maxWidth: number, maxHeight: number): { svg: Buffer; width: number; height: number } {
  // Reserve room for the outline and keep the label's SVG strictly inside the map.
  const width = Math.max(1, Math.floor(maxWidth))
  const heightLimit = Math.max(1, Math.floor(maxHeight))
  const label = text.trim()
  const inset = Math.min(8, Math.max(1, Math.floor(width / 10)))
  const textWidth = Math.max(1, width - inset * 2)
  const charCount = Math.max(1, Array.from(label).length)
  const heightFontLimit = Math.max(8, Math.floor((heightLimit - 12) / 1.25))
  // Arial's average glyph width is about 0.55em; using 0.62em leaves room
  // for wider letters while preserving a natural size for short localities.
  const widthFontLimit = Math.max(8, Math.floor(textWidth / (charCount * 0.62)))
  const fontSize = Math.min(60, heightFontLimit, widthFontLimit)
  const textLength = Math.min(textWidth, Math.max(1, Math.ceil(charCount * fontSize * 0.62)))
  const height = Math.min(heightLimit, Math.max(1, Math.ceil(fontSize * 1.25 + 12)))
  const baseline = Math.min(height, 6 + fontSize)
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><text x="${width - inset}" y="${baseline}" text-anchor="end" textLength="${textLength}" lengthAdjust="spacingAndGlyphs" font-family="Arial,sans-serif" font-size="${fontSize}" font-weight="700" fill="#17212b" stroke="#fff" stroke-width="5" stroke-linejoin="round" paint-order="stroke" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.35))">${escapeXml(label)}</text></svg>`)
  return { svg, width, height }
}

/**
 * `null` quando nenhum tile carregou (sem internet do lado do servidor ou
 * OSM fora do ar) — quem chamar deve cair pra mensagem de texto sem foto.
 */
export async function renderStaticMapPng(opts: {
  centerLat: number
  centerLon: number
  zoom?: number
  width?: number
  height?: number
  markers: MapMarker[]
}): Promise<Buffer | null> {
  const zoom = opts.zoom ?? 13
  const width = opts.width ?? 640
  const height = opts.height ?? 420

  const center = lonLatToTilePoint(opts.centerLat, opts.centerLon, zoom)
  const tilesX = Math.ceil(width / TILE_SIZE) + 2
  const tilesY = Math.ceil(height / TILE_SIZE) + 2
  const tileX0 = Math.floor(center.x - tilesX / 2)
  const tileY0 = Math.floor(center.y - tilesY / 2)

  const tiles = await Promise.all(
    Array.from({ length: tilesX * tilesY }, (_, i) => {
      const dx = i % tilesX
      const dy = Math.floor(i / tilesX)
      return fetchTile(zoom, tileX0 + dx, tileY0 + dy).then(buf => ({ dx, dy, buf }))
    }),
  )
  if (tiles.every(t => !t.buf)) return null

  const canvasW = tilesX * TILE_SIZE
  const canvasH = tilesY * TILE_SIZE
  const composite: OverlayOptions[] = []
  for (const t of tiles) {
    if (!t.buf) continue
    composite.push({ input: t.buf, left: t.dx * TILE_SIZE, top: t.dy * TILE_SIZE })
  }

  const PIN_W = 30, PIN_H = 30
  for (const m of opts.markers) {
    const p = lonLatToTilePoint(m.lat, m.lon, zoom)
    const px = Math.round((p.x - tileX0) * TILE_SIZE)
    const py = Math.round((p.y - tileY0) * TILE_SIZE)
    // Ponta do pino (base do SVG) alinhada com a coordenada real.
    const pinLeft = px - Math.round(PIN_W / 2)
    const pinTop = py - PIN_H
    // Marcador longe do centro (ex.: estação a 100km do pouso) cai fora do
    // canvas colado — sharp exige que o composite caiba inteiro dentro da
    // base, então só desenha o que couber. A distância/rumo continuam no
    // texto da mensagem de qualquer forma.
    if (pinLeft < 0 || pinTop < 0 || pinLeft + PIN_W > canvasW || pinTop + PIN_H > canvasH) continue
    composite.push({ input: pinSvg(m.color), left: pinLeft, top: pinTop })
  }

  const centerPx = Math.round((center.x - tileX0) * TILE_SIZE)
  const centerPy = Math.round((center.y - tileY0) * TILE_SIZE)
  const left = Math.max(0, Math.min(Math.round(centerPx - width / 2), canvasW - width))
  const top = Math.max(0, Math.min(Math.round(centerPy - height / 2), canvasH - height))
  // Avoid sending a partial image with gray squares after transient tile failures.
  const hasMissingVisibleTile = tiles.some(tile => {
    if (tile.buf) return false
    const tileX = tile.dx * TILE_SIZE
    const tileY = tile.dy * TILE_SIZE
    const overlapsCrop = tileX < left + width && tileX + TILE_SIZE > left &&
      tileY < top + height && tileY + TILE_SIZE > top
    const worldTileY = tileY0 + tile.dy
    return overlapsCrop && worldTileY >= 0 && worldTileY < 2 ** zoom
  })
  if (hasMissingVisibleTile) {
    console.warn('[staticMap] mapa incompleto; omitindo imagem apÃ³s falha ao carregar tiles')
    return null
  }

  try {
    const stitched = await sharp({
      create: { width: canvasW, height: canvasH, channels: 4, background: { r: 224, g: 224, b: 224, alpha: 1 } },
    }).composite(composite).png().toBuffer()

    const cropped = await sharp(stitched).extract({ left, top, width, height }).png().toBuffer()
    const locationLabel = opts.markers.find(marker => marker.label)?.label
    if (!locationLabel) return cropped

    const margin = 10
    const label = markerLabelSvg(locationLabel, width - margin * 2, height - margin * 2)
    return await sharp(cropped).composite([{
      input: label.svg,
      left: Math.max(0, width - label.width - margin),
      top: Math.max(0, height - label.height - margin),
    }]).png().toBuffer()
  } catch (e) {
    console.error('[staticMap] falhou:', e)
    return null
  }
}
