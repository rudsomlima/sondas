/**
 * Desenho das estações receptoras nos mapas (Leaflet): o mesmo ícone de
 * antena usado pro "meu receptor", com o callsign embaixo — vermelho pro
 * receptor do usuário, verde-água pros demais. Só aparecem as estações que
 * receberam alguma sonda do mapa (ver receptorsFromPoints).
 */
import type { ReceiverStation } from './receiverStations'
import { stationKey } from './receiverStations'
import type { SondePoint } from './sondePoints'
import { esc, POPUP_OPTIONS, stationPopupHtml } from './mapPopups'
import { STATUS_COLORS } from './tokens'
import { clusterByPixel } from './markerClustering'

export const MY_STATION_COLOR = STATUS_COLORS.lost // vermelho, igual ao marcador de antes
export const OTHER_STATION_COLOR = '#2dd4bf'

export function antennaIconMarkup(label: string, sizePx: number, color: string): string {
  return `
    <div style="display:flex;flex-direction:column;align-items:center;">
      <svg width="${sizePx}" height="${sizePx}" viewBox="0 0 24 24"
        fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
        style="filter:drop-shadow(0 1px 2px rgba(0,0,0,0.9));">
        <path d="M2 12 7 2"/><path d="m7 12 5-10"/><path d="m12 12 5-10"/><path d="m17 12 5-10"/>
        <path d="M4.5 7h15"/><path d="M12 16v6"/>
      </svg>
      <div style="margin-top:2px;background:rgba(0,0,0,0.75);border:1px solid ${color}88;border-radius:4px;padding:1px 5px;white-space:nowrap;">
        <span style="color:#fff;font-size:10px;font-family:monospace;font-weight:700;">${esc(label)}</span>
      </div>
    </div>`
}

/** Quantas sondas do conjunto cada estação recebeu (chave: callsign em maiúsculas). */
export function receptorsFromPoints(points: SondePoint[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const p of points) {
    const calls = new Set<string>()
    for (const r of p.receivers ?? []) calls.add(stationKey(r))
    if (p.lastReceiver) calls.add(stationKey(p.lastReceiver))
    for (const c of calls) out.set(c, (out.get(c) ?? 0) + 1)
  }
  return out
}

// Maior que o de sondas: o rótulo de uma estação é TEXTO ("PU7KZI-SDR-Studio
// +4"), bem mais largo que o ícone de antena em si (24px) — um raio do
// tamanho do ícone deixava rótulos vizinhos colidindo mesmo com os pontos-
// -âncora tecnicamente "sem sobrepor".
const STATION_CLUSTER_RADIUS_PX = 55

interface StationItem {
  st: ReceiverStation
  isMine: boolean
  lat: number
  lon: number
}

/**
 * Desenha no `layer` (limpa antes) as estações de `counts` que têm posição
 * conhecida. Estações que ficam próximas demais pra este nível de zoom
 * (ex.: PU7KZI e PU7KZI-SDR-Studio, dois softwares na mesma casa — mas
 * também estações realmente distintas que só colidem em pixel quando o
 * zoom está baixo) viram um marcador só, com os popups empilhados.
 * Agrupamento por PIXEL de tela (`clusterByPixel`, ver markerClustering.ts),
 * não por distância geográfica fixa — resolve tanto o caso de mesma casa
 * quanto o de estações próximas que só colidem visualmente em zoom baixo.
 * `mine` = callsign do usuário, sempre desenhado (mesmo sem sonda no mapa)
 * quando há posição dele — em `mine.pos` ou na lista de estações.
 */
export function drawReceiverStations(
  L: any, map: any, layer: any,
  stations: Map<string, ReceiverStation>,
  counts: Map<string, number>,
  mine?: { callsign?: string | null; pos?: { lat: number; lon: number } | null },
) {
  layer.clearLayers()
  const myKey = mine?.callsign ? stationKey(mine.callsign) : ''
  const list: StationItem[] = []
  for (const key of counts.keys()) {
    const st = stations.get(key)
    if (st) list.push({ st, isMine: key === myKey, lat: st.lat, lon: st.lon })
  }
  if (myKey && !list.some(x => x.isMine)) {
    const st = stations.get(myKey)
    if (st) list.push({ st, isMine: true, lat: st.lat, lon: st.lon })
    else if (mine?.pos) {
      const st2: ReceiverStation = { callsign: mine.callsign!, lat: mine.pos.lat, lon: mine.pos.lon, sources: [], updatedAt: 0 }
      list.push({ st: st2, isMine: true, lat: st2.lat, lon: st2.lon })
    }
  }

  // Ordena ANTES de agrupar: quem entra primeiro num grupo vira a âncora
  // (mesma prioridade de antes — meu receptor, depois maior contagem).
  list.sort((a, b) => Number(b.isMine) - Number(a.isMine) || (counts.get(stationKey(b.st.callsign)) ?? 0) - (counts.get(stationKey(a.st.callsign)) ?? 0))

  const size = 24
  for (const g of clusterByPixel(map, list, STATION_CLUSTER_RADIUS_PX)) {
    const head = g.anchor
    const color = head.isMine ? MY_STATION_COLOR : OTHER_STATION_COLOR
    const label = g.items.length > 1 ? `${head.st.callsign} +${g.items.length - 1}` : head.st.callsign
    const html = g.items.map(({ st, isMine }) => stationPopupHtml(st, { mine: isMine, sondes: counts.get(stationKey(st.callsign)) })).join('')
    L.marker([head.st.lat, head.st.lon], {
      icon: L.divIcon({
        html: antennaIconMarkup(label, size, color),
        className: '',
        iconSize: [Math.max(size, label.length * 6.5), size + 16],
        iconAnchor: [Math.max(size, label.length * 6.5) / 2, size - 1],
      }),
      zIndexOffset: head.isMine ? 900 : 500,
    }).addTo(layer).bindPopup(html, POPUP_OPTIONS)
  }
}
