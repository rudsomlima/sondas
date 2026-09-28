/**
 * Desenho dos REAPARECIMENTOS nos mapas (Leaflet), igual em todos eles:
 * painel, mapa do ano e mapa do lançamento.
 *
 * Cada reaparecimento é um alfinete violeta com ondas de rádio (nunca o
 * cilindro do payload, que significa pouso) ligado ao pouso original por uma
 * linha tracejada violeta. A linha é o ponto todo: sem ela o marcador pareceria
 * uma sonda solta em outro lugar. Ver reappearance.ts.
 */
import { buildReappearanceIcon, REAPPEAR_COLOR } from './radiosondy'
import { POPUP_OPTIONS, reappearancePopupHtml } from './mapPopups'
import type { SondePoint } from './sondePoints'
import { GMT3 } from './types'

const PIN_SIZE = 18

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
  // a sonda no cabeçalho, igual ao clique num pouso).
  onClick?: (point: SondePoint) => void
  // Estende os limites do mapa com cada reaparecimento desenhado — só quem
  // enquadra o mapa pela primeira vez passa isto.
  bounds?: { extend: (latlng: [number, number]) => void }
}

/**
 * Desenha os reaparecimentos de todos os pontos da lista na camada dada.
 * Devolve quantos foram desenhados (os mapas usam pra decidir se a legenda
 * precisa da entrada "Reaparecimento").
 */
export function drawReappearances(
  L: any, layer: any, points: SondePoint[], opts: ReappearanceLayerOptions = {},
): number {
  let drawn = 0
  // A mesma sonda pode chegar aqui duas vezes (o marcador em destaque e o de
  // contexto do mapa do lançamento, por exemplo): sem isto os alfinetes e as
  // linhas ficam empilhados, e o popup abre no de cima sem o usuário perceber
  // que há outro atrás.
  const visto = new Set<string>()
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
      // Tracejado do pouso até aqui — desenhado antes, pra ficar sob o pino.
      L.polyline([[p.lat, p.lon], [r.lat, r.lon]], {
        color: REAPPEAR_COLOR, weight: 1.5, dashArray: '6 6', opacity: 0.75,
      }).addTo(layer).bindPopup(reappearancePopupHtml(p, r, i, list.length), POPUP_OPTIONS)
      const marker = L.marker([r.lat, r.lon], {
        icon: buildReappearanceIcon(L, PIN_SIZE, labelDate(r.at)),
        zIndexOffset: 500,
      }).addTo(layer).bindPopup(reappearancePopupHtml(p, r, i, list.length), POPUP_OPTIONS)
      if (opts.onClick) marker.on('click', () => opts.onClick!(p))
      opts.bounds?.extend([r.lat, r.lon])
      drawn++
    }
  }
  return drawn
}

/** Quantos reaparecimentos há no conjunto (para rótulos e legendas). */
export function countReappearances(points: SondePoint[]): number {
  return points.reduce((n, p) => n + (p.reappearances?.length ?? 0), 0)
}
