/**
 * Reaparecimentos: a MESMA sonda reportada de novo, depois do voo, em outro
 * lugar.
 *
 * Por quê: uma sonda recuperada é levada pra casa de quem achou e às vezes
 * religada — ou outra pessoa a reporta de outro lugar dias depois. O serial é
 * o mesmo, então toda a pilha de dados (registro no R2, pontos dos mapas,
 * sondas de hoje) tratava o reporte novo como se fosse o voo: o pouso original
 * era sobrescrito, a sonda pulava de mês no histórico e aparecia como
 * "pousada hoje" no painel. Caso real: X2932841, lançada em 09/09/2026 e
 * recuperada, reportada de novo em 26/09/2026.
 *
 * Regra desta casa: o POUSO ORIGINAL é a posição e a data da sonda em todo o
 * app; cada reporte posterior e distante vira um `Reappearance` à parte,
 * marcado de forma própria e sempre ligado ao pouso de onde veio. Nada é
 * descartado e nada é confundido com um pouso novo.
 *
 * Módulo puro: só geometria e datas, sem rede e sem browser.
 */
import { bearingDeg, haversineKm } from './geo'

/**
 * Intervalo sem nenhum quadro que encerra o voo. Um voo real dura ~2-3,5 h de
 * ponta a ponta e seus quadros são contínuos; 2 h de silêncio significa que o
 * que vem depois é outro episódio da vida da sonda, não o mesmo voo.
 *
 * Mesma constante que já separava o "trecho principal do voo" nas fontes
 * (mainFlightSegment, sondeSources.ts) — agora ela decide as duas coisas, pra
 * o que os mapas mostram bater com o que o registro guarda.
 */
export const REAPPEAR_GAP_MS = 2 * 3600_000

/**
 * Distância mínima do pouso pra valer como reaparecimento. Sonda que não foi
 * recuperada e segue transmitindo do chão, no mesmo lugar, por dias não é
 * reaparecimento — é o mesmo pouso ainda dando sinal, e continua atualizando
 * a posição normalmente.
 */
export const REAPPEAR_MIN_KM = 1

/** Um reporte da sonda posterior e distante do pouso original. */
export interface Reappearance {
  lat: number
  lon: number
  alt?: number
  at: string // ISO UTC — instante do reporte
  receiver?: string // quem recebeu/subiu o quadro
  frames?: number // quantos quadros nesse episódio
  // Do pouso original até aqui — recalculados sempre que o pouso é conhecido
  // (ver withLanding), nunca lidos como verdade de um registro antigo.
  distanceKm?: number
  bearingDeg?: number
}

export interface LandingRef {
  lat: number
  lon: number
  at?: string
}

function ms(iso: string | undefined | null): number {
  if (!iso) return NaN
  return new Date(iso).getTime()
}

/**
 * `report` é um reaparecimento em relação a `landing`? Precisa das duas
 * coisas: tempo (passou o intervalo que encerra o voo) e distância (é outro
 * lugar). Sem data em qualquer um dos lados, não há como afirmar — e o app
 * segue com o comportamento antigo, tratando como o mesmo voo.
 */
export function isReappearanceOf(landing: LandingRef, report: LandingRef): boolean {
  const a = ms(landing.at), b = ms(report.at)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false
  if (b - a <= REAPPEAR_GAP_MS) return false
  return haversineKm(landing.lat, landing.lon, report.lat, report.lon) > REAPPEAR_MIN_KM
}

/** Reporte solto → Reappearance, já com distância/rumo do pouso. */
export function reappearanceFrom(landing: LandingRef | undefined, r: Omit<Reappearance, 'distanceKm' | 'bearingDeg'>): Reappearance {
  if (!landing) return { ...r }
  return {
    ...r,
    distanceKm: Math.round(haversineKm(landing.lat, landing.lon, r.lat, r.lon) * 10) / 10,
    bearingDeg: Math.round(bearingDeg(landing.lat, landing.lon, r.lat, r.lon)),
  }
}

// Dois reportes do mesmo episódio: mesmo instante (ao minuto) e mesmo lugar.
// Fontes diferentes arredondam segundos e coordenadas de formas diferentes.
function sameEpisode(a: Reappearance, b: Reappearance): boolean {
  return Math.abs(ms(a.at) - ms(b.at)) < 60_000 &&
    Math.abs(a.lat - b.lat) < 0.001 && Math.abs(a.lon - b.lon) < 0.001
}

/**
 * União de duas listas de reaparecimentos, sem duplicar o mesmo episódio
 * visto por duas fontes (fica o que tem mais informação) e em ordem
 * cronológica.
 */
export function mergeReappearances(a?: Reappearance[], b?: Reappearance[]): Reappearance[] | undefined {
  if (!a?.length && !b?.length) return undefined
  const out: Reappearance[] = []
  for (const r of [...(a ?? []), ...(b ?? [])]) {
    if (!Number.isFinite(ms(r.at))) continue
    const i = out.findIndex(x => sameEpisode(x, r))
    if (i < 0) { out.push({ ...r }); continue }
    out[i] = {
      ...out[i],
      alt: out[i].alt ?? r.alt,
      receiver: out[i].receiver ?? r.receiver,
      frames: Math.max(out[i].frames ?? 0, r.frames ?? 0) || undefined,
    }
  }
  return out.length ? out.sort((x, y) => ms(x.at) - ms(y.at)) : undefined
}

/**
 * Recalcula distância/rumo de cada reaparecimento a partir do pouso atual e
 * descarta os que, com este pouso, não são reaparecimento nenhum (o pouso
 * pode ter mudado desde que a lista foi gravada — ex.: o relato de
 * recuperação chegou depois e moveu a posição).
 */
export function withLanding(landing: LandingRef | undefined, list?: Reappearance[]): Reappearance[] | undefined {
  if (!list?.length) return undefined
  if (!landing) return list
  const out = list
    .filter(r => isReappearanceOf(landing, r))
    .map(r => reappearanceFrom(landing, r))
  return out.length ? out : undefined
}

/**
 * Das duas posições conhecidas de uma sonda, qual é o pouso e qual é
 * reaparecimento. Serve pra mesclas (registro do R2, pontos dos mapas) onde
 * as duas cópias podem estar em qualquer ordem — inclusive com a cópia velha
 * já contaminada por um reaparecimento gravado como pouso antes desta regra
 * existir.
 */
export function splitLanding<T extends LandingRef>(x: T, y: T): { landing: T; reappeared: T | null } {
  const [early, late] = ms(x.at) <= ms(y.at) ? [x, y] : [y, x]
  return isReappearanceOf(early, late) ? { landing: early, reappeared: late } : { landing: late, reappeared: null }
}

// ---------------------------------------------------------------------------
// Texto (usado por popups, badges e mensagens — um só jeito de falar disso)

export const REAPPEAR_LABEL = 'Reaparecimento'

export function reappearanceCountLabel(n: number): string {
  return n === 1 ? '1 reaparecimento' : `${n} reaparecimentos`
}
