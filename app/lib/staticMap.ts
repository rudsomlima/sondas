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
  const subdomain = 'abc'[Math.abs(x + y) % 3]
  const url = `https://${subdomain}.tile.openstreetmap.org/${z}/${xw}/${y}.png`
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
    if (!res.ok) return null
    return Buffer.from(await res.arrayBuffer())
  } catch {
    return null
  }
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

  try {
    const stitched = await sharp({
      create: { width: canvasW, height: canvasH, channels: 4, background: { r: 224, g: 224, b: 224, alpha: 1 } },
    }).composite(composite).png().toBuffer()

    return await sharp(stitched).extract({ left, top, width, height }).png().toBuffer()
  } catch (e) {
    console.error('[staticMap] falhou:', e)
    return null
  }
}
