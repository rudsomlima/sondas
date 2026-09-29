/**
 * Agrupamento de marcadores por DISTÂNCIA EM PIXELS na tela, não em graus de
 * lat/lon fixos. Existe porque em zoom baixo, pontos a 2-3 km um do outro
 * ocupam poucos pixels de tela e ficam sobrepostos/ilegíveis — um raio fixo
 * em metros nunca resolve isso pra todo nível de zoom ao mesmo tempo
 * (pequeno demais no zoom baixo, grande demais no zoom alto).
 *
 * Único fator que importa pra decidir "isto se sobrepõe visualmente": a
 * posição em pixels de tela, `map.latLngToContainerPoint`. E só o ZOOM muda
 * essa distância — arrastar o mapa (pan) é uma translação, a distância em
 * pixels entre dois lat/lon fixos não muda. Por isso só `zoomend` precisa
 * disparar um redesenho; não é preciso ouvir `moveend`.
 *
 * Módulo puro (sem React): recebe `L`/`map` como parâmetro, mesmo padrão de
 * `receiverStationsLayer.ts` e dos demais `*Layer.ts`.
 */
import { haversineKm } from './geo'

export interface Clusterable {
  lat: number
  lon: number
}

export interface ClusterGroup<T extends Clusterable> {
  anchor: T // primeiro item do grupo — quem chama já pode pré-ordenar por prioridade
  items: T[]
}

/**
 * Agrupa pontos por proximidade em pixels de tela no zoom atual do `map` —
 * TRANSITIVO (union-find/single-linkage): se A está a menos de `radiusPx` de
 * B, e B está a menos de `radiusPx` de C, os três caem no mesmo grupo, mesmo
 * que A e C estejam longe um do outro. Isso importa de verdade: uma primeira
 * versão gulosa (abrir um grupo a partir de um ponto e só puxar pra dentro
 * quem está perto DELE) deixava cadeias de pontos próximos viradas em vários
 * grupos pequenos ADJACENTES — os badges resultantes continuavam grudados uns
 * nos outros, o mesmo problema de sobreposição só que com badges no lugar de
 * balões. Union-find resolve isso numa passagem só, sem precisar reagrupar
 * os próprios badges depois.
 *
 * O(n²) pra montar as arestas — de sobra pro volume deste app (no máximo
 * ~300 pontos por mapa).
 *
 * `enabled=false` (Configurações → Exibição, sondas pousadas — ver
 * mapDisplaySettings.ts) faz um "grupo" por ponto, sem nenhum cálculo de
 * distância: mesma forma de devolver, mesmo código de desenho rio abaixo
 * (o `items.length === 1` de sempre), só que nunca funde nada.
 */
export function clusterByPixel<T extends Clusterable>(
  map: any, points: T[], radiusPx: number, enabled = true,
): ClusterGroup<T>[] {
  if (!enabled) return points.map(p => ({ anchor: p, items: [p] }))
  const n = points.length
  const px = points.map(p => map.latLngToContainerPoint([p.lat, p.lon]))
  const parent = Array.from({ length: n }, (_, i) => i)
  function find(i: number): number {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i] }
    return i
  }
  const r2 = radiusPx * radiusPx
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = px[i].x - px[j].x, dy = px[i].y - px[j].y
      if (dx * dx + dy * dy <= r2) {
        const ri = find(i), rj = find(j)
        if (ri !== rj) parent[ri] = rj
      }
    }
  }
  // Agrupa por raiz, na ordem original — o primeiro índice de cada grupo
  // (o de MENOR i, já que i cresce e a raiz de cada grupo já está resolvida)
  // vira o "anchor", preservando a prioridade que quem chama já ordenou
  // (mesmo truque que `receiverStationsLayer.ts` fazia com isMine/contagem).
  const byRoot = new Map<number, number[]>()
  for (let i = 0; i < n; i++) {
    const root = find(i)
    const list = byRoot.get(root)
    if (list) list.push(i); else byRoot.set(root, [i])
  }
  return [...byRoot.values()].map(idxs => ({
    anchor: points[idxs[0]],
    items: idxs.map(i => points[i]),
  }))
}

/** Limites geográficos de um grupo, a partir dos lat/lon dos membros. */
export function clusterBounds(L: any, items: Clusterable[]): any {
  return L.latLngBounds(items.map(p => [p.lat, p.lon]))
}

// Abaixo disto, dois pontos nunca vão se separar visualmente por mais que se
// aproxime o zoom — é a mesma sonda recuperada por quem mora ali do lado, ou
// uma coincidência real de endereço (caso visto: várias sondas recolhidas
// pela mesma pessoa, mesma casa).
const DEGENERATE_RADIUS_KM = 0.015 // 15 m

/**
 * Um grupo é "degenerado" quando aproximar o zoom nunca vai separar os
 * marcadores — zoom-to-bounds ficaria girando em torno do mesmo ponto pra
 * sempre. Mede a maior distância real (haversine) entre o âncora e os
 * demais membros, não a extensão em pixels (que depende do zoom).
 */
export function isClusterDegenerate(anchor: Clusterable, items: Clusterable[]): boolean {
  return items.every(p => haversineKm(anchor.lat, anchor.lon, p.lat, p.lon) <= DEGENERATE_RADIUS_KM)
}
