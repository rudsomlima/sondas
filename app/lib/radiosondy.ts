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

const STARTPLACE = 'Barreira do Inferno Launch Center (BR)'

export function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

export function externalRadiosondyUrl(year: number, month: number): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const params = new URLSearchParams({
    kml: '1',
    search_limit: '1000',
    startplace: STARTPLACE,
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

export async function fetchRadiosondyFeatures(year: number, month: number): Promise<RadiosondyFeature[]> {
  const pad = (n: number) => String(n).padStart(2, '0')
  const url = `https://radiosondy.info/export/export_search.php?kml=1&search_limit=1000&startplace=${encodeURIComponent(STARTPLACE)}&date_from=${year}-${pad(month)}-01&date_to=${year}-${pad(month)}-${pad(lastDayOfMonth(year, month))}`

  const res = await fetch(url)
  if (!res.ok) throw new Error(`Erro ${res.status} ao consultar radiosondy.info`)
  const geojson = await res.json()

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

// Encontra a posição cujo horário é o mais próximo IMEDIATAMENTE DEPOIS do lançamento
export function findClosestAfter(
  features: RadiosondyFeature[], launch: Date
): { feature: RadiosondyFeature; approx: boolean } | null {
  let best: RadiosondyFeature | null = null
  let bestDiff = Infinity
  for (const f of features) {
    const diff = f.date.getTime() - launch.getTime()
    if (diff >= 0 && diff < bestDiff) {
      bestDiff = diff
      best = f
    }
  }
  if (best) return { feature: best, approx: false }

  // Nenhuma posição depois do horário: cai para a mais próxima (antes ou depois)
  let bestAbs: RadiosondyFeature | null = null
  let bestAbsDiff = Infinity
  for (const f of features) {
    const diff = Math.abs(f.date.getTime() - launch.getTime())
    if (diff < bestAbsDiff) {
      bestAbsDiff = diff
      bestAbs = f
    }
  }
  return bestAbs ? { feature: bestAbs, approx: true } : null
}

// Azul/vermelho/amarelo: o verde original se confundia com áreas verdes do mapa
export function statusColor(status: string): string {
  if (status === 'FOUND' || status === 'startIcon') return '#3b82f6'
  if (status === 'LOST' || status === 'endIcon') return '#ef4444'
  return '#eab308'
}

export const LEGEND_ITEMS: { label: string; color: string }[] = [
  { label: 'Encontrada', color: statusColor('FOUND') },
  { label: 'Perdida', color: statusColor('LOST') },
  { label: 'Desconhecida', color: statusColor('UNKNOWN') },
]

function adjustColor(hex: string, amt: number): string {
  let col = hex.replace('#', '')
  if (col.length === 3) col = col.split('').map(c => c + c).join('')
  const num = parseInt(col, 16)
  const r = Math.min(255, Math.max(0, (num >> 16) + amt))
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amt))
  const b = Math.min(255, Math.max(0, (num & 0xff) + amt))
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

let balloonIconCounter = 0

// SVG do balão no modelo do emoji 🎈 (corpo arredondado com brilho e sombra,
// nó e cordinha), só recolorido na cor do status — sem círculo de fundo
function balloonSvgMarkup(color: string, widthPx: number, heightPx: number): string {
  const gradId = `balloon-grad-${balloonIconCounter++}`
  const light = adjustColor(color, 50)
  const dark = adjustColor(color, -40)
  return `
    <svg width="${widthPx}" height="${heightPx}" viewBox="0 0 36 52" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 1px 3px rgba(0,0,0,0.6))">
      <defs>
        <radialGradient id="${gradId}" cx="34%" cy="28%" r="75%">
          <stop offset="0%" stop-color="${light}"/>
          <stop offset="100%" stop-color="${color}"/>
        </radialGradient>
      </defs>
      <path d="M18,2 C27.5,2 33.5,11 33.5,20 C33.5,29.5 26.5,36.5 18,36.5 C9.5,36.5 2.5,29.5 2.5,20 C2.5,11 8.5,2 18,2 Z"
            fill="url(#${gradId})" stroke="${dark}" stroke-width="0.6"/>
      <ellipse cx="12.5" cy="12.5" rx="5" ry="7" fill="#fff" opacity="0.3" transform="rotate(-20 12.5 12.5)"/>
      <path d="M14.5,36 L18,41.5 L21.5,36 Z" fill="${dark}"/>
      <path d="M18,41.5 C16,44 20,46.5 18,49.5" stroke="${dark}" stroke-width="1.3" fill="none" stroke-linecap="round"/>
    </svg>`
}

export function buildBalloonIcon(L: any, color: string, widthPx: number) {
  const heightPx = Math.round(widthPx * 1.55)
  const svg = balloonSvgMarkup(color, widthPx, heightPx)
  return L.divIcon({
    html: svg,
    className: '',
    iconSize: [widthPx, heightPx],
    iconAnchor: [widthPx / 2, heightPx - 1],
  })
}

// Mesmo tamanho dos demais balões, mas com um brilho pulsante (radar) por trás
// para destacar a posição mais próxima do lançamento sem distorcer o layout
export function buildHighlightBalloonIcon(L: any, color: string, widthPx: number) {
  const heightPx = Math.round(widthPx * 1.55)
  const svg = balloonSvgMarkup(color, widthPx, heightPx)
  const glowSize = Math.round(widthPx * 1.9)
  const glowTop = Math.round(heightPx * 0.38 - glowSize / 2)
  const glowLeft = Math.round(widthPx / 2 - glowSize / 2)
  const html = `
    <div style="position:relative;width:${widthPx}px;height:${heightPx}px;">
      <div class="radar-pulse-ring" style="position:absolute;left:${glowLeft}px;top:${glowTop}px;width:${glowSize}px;height:${glowSize}px;border-radius:50%;background:${color};"></div>
      ${svg}
    </div>`
  return L.divIcon({
    html,
    className: '',
    iconSize: [widthPx, heightPx],
    iconAnchor: [widthPx / 2, heightPx - 1],
  })
}
