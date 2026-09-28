/**
 * Desenho dos REAPARECIMENTOS nos mapas (Leaflet), igual em todos eles:
 * painel, mapa do ano e mapa do lançamento.
 *
 * Cada reaparecimento é um alfinete violeta com ondas de rádio (nunca o
 * cilindro do payload, que significa pouso) ligado ao pouso original por uma
 * linha tracejada violeta. A linha é o ponto todo: sem ela o marcador pareceria
 * uma sonda solta em outro lugar. Ver reappearance.ts.
 *
 * Em zoom baixo, vários alfinetes de reaparecimento podem colidir no mesmo
 * pixel de tela — agrupados por `clusterByPixel`. Dois casos:
 *  - **Vai se separar com zoom** (grupo não degenerado): vira um badge
 *    violeta com contagem (nunca o badge neutro de pouso — a distinção de
 *    cor é proposital, ver markerClustering.ts/radiosondy.ts); clique
 *    aproxima o zoom.
 *  - **NUNCA vai se separar** (`isClusterDegenerate` — mesmo endereço físico,
 *    ex.: várias sondas diferentes recuperadas pela mesma pessoa): um badge
 *    escondendo a contagem seria o pior caso possível aqui, porque cada
 *    item é um EVENTO DISTINTO (sonda diferente, pouso original diferente,
 *    longe dali) — o próprio ponto do reaparecimento é a única pista de que
 *    aquele lugar reúne várias histórias. Em vez de um badge, abre um LEQUE:
 *    cada alfinete desenhado uns pixels ao redor do ponto real (nunca mais
 *    que ~20px, puramente visual), cada um com sua PRÓPRIA linha tracejada
 *    até o SEU pouso original — assim as N linhas ficam visíveis de cara,
 *    sem precisar clicar em nada. Acima de `FAN_MAX` itens (mais do que uns
 *    poucos casos realmente raros), o leque ficaria ilegível: cai de volta
 *    pro badge com popup concatenado (`clusterPopupHtml`).
 */
import { buildReappearanceIcon, buildClusterIcon, REAPPEAR_COLOR } from './radiosondy'
import { POPUP_OPTIONS, reappearancePopupHtml, clusterPopupHtml } from './mapPopups'
import { clusterByPixel, clusterBounds, isClusterDegenerate, type Clusterable } from './markerClustering'
import type { SondePoint } from './sondePoints'
import type { Reappearance } from './reappearance'
import { GMT3 } from './types'

const PIN_SIZE = 18
const REAPPEAR_CLUSTER_RADIUS_PX = 24
// Acima disto, um leque de alfinetes fica apertado demais pra ler — melhor
// um badge com popup concatenado (mesmo padrão de estações no mesmo lugar).
const FAN_MAX = 6

const pad = (n: number) => String(n).padStart(2, '0')

// dd/mm em GMT-3 — mesmo formato do rótulo dos demais marcadores do mapa.
function labelDate(iso: string): string | undefined {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return undefined
  const l = new Date(d.getTime() + GMT3)
  return `${pad(l.getUTCDate())}/${pad(l.getUTCMonth() + 1)}`
}

export interface ReappearanceLayerOptions {
  // Chamado ao clicar num reaparecimento (o mapa do lançamento usa pra focar
  // a sonda no cabeçalho, igual ao clique num pouso). Não dispara pra um
  // badge de cluster — aí o clique amplia o zoom (ou abre a lista, se o
  // grupo nunca for se separar e tiver itens demais pro leque).
  onClick?: (point: SondePoint) => void
  // Estende os limites do mapa com cada reaparecimento desenhado — só quem
  // enquadra o mapa pela primeira vez passa isto.
  bounds?: { extend: (latlng: [number, number]) => void }
}

interface Entry {
  point: SondePoint
  r: Reappearance
  index: number
  total: number
  lat: number
  lon: number
}

/**
 * Posições em leque ao redor de `center`, um pequeno raio FIXO EM PIXELS
 * (não em metros — é puramente visual, pra desgrudar pinos que na vida real
 * estão a poucos metros um do outro e por isso nunca se separariam com
 * zoom). Convertido de volta pra lat/lon no zoom atual via
 * `containerPointToLatLng`, então continua correto se o mapa for arrastado
 * ou o zoom mudar (o efeito de desenho roda de novo em `zoomend`).
 */
function fanOut(L: any, map: any, center: Clusterable, count: number): { lat: number; lon: number }[] {
  if (count <= 1) return [{ lat: center.lat, lon: center.lon }]
  const radiusPx = Math.max(16, count * 6)
  const origin = map.latLngToContainerPoint([center.lat, center.lon])
  const out: { lat: number; lon: number }[] = []
  for (let i = 0; i < count; i++) {
    const angle = (2 * Math.PI * i) / count - Math.PI / 2 // primeiro pino aponta pra cima
    const px = L.point(origin.x + radiusPx * Math.cos(angle), origin.y + radiusPx * Math.sin(angle))
    const ll = map.containerPointToLatLng(px)
    out.push({ lat: ll.lat, lon: ll.lng })
  }
  return out
}

function drawPin(L: any, layer: any, e: Entry, pos: { lat: number; lon: number }, onClick?: (p: SondePoint) => void) {
  // Linha do pouso ORIGINAL (não da posição em leque) até onde o pino está
  // desenhado — as duas pontas precisam bater com o que a tela mostra.
  L.polyline([[e.point.lat, e.point.lon], [pos.lat, pos.lon]], {
    color: REAPPEAR_COLOR, weight: 1.5, dashArray: '6 6', opacity: 0.75,
  }).addTo(layer).bindPopup(reappearancePopupHtml(e.point, e.r, e.index, e.total), POPUP_OPTIONS)
  const marker = L.marker([pos.lat, pos.lon], {
    icon: buildReappearanceIcon(L, PIN_SIZE, labelDate(e.r.at)),
    zIndexOffset: 500,
  }).addTo(layer).bindPopup(reappearancePopupHtml(e.point, e.r, e.index, e.total), POPUP_OPTIONS)
  if (onClick) marker.on('click', () => onClick(e.point))
}

/**
 * Desenha os reaparecimentos de todos os pontos da lista na camada dada.
 * Devolve quantos foram desenhados (os mapas usam pra decidir se a legenda
 * precisa da entrada "Reaparecimento").
 */
export function drawReappearances(
  L: any, map: any, layer: any, points: SondePoint[], opts: ReappearanceLayerOptions = {},
): number {
  // A mesma sonda pode chegar aqui duas vezes (o marcador em destaque e o de
  // contexto do mapa do lançamento, por exemplo): sem isto os alfinetes e as
  // linhas ficam empilhados, e o popup abre no de cima sem o usuário perceber
  // que há outro atrás.
  const visto = new Set<string>()
  const entries: Entry[] = []
  for (const p of points) {
    const list = p.reappearances
    if (!list?.length) continue
    for (let i = 0; i < list.length; i++) {
      const r = list[i]
      if (!Number.isFinite(r.lat) || !Number.isFinite(r.lon)) continue
      // Chave tolerante, igual à de mergeReappearances: o mesmo episódio chega
      // por dois caminhos com milissegundos e casas decimais diferentes
      // ("...:26Z" vs "...:26.000Z"), e comparar texto cru não colapsa nada.
      const minuto = Math.round(new Date(r.at).getTime() / 60_000)
      const chave = `${p.serial}|${minuto}|${r.lat.toFixed(3)},${r.lon.toFixed(3)}`
      if (visto.has(chave)) continue
      visto.add(chave)
      entries.push({ point: p, r, index: i, total: list.length, lat: r.lat, lon: r.lon })
      opts.bounds?.extend([r.lat, r.lon])
    }
  }

  for (const g of clusterByPixel(map, entries, REAPPEAR_CLUSTER_RADIUS_PX)) {
    if (g.items.length === 1) {
      drawPin(L, layer, g.items[0], g.items[0], opts.onClick)
      continue
    }
    if (isClusterDegenerate(g.anchor, g.items) && g.items.length <= FAN_MAX) {
      // Mesmo endereço físico, poucos itens: leque de pinos individuais em
      // vez de um badge — cada um com sua própria linha até o SEU pouso.
      const positions = fanOut(L, map, g.anchor, g.items.length)
      g.items.forEach((e, i) => drawPin(L, layer, e, positions[i], opts.onClick))
      continue
    }
    const marker = L.marker([g.anchor.lat, g.anchor.lon], {
      icon: buildClusterIcon(L, g.items.length, REAPPEAR_COLOR),
      zIndexOffset: 600,
    }).addTo(layer)
    if (isClusterDegenerate(g.anchor, g.items)) {
      // Degenerado mas itens demais pro leque ficar legível: cartões
      // concatenados, mesmo padrão de várias estações no mesmo lugar.
      marker.bindPopup(clusterPopupHtml(g.items.map(e => reappearancePopupHtml(e.point, e.r, e.index, e.total))), POPUP_OPTIONS)
    } else {
      marker.on('click', () => map.fitBounds(clusterBounds(L, g.items), { padding: [50, 50], maxZoom: map.getZoom() + 4 }))
    }
  }

  return entries.length
}

/** Quantos reaparecimentos há no conjunto (para rótulos e legendas). */
export function countReappearances(points: SondePoint[]): number {
  return points.reduce((n, p) => n + (p.reappearances?.length ?? 0), 0)
}
