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
 * pixel de tela — agrupados por `clusterByPixel`, viram um badge violeta com
 * contagem (nunca o badge neutro de pouso, ver markerClustering.ts/
 * radiosondy.ts: a distinção de cor é proposital e não pode se perder no
 * agrupamento). As linhas tracejadas continuam sendo desenhadas uma a uma,
 * do pouso original até o ponto — só o PINO de chegada é que se funde.
 */
import { buildReappearanceIcon, buildClusterIcon, REAPPEAR_COLOR } from './radiosondy'
import { POPUP_OPTIONS, reappearancePopupHtml, clusterPopupHtml } from './mapPopups'
import { clusterByPixel, clusterBounds, isClusterDegenerate } from './markerClustering'
import type { SondePoint } from './sondePoints'
import type { Reappearance } from './reappearance'
import { GMT3 } from './types'

const PIN_SIZE = 18
const REAPPEAR_CLUSTER_RADIUS_PX = 24

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
  // grupo nunca for se separar).
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
    }
  }

  // Tracejado do pouso até aqui — um por entrada, sempre desenhado (mesmo
  // quando o pino de chegada vira um cluster: mostra de onde cada um veio).
  for (const e of entries) {
    L.polyline([[e.point.lat, e.point.lon], [e.lat, e.lon]], {
      color: REAPPEAR_COLOR, weight: 1.5, dashArray: '6 6', opacity: 0.75,
    }).addTo(layer).bindPopup(reappearancePopupHtml(e.point, e.r, e.index, e.total), POPUP_OPTIONS)
    opts.bounds?.extend([e.lat, e.lon])
  }

  for (const g of clusterByPixel(map, entries, REAPPEAR_CLUSTER_RADIUS_PX)) {
    if (g.items.length === 1) {
      const e = g.items[0]
      const marker = L.marker([e.lat, e.lon], {
        icon: buildReappearanceIcon(L, PIN_SIZE, labelDate(e.r.at)),
        zIndexOffset: 500,
      }).addTo(layer).bindPopup(reappearancePopupHtml(e.point, e.r, e.index, e.total), POPUP_OPTIONS)
      if (opts.onClick) marker.on('click', () => opts.onClick!(e.point))
      continue
    }
    const marker = L.marker([g.anchor.lat, g.anchor.lon], {
      icon: buildClusterIcon(L, g.items.length, REAPPEAR_COLOR),
      zIndexOffset: 600,
    }).addTo(layer)
    if (isClusterDegenerate(g.anchor, g.items)) {
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
