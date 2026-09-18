/**
 * Diagnóstico de recepção do receptor do usuário em um voo: quanto do voo ele
 * ouviu **em cada faixa de ângulo de elevação**, comparado com as outras
 * estações que ouviram a mesma sonda.
 *
 * Por que por ângulo de elevação, e não por distância: a antena é que decide.
 * Uma ground plane vertical tem o ganho perto do horizonte e um **nulo no
 * zênite**; uma eggbeater/turnstile/QFH cobre justamente o alto. Caso real que
 * motivou este painel (PU7IOL, 17/09/2026, sonda W0521239 lançada a ~1,8 km):
 * até 60° de elevação ouviu 83% dos minutos, acima de 60° só 10% — e nos voos
 * dos dias anteriores, 100% abaixo de 15° e **zero** acima de 15°. Contagem de
 * pacotes sozinha não mostra isso; o ângulo mostra.
 *
 * Nota importante sobre a fonte: o SondeHub **deduplica** telemetria — cada
 * quadro fica atribuído a um único uploader (quem subiu primeiro). Por isso:
 *  - `frames` por estação é um limite INFERIOR do que ela realmente recebeu
 *    (e depende da corrida de upload);
 *  - a cobertura é medida por MINUTO (o minuto conta como ouvido se pelo menos
 *    um quadro dele foi atribuído a você), que é bem mais robusto: quem ouviu o
 *    minuto inteiro quase sempre ganha ao menos um dos ~60 quadros.
 *
 * Módulo puro: sem rede e sem browser.
 */

export interface RawSondeFrame {
  serial: string
  datetime: string
  lat: number
  lon: number
  alt: number
  rssi?: number
  snr?: number
  frequency?: number
  uploaderCallsign: string
  uploaderAntenna?: string
  softwareName?: string
  softwareVersion?: string
}

export interface ElevationBand {
  loDeg: number
  hiDeg: number
  minutesMine: number
  minutesTotal: number
  medianDistKm: number
  medianAltKm: number
}

export interface StationReception {
  callsign: string
  frames: number
  medianRssi: number | null
  maxAltM: number
  maxDistKm: number
  firstMs: number
  lastMs: number
  antenna?: string
  software?: string
}

export type ReceptionVerdict =
  | 'zenith-null'   // ouve embaixo, perde em cima → nulo de zênite (ground plane)
  | 'horizon-loss'  // ouve em cima, perde longe/baixo → obstrução/altura
  | 'weak-overall'  // perde nas duas pontas → antena/cabo/ruído
  | 'good'          // cobertura boa em tudo
  | 'no-data'       // sem quadros seus neste voo

export interface ReceptionReport {
  serial: string
  frequency?: number
  startMs: number
  endMs: number
  minutesTotal: number
  bands: ElevationBand[]
  mine: StationReception | null
  others: StationReception[]
  lowCoverage: number | null   // fração dos minutos até LOW_HIGH_SPLIT_DEG
  highCoverage: number | null  // fração dos minutos acima de LOW_HIGH_SPLIT_DEG
  // Teto/piso de elevação: até onde ouve bem, e de onde em diante perde. É o
  // resultado mais útil do relatório — um nulo de zênite aparece como teto
  // (ex.: ouve bem até 15°, nada acima), e horizonte obstruído como piso.
  ceilingDeg: number | null
  floorDeg: number | null
  verdict: ReceptionVerdict
}

// Faixas de elevação do relatório. As de cima (45-90°) são a região do nulo de
// uma ground plane vertical.
const BANDS: [number, number][] = [[0, 15], [15, 30], [30, 45], [45, 60], [60, 90]]
export const LOW_HIGH_SPLIT_DEG = 60
// Uma faixa com pouquíssimos minutos não sustenta diagnóstico (a sonda pode ter
// atravessado a faixa em segundos).
const MIN_BAND_MINUTES = 4
const GOOD_COVERAGE = 0.5
const POOR_COVERAGE = 0.35
const EARTH_R_M = 6371000

/**
 * Elevação (graus) de um ponto a `groundM` de distância no solo e `deltaAltM`
 * acima do receptor, descontando a curvatura da Terra (sem refração — o erro
 * é pequeno perto do zênite, que é o que este painel investiga).
 */
export function elevationDeg(groundM: number, deltaAltM: number): number {
  if (groundM <= 0) return 90
  const drop = (groundM * groundM) / (2 * EARTH_R_M)
  return Math.atan2(deltaAltM - drop, groundM) * 180 / Math.PI
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = (d: number) => d * Math.PI / 180
  const dLat = rad(lat2 - lat1)
  const dLon = rad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_R_M * Math.asin(Math.sqrt(a))
}

function sameCallsign(a: string, b: string): boolean {
  // O SondeHub aceita sufixos (PU7KZI-SDR-Studio) — o receptor do usuário é o
  // callsign exato, não os sufixos de outros softwares dele.
  return a.trim().toUpperCase() === b.trim().toUpperCase()
}

interface MinuteBucket {
  mine: boolean
  elevDeg: number
  distM: number
  altM: number
}

export function analyzeReception(
  frames: RawSondeFrame[], rxLat: number, rxLon: number, rxAltM: number, myCallsign: string,
): ReceptionReport | null {
  const valid = frames.filter(f =>
    typeof f.lat === 'number' && typeof f.lon === 'number' &&
    Number.isFinite(f.lat) && Number.isFinite(f.lon) && !!f.datetime)
  if (valid.length === 0) return null

  const byStation = new Map<string, RawSondeFrame[]>()
  const minutes = new Map<number, MinuteBucket>()
  let startMs = Infinity
  let endMs = -Infinity

  for (const f of valid) {
    const ms = new Date(f.datetime).getTime()
    if (!Number.isFinite(ms)) continue
    if (ms < startMs) startMs = ms
    if (ms > endMs) endMs = ms

    const callsign = f.uploaderCallsign || '?'
    const list = byStation.get(callsign)
    if (list) list.push(f); else byStation.set(callsign, [f])

    const distM = haversineM(rxLat, rxLon, f.lat, f.lon)
    const bucketKey = Math.floor(ms / 60000)
    const bucket = minutes.get(bucketKey)
    const mine = sameCallsign(callsign, myCallsign)
    // Um minuto tem ~60 quadros; guarda a geometria do último deles e marca o
    // minuto como "ouvido por mim" se qualquer quadro dele for meu.
    if (bucket) {
      bucket.mine = bucket.mine || mine
      bucket.elevDeg = elevationDeg(distM, (f.alt ?? 0) - rxAltM)
      bucket.distM = distM
      bucket.altM = f.alt ?? 0
    } else {
      minutes.set(bucketKey, {
        mine,
        elevDeg: elevationDeg(distM, (f.alt ?? 0) - rxAltM),
        distM,
        altM: f.alt ?? 0,
      })
    }
  }

  const buckets = [...minutes.values()]
  const bands: ElevationBand[] = []
  for (const [loDeg, hiDeg] of BANDS) {
    const inBand = buckets.filter(b => b.elevDeg >= loDeg && b.elevDeg < hiDeg)
    if (inBand.length === 0) continue
    bands.push({
      loDeg, hiDeg,
      minutesMine: inBand.filter(b => b.mine).length,
      minutesTotal: inBand.length,
      medianDistKm: (median(inBand.map(b => b.distM)) ?? 0) / 1000,
      medianAltKm: (median(inBand.map(b => b.altM)) ?? 0) / 1000,
    })
  }

  const summarize = (callsign: string, list: RawSondeFrame[]): StationReception => ({
    callsign,
    frames: list.length,
    medianRssi: median(list.map(f => f.rssi).filter((v): v is number => typeof v === 'number')),
    maxAltM: Math.max(...list.map(f => f.alt ?? 0)),
    maxDistKm: Math.max(...list.map(f => haversineM(rxLat, rxLon, f.lat, f.lon))) / 1000,
    firstMs: Math.min(...list.map(f => new Date(f.datetime).getTime())),
    lastMs: Math.max(...list.map(f => new Date(f.datetime).getTime())),
    antenna: list.find(f => f.uploaderAntenna)?.uploaderAntenna,
    software: list.find(f => f.softwareName)
      ? `${list.find(f => f.softwareName)!.softwareName} ${list.find(f => f.softwareVersion)?.softwareVersion ?? ''}`.trim()
      : undefined,
  })

  let mine: StationReception | null = null
  const others: StationReception[] = []
  for (const [callsign, list] of byStation) {
    const summary = summarize(callsign, list)
    if (sameCallsign(callsign, myCallsign)) mine = summary
    else others.push(summary)
  }
  others.sort((a, b) => b.frames - a.frames)

  const low = buckets.filter(b => b.elevDeg < LOW_HIGH_SPLIT_DEG)
  const high = buckets.filter(b => b.elevDeg >= LOW_HIGH_SPLIT_DEG)
  const lowCoverage = low.length > 0 ? low.filter(b => b.mine).length / low.length : null
  const highCoverage = high.length > 0 ? high.filter(b => b.mine).length / high.length : null

  return {
    serial: valid[0].serial,
    frequency: valid.find(f => typeof f.frequency === 'number')?.frequency,
    startMs, endMs,
    minutesTotal: buckets.length,
    bands,
    mine, others,
    lowCoverage, highCoverage,
    ...diagnose(mine, bands),
  }
}

/**
 * Onde a cobertura quebra. Usa as faixas em ordem crescente de elevação e
 * procura a última faixa bem ouvida: se tudo acima dela está ruim, é teto
 * (nulo de zênite); se tudo abaixo da primeira boa está ruim, é piso
 * (horizonte obstruído).
 *
 * Não usa um corte fixo em 60°: voos que derivam rápido nunca chegam a ângulos
 * altos, e um corte fixo classificava esses como "fraco em geral" quando o
 * padrão era claramente de teto (caso real: W3770327, 14/09/2026 — 95% até 15°
 * e zero em todas as faixas acima).
 */
function diagnose(mine: StationReception | null, bands: ElevationBand[]): {
  ceilingDeg: number | null; floorDeg: number | null; verdict: ReceptionVerdict
} {
  if (!mine) return { ceilingDeg: null, floorDeg: null, verdict: 'no-data' }
  const usable = bands.filter(b => b.minutesTotal >= MIN_BAND_MINUTES)
  if (usable.length === 0) return { ceilingDeg: null, floorDeg: null, verdict: 'weak-overall' }

  const coverage = (b: ElevationBand) => b.minutesMine / b.minutesTotal
  const goodIdx = usable.map((b, i) => coverage(b) >= GOOD_COVERAGE ? i : -1).filter(i => i >= 0)
  if (goodIdx.length === 0) return { ceilingDeg: null, floorDeg: null, verdict: 'weak-overall' }

  const firstGood = goodIdx[0]
  const lastGood = goodIdx[goodIdx.length - 1]
  const above = usable.slice(lastGood + 1)
  const below = usable.slice(0, firstGood)
  // Ponderado por minutos, e não "toda faixa acima é ruim": uma faixa logo
  // acima do teto costuma ficar no meio do caminho (caso real: W3770329,
  // 15/09/2026 — 64% até 15°, 47% em 15-30° e zero acima), e exigir que ela
  // também fosse ruim classificava o voo como "fraco em geral".
  const groupCoverage = (group: ElevationBand[]) => {
    const total = group.reduce((sum, b) => sum + b.minutesTotal, 0)
    if (total === 0) return 1
    return group.reduce((sum, b) => sum + b.minutesMine, 0) / total
  }
  const hasCeiling = above.length > 0 &&
    groupCoverage(above) <= POOR_COVERAGE && coverage(above[above.length - 1]) <= POOR_COVERAGE
  const hasFloor = below.length > 0 &&
    groupCoverage(below) <= POOR_COVERAGE && coverage(below[0]) <= POOR_COVERAGE
  const ceilingDeg = hasCeiling ? usable[lastGood].hiDeg : null
  const floorDeg = hasFloor ? usable[firstGood].loDeg : null

  // Perdeu nas duas pontas: manda quem custou mais minutos.
  const lostAbove = above.reduce((sum, b) => sum + (b.minutesTotal - b.minutesMine), 0)
  const lostBelow = below.reduce((sum, b) => sum + (b.minutesTotal - b.minutesMine), 0)
  if (hasCeiling && (!hasFloor || lostAbove >= lostBelow)) return { ceilingDeg, floorDeg, verdict: 'zenith-null' }
  if (hasFloor) return { ceilingDeg, floorDeg, verdict: 'horizon-loss' }
  if (usable.every(b => coverage(b) >= GOOD_COVERAGE)) return { ceilingDeg, floorDeg, verdict: 'good' }
  return { ceilingDeg, floorDeg, verdict: 'weak-overall' }
}

export const VERDICT_TEXT: Record<ReceptionVerdict, { title: string; detail: string }> = {
  'zenith-null': {
    title: 'Perdendo a sonda quando ela passa alto',
    detail: 'A cobertura cai justamente nos ângulos altos — assinatura do nulo de zênite de uma ' +
      'antena vertical (ground plane). Uma antena de cobertura hemisférica (eggbeater UHF, ' +
      'turnstile ou QFH) é o que muda esse quadro; a vertical continua boa pros voos que ' +
      'derivam longe e baixo.',
  },
  'horizon-loss': {
    title: 'Perdendo a sonda quando ela está baixa ou distante',
    detail: 'A cobertura alta está boa e a baixa não — típico de horizonte obstruído (prédio, ' +
      'morro, vegetação) ou antena muito baixa. Ganhar altura ou liberar a direção do lançamento ' +
      'é o que ajuda aqui.',
  },
  'weak-overall': {
    title: 'Cobertura fraca em todos os ângulos',
    detail: 'Não é geometria: a perda é parecida em todas as elevações. Olhe o caminho do sinal — ' +
      'conector, cabo (RG58 em 400 MHz perde bastante), casamento da antena — e o ruído local na ' +
      'faixa de 400 MHz.',
  },
  good: {
    title: 'Cobertura boa em todos os ângulos',
    detail: 'Você acompanhou o voo tanto nos ângulos baixos quanto nos altos. Nada a corrigir ' +
      'nesta instalação.',
  },
  'no-data': {
    title: 'Nenhum quadro seu neste voo',
    detail: 'O SondeHub não tem nenhum quadro atribuído ao seu callsign nesta sonda: receptor ' +
      'desligado ou dormindo, frequência dela fora da lista, ou (bem menos provável num voo ' +
      'inteiro) outra estação subiu todos os quadros antes do seu.',
  },
}
