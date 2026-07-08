/**
 * Reconciliação multi-fonte: quais fontes confirmam cada lançamento e o nível
 * de confiança resultante. Funciona com o YearStore atual (heurística) e usa
 * o campo opcional `Launch.sources` (gravado pelo cron) quando presente.
 */
import type { Launch } from './types'

export type SourceState = 'confirmed' | 'absent' | 'pending'

export interface LaunchConfidence {
  wyoming: SourceState
  radiosondy: SourceState
  sondehub: SourceState
  level: 'high' | 'medium' | 'low'
  notes: string[]
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export function computeConfidence(l: Launch, wyomingSupported = true): LaunchConfidence {
  const ageMs = Date.now() - new Date(`${l.date}T12:00:00Z`).getTime()
  const isRecent = ageMs < SEVEN_DAYS_MS
  const notes: string[] = []

  // Wyoming: registro sem `source` veio dela; com `source`, ela não publicou (ainda).
  let wyoming: SourceState
  if (l.sources?.wyoming !== undefined) {
    wyoming = l.sources.wyoming ? 'confirmed' : (isRecent && wyomingSupported ? 'pending' : 'absent')
  } else if (!l.source) {
    wyoming = 'confirmed'
  } else if (wyomingSupported && isRecent) {
    wyoming = 'pending'
    notes.push('Wyoming ainda não publicou este lançamento (atraso normal).')
  } else {
    wyoming = 'absent'
    if (!wyomingSupported) notes.push('Estação sem cobertura na Wyoming.')
  }

  // radiosondy.info
  let radiosondy: SourceState
  if (l.sources?.radiosondy !== undefined) {
    radiosondy = l.sources.radiosondy ? 'confirmed' : (isRecent ? 'pending' : 'absent')
  } else if (l.radiosondyMatch === 'yes' || l.source === 'radiosondy') {
    radiosondy = 'confirmed'
  } else if (l.radiosondyMatch === 'no') {
    radiosondy = 'absent'
  } else {
    radiosondy = 'pending'
  }

  // sondehub.org
  let sondehub: SourceState
  if (l.sources?.sondehub !== undefined) {
    sondehub = l.sources.sondehub ? 'confirmed' : (isRecent ? 'pending' : 'absent')
  } else if (l.source === 'sondehub') {
    sondehub = 'confirmed'
  } else if (l.position && l.position.status === 'UNKNOWN') {
    // Posição UNKNOWN geralmente veio de telemetria RF (sondehub) e não de
    // recuperação física — indício, não certeza.
    sondehub = 'confirmed'
    notes.push('Posição derivada de telemetria RF (sem recuperação física registrada).')
  } else {
    sondehub = 'pending'
  }

  if (l.approx) notes.push('Horário aproximado (arredondado para o ciclo sinótico).')

  const confirmedCount = [wyoming, radiosondy, sondehub].filter(s => s === 'confirmed').length
  const level: LaunchConfidence['level'] =
    confirmedCount >= 2 ? 'high' : confirmedCount === 1 && !l.approx ? 'medium' : 'low'

  return { wyoming, radiosondy, sondehub, level, notes }
}
