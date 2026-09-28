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
 *    longe dali). Em vez de um badge — ou de vários alfinetes soltos, que
 *    ainda colidiam entre si e escondiam as datas uma atrás da outra —
 *    desenha um HUB: um ponto sólido violeta bem NO LOCAL real, de onde
 *    saem pequenas SETAS, uma pra cada data, espaçadas o bastante pra nunca
 *    se sobrepor. As linhas longas (tracejadas) de cada pouso original
 *    convergem todas no hub — geograficamente correto, já que os itens
 *    realmente reapareceram ali — em vez de em N posições artificiais
 *    levemente diferentes. Acima de `FAN_MAX` itens, o hub ficaria com setas
 *    demais pra ler: cai de volta pro badge com popup concatenado
 *    (`clusterPopupHtml`).
 */
import { buildReappearanceIcon, buildClusterIcon, REAPPEAR_COLOR } from './radiosondy'
import { POPUP_OPTIONS, reappearancePopupHtml, clusterPopupHtml } from './mapPopups'
import { clusterByPixel, clusterBounds, isClusterDegenerate, type Clusterable } from './markerClustering'
import type { SondePoint } from './sondePoints'
import type { Reappearance } from './reappearance'
import { GMT3 } from './types'

const PIN_SIZE = 18
const HUB_RADIUS_PX = 5
const REAPPEAR_CLUSTER_RADIUS_PX = 24
// Acima disto, o hub ficaria com setas grudadas umas nas outras — melhor um
// badge com popup concatenado (mesmo padrão de estações no mesmo lugar).
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
  // a sonda no cabeçalho, igual ao clique num pouso). Não dispara pro hub —
  // aí o clique abre a lista de todos; nem pra um badge de cluster — aí o
  // clique amplia o zoom (ou abre a lista, se o grupo tiver itens demais).
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

function drawSinglePin(L: any, layer: any, e: Entry, pos: Clusterable, onClick?: (p: SondePoint) => void) {
  L.polyline([[e.point.lat, e.point.lon], [pos.lat, pos.lon]], {
    color: REAPPEAR_COLOR, weight: 1.5, dashArray: '6 6', opacity: 0.75,
  }).addTo(layer).bindPopup(reappearancePopupHtml(e.point, e.r, e.index, e.total), POPUP_OPTIONS)
  const marker = L.marker([pos.lat, pos.lon], {
    icon: buildReappearanceIcon(L, PIN_SIZE, labelDate(e.r.at)),
    zIndexOffset: 500,
  }).addTo(layer).bindPopup(reappearancePopupHtml(e.point, e.r, e.index, e.total), POPUP_OPTIONS)
  if (onClick) marker.on('click', () => onClick(e.point))
}

// Seta curta e sólida: uma pequena ponta triangular rotacionada na direção
// hub→data, desenhada perto do hub (não perto do pino, onde ficaria escondida
// atrás do próprio ícone). `screenAngle` já está em graus prontos pra
// `rotate()` — mesma convenção de eixo usada pra posicionar as pontas
// (0° = direita, cresce em sentido horário, igual ao sistema de tela).
function arrowIcon(L: any, screenAngle: number) {
  return L.divIcon({
    html: `<div style="width:10px;height:10px;transform:rotate(${screenAngle}deg);transform-origin:center;filter:drop-shadow(0 1px 1px rgba(0,0,0,0.6));">` +
      `<svg viewBox="0 0 10 10" width="10" height="10"><polygon points="0,1 9,5 0,9" fill="${REAPPEAR_COLOR}"/></svg></div>`,
    className: '',
    iconSize: [10, 10],
    iconAnchor: [5, 5],
  })
}

/**
 * Hub + setas: um ponto sólido no local real (compartilhado pelo grupo todo)
 * com uma seta curta por item, apontando pra um pino com a data — espaçadas
 * o bastante (raio cresce com a contagem) pra nenhuma data encostar na
 * vizinha. As linhas longas (tracejadas) de cada pouso original convergem
 * todas no hub, não em posições artificiais diferentes.
 */
function drawFan(L: any, map: any, layer: any, g: { anchor: Clusterable; items: Entry[] }, onClick?: (p: SondePoint) => void) {
  const hub = g.anchor
  const n = g.items.length
  L.circleMarker([hub.lat, hub.lon], {
    radius: HUB_RADIUS_PX, color: REAPPEAR_COLOR, fillColor: REAPPEAR_COLOR, fillOpacity: 0.9, weight: 2,
  }).addTo(layer).bindPopup(
    clusterPopupHtml(g.items.map(e => reappearancePopupHtml(e.point, e.r, e.index, e.total))), POPUP_OPTIONS,
  )

  const hubPx = map.latLngToContainerPoint([hub.lat, hub.lon])
  // Raio cresce com a contagem: o espaço ao longo do arco entre duas setas
  // vizinhas (raio × ângulo entre elas) precisa passar da largura de um
  // pino+rótulo de data (~40px) pra elas nunca se tocarem.
  const radiusPx = Math.max(24, n * 8)

  g.items.forEach((e, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2 // primeira seta aponta pra cima
    const satPx = L.point(hubPx.x + radiusPx * Math.cos(angle), hubPx.y + radiusPx * Math.sin(angle))
    const satLL = map.containerPointToLatLng(satPx)
    const sat = { lat: satLL.lat, lon: satLL.lng }

    // Linha longa até o pouso original — sempre termina no HUB (posição
    // real), não na posição artificial da seta.
    L.polyline([[e.point.lat, e.point.lon], [hub.lat, hub.lon]], {
      color: REAPPEAR_COLOR, weight: 1.5, dashArray: '6 6', opacity: 0.65,
    }).addTo(layer).bindPopup(reappearancePopupHtml(e.point, e.r, e.index, e.total), POPUP_OPTIONS)

    // Talo curto (sólido, só visual) do hub até o pino desta data.
    L.polyline([[hub.lat, hub.lon], [sat.lat, sat.lon]], {
      color: REAPPEAR_COLOR, weight: 1.5, opacity: 0.9, interactive: false,
    }).addTo(layer)
    // Ponta da seta a 1/3 do caminho (perto do hub — na ponta do pino ela
    // ficaria atrás do próprio ícone), apontando pro pino.
    const arrowPx = L.point(hubPx.x + (satPx.x - hubPx.x) / 3, hubPx.y + (satPx.y - hubPx.y) / 3)
    const arrowLL = map.containerPointToLatLng(arrowPx)
    L.marker([arrowLL.lat, arrowLL.lng], {
      icon: arrowIcon(L, angle * 180 / Math.PI), interactive: false, zIndexOffset: 490,
    }).addTo(layer)

    const marker = L.marker([sat.lat, sat.lon], {
      icon: buildReappearanceIcon(L, PIN_SIZE, labelDate(e.r.at)),
      zIndexOffset: 500,
    }).addTo(layer).bindPopup(reappearancePopupHtml(e.point, e.r, e.index, e.total), POPUP_OPTIONS)
    if (onClick) marker.on('click', () => onClick(e.point))
  })
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
      drawSinglePin(L, layer, g.items[0], g.items[0], opts.onClick)
      continue
    }
    if (isClusterDegenerate(g.anchor, g.items) && g.items.length <= FAN_MAX) {
      drawFan(L, map, layer, g, opts.onClick)
      continue
    }
    const marker = L.marker([g.anchor.lat, g.anchor.lon], {
      icon: buildClusterIcon(L, g.items.length, REAPPEAR_COLOR),
      zIndexOffset: 600,
    }).addTo(layer)
    if (isClusterDegenerate(g.anchor, g.items)) {
      // Degenerado mas itens demais pro hub ficar legível: cartões
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
