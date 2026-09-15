/**
 * Plano de energia do receptor (campos power.* do firmware, ver
 * RX_FSK/src/sleep.cpp e docs/POWER_MODES_GUIDE.md no repo do firmware) —
 * períodos do dia, níveis, presets e estimativa de consumo. Compartilhado
 * entre o editor (PowerConfigEditor) e o gráfico histórico (PowerTimeline).
 * Módulo puro, sem 'use client'.
 */
import type { RdzConfig } from './rdzConfig'
import type { PowerEstimateSettings } from './settings'

export const LVL_FULL = 0
export const LVL_ECO = 1
export const LVL_SILENT = 2
export const LVL_PULSE = 3
export const LVL_DEEP = 4

export const LEVEL_LABEL: Record<number, string> = {
  0: 'Pleno',
  1: 'Econômico',
  2: 'Silencioso',
  3: 'Pulsado',
  4: 'Sono profundo',
}

export const LEVEL_HINT: Record<number, string> = {
  0: 'Tudo ligado: CPU máxima, WiFi normal, display aceso',
  1: 'CPU reduzida, WiFi em economia, display apagado — app continua ao vivo',
  2: 'Como o Econômico, mas com WiFi desligado; religa de tempos em tempos só pra reportar',
  3: 'Como o Silencioso, mas cochila em sono leve entre escutas curtas — pode demorar um ciclo pra notar a sonda',
  4: 'Dorme de verdade até a próxima janela — não ouve nada nesse tempo',
}

export type PlanPeriod = 'window' | 'wait' | 'idle'

export interface PowerWindow { startMin: number; durMin: number }

export interface PowerPlan {
  tz: number
  windows: PowerWindow[] // só as habilitadas (dur > 0)
  waitMin: number
  lvlWait: number // normalizado (0-3)
  lvlIdle: number // normalizado (0-4)
  reportMin: number
  pulseEverySec: number
  pulseListenSec: number // por frequência ativa
  wakeMarginMin: number
  landingWaitMin: number
}

const int = (config: RdzConfig, key: string, fallback: number): number => {
  const n = parseInt(String(config[key] ?? ''), 10)
  return isFinite(n) ? n : fallback
}

// Mesma normalização do firmware (normLevel em sleep.cpp): Sono profundo só
// vale no resto do dia — na espera vira Pulsado.
export function normLevel(v: number, allowDeep: boolean): number {
  const l = Math.min(LVL_DEEP, Math.max(LVL_FULL, v))
  return l === LVL_DEEP && !allowDeep ? LVL_PULSE : l
}

/** null se a config carregada ainda não tem os campos power.* (firmware antigo). */
export function parsePowerPlan(config: RdzConfig): PowerPlan | null {
  if (!('power.lvl_idle' in config)) return null
  const windows: PowerWindow[] = []
  for (const n of [1, 2]) {
    const durMin = int(config, `power.w${n}dur`, 0)
    if (durMin > 0) windows.push({ startMin: int(config, `power.w${n}start`, 0), durMin })
  }
  return {
    tz: int(config, 'power.tz', -180),
    windows,
    waitMin: Math.max(0, int(config, 'power.wait', 0)),
    lvlWait: normLevel(int(config, 'power.lvl_wait', LVL_ECO), false),
    lvlIdle: normLevel(int(config, 'power.lvl_idle', LVL_ECO), true),
    reportMin: Math.max(1, int(config, 'power.report_min', 15)),
    // Mesmos limites do firmware (constrain em pulseStep).
    pulseEverySec: Math.min(3600, Math.max(10, int(config, 'power.pulse_every', 60))),
    pulseListenSec: Math.min(120, Math.max(2, int(config, 'power.pulse_listen', 5))),
    wakeMarginMin: Math.max(0, int(config, 'power.wakemargin', 5)),
    landingWaitMin: Math.max(1, int(config, 'power.landing_wait', 15)),
  }
}

// ──────────────────────────────────────────────────────────────
// Segmentos do dia (minutos locais 0–1440)
// ──────────────────────────────────────────────────────────────
export interface PlanSegment { startMin: number; endMin: number; period: PlanPeriod; level: number }

/** Divide o dia local em segmentos janela/espera/resto, com o nível de cada
 * um — mesma precedência do firmware (janela vence espera). Sono profundo sem
 * nenhuma janela não tem até quando dormir: vira Econômico, como no firmware.
 * O nível aqui é o CONFIGURADO (sem os degraus de bateria). */
export function planDaySegments(plan: PowerPlan): PlanSegment[] {
  const periodAt = new Array<PlanPeriod>(1440).fill('idle')
  for (const w of plan.windows) {
    for (let i = 0; i < w.durMin + plan.waitMin && i < 1440; i++) {
      const m = (((w.startMin + i) % 1440) + 1440) % 1440
      const p: PlanPeriod = i < w.durMin ? 'window' : 'wait'
      if (p === 'window' || periodAt[m] === 'idle') periodAt[m] = p
    }
  }
  const idleLevel = plan.lvlIdle === LVL_DEEP && plan.windows.length === 0 ? LVL_ECO : plan.lvlIdle
  const levelOf = (p: PlanPeriod) => p === 'window' ? LVL_FULL : p === 'wait' ? plan.lvlWait : idleLevel

  const segs: PlanSegment[] = []
  for (let m = 0; m < 1440; m++) {
    const p = periodAt[m]
    const last = segs[segs.length - 1]
    if (last && last.period === p) last.endMin = m + 1
    else segs.push({ startMin: m, endMin: m + 1, period: p, level: levelOf(p) })
  }
  return segs
}

// ──────────────────────────────────────────────────────────────
// Estimativa de consumo
// ──────────────────────────────────────────────────────────────
// Silencioso: cada religada do WiFi fica ~30s de pé (conectar + ~20s de
// report), gastando a diferença entre Pleno e Silencioso nesse tempo.
const SILENT_BURST_S = 30
// Fração da capacidade nominal que dá pra usar de verdade (sem descer demais
// a célula).
const USABLE_FRACTION = 0.9
// Duração típica de um voo acompanhado (subida+descida+espera do pouso).
const FLIGHT_HOURS = 2.5
// Pulsado: cada troca de canal/despertar reconfigura o rádio (~1s a mais de
// escuta por frequência).
const PULSE_RESUME_S = 1

export interface PowerEstimate {
  mahPerDay: number
  days: number
  flightExtraMah: number
  minutesByLevel: Record<number, number>
  pulseDutyPct: number // % do ciclo do Pulsado com o rádio ligado
}

/** Fração do ciclo do Pulsado acordada: escuta cada frequência ativa e cochila
 * o resto (se não sobra tempo pra cochilar, é escuta contínua). */
export function pulseDuty(plan: PowerPlan, channels: number): number {
  const awake = Math.max(1, channels) * (plan.pulseListenSec + PULSE_RESUME_S)
  return Math.min(1, awake / plan.pulseEverySec)
}

function levelMa(level: number, e: PowerEstimateSettings, plan: PowerPlan): number {
  if (level === LVL_PULSE) {
    const duty = pulseDuty(plan, e.channels)
    return duty * e.silentMa + (1 - duty) * e.lightSleepMa
  }
  return level === LVL_FULL ? e.fullMa : level === LVL_ECO ? e.ecoMa : level === LVL_SILENT ? e.silentMa : e.deepMa
}

/** Dia sem voo, com o plano como configurado. No Sono profundo, o receptor
 * acorda `wakeMarginMin` antes de cada janela e fica em Econômico até ela. */
export function estimateConsumption(plan: PowerPlan, e: PowerEstimateSettings): PowerEstimate {
  const minutesByLevel: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 }
  for (const s of planDaySegments(plan)) minutesByLevel[s.level] += s.endMin - s.startMin
  if (plan.lvlIdle === LVL_DEEP && minutesByLevel[LVL_DEEP] > 0) {
    const early = Math.min(minutesByLevel[LVL_DEEP], plan.windows.length * plan.wakeMarginMin)
    minutesByLevel[LVL_DEEP] -= early
    minutesByLevel[LVL_ECO] += early
  }
  let mah = 0
  for (const [lvl, min] of Object.entries(minutesByLevel)) mah += (min / 60) * levelMa(Number(lvl), e, plan)
  // Religadas do WiFi pra reportar (Silencioso e Pulsado).
  const bursts = (minutesByLevel[LVL_SILENT] + minutesByLevel[LVL_PULSE]) / plan.reportMin
  mah += bursts * (SILENT_BURST_S / 3600) * Math.max(0, e.fullMa - e.silentMa)

  const baseline = levelMa(plan.lvlIdle, e, plan)
  return {
    mahPerDay: mah,
    days: mah > 0 ? (e.capacityMah * USABLE_FRACTION) / mah : Infinity,
    flightExtraMah: FLIGHT_HOURS * Math.max(0, e.fullMa - baseline),
    minutesByLevel,
    pulseDutyPct: pulseDuty(plan, e.channels) * 100,
  }
}

// ──────────────────────────────────────────────────────────────
// Presets (só mexem nos níveis — janelas, fuso e bateria ficam como estão)
// ──────────────────────────────────────────────────────────────
export interface PowerPreset {
  id: string
  label: string
  hint: string
  lvlWait: number
  lvlIdle: number
}

export const POWER_PRESETS: PowerPreset[] = [
  { id: 'max', label: 'Sempre ligado — máximo', hint: 'Tudo ligado o dia inteiro. Maior consumo.', lvlWait: LVL_FULL, lvlIdle: LVL_FULL },
  { id: 'eco', label: 'Sempre ligado — econômico', hint: 'Pleno só nas janelas; no resto, economiza sem desligar o WiFi.', lvlWait: LVL_ECO, lvlIdle: LVL_ECO },
  { id: 'silent', label: 'Sempre ligado — silencioso', hint: 'Fora das janelas, WiFi desligado (religa pra reportar). Continua ouvindo sondas.', lvlWait: LVL_ECO, lvlIdle: LVL_SILENT },
  { id: 'pulse', label: 'Sempre ligado — pulsado', hint: 'Fora das janelas, ouve em pulsos e cochila entre eles. Quase o consumo de dormir, sem deixar de ouvir.', lvlWait: LVL_ECO, lvlIdle: LVL_PULSE },
  { id: 'windows', label: 'Só nas janelas', hint: 'Fora das janelas e da espera, dorme de verdade — não ouve nada.', lvlWait: LVL_ECO, lvlIdle: LVL_DEEP },
]

export function matchPreset(plan: PowerPlan): PowerPreset | null {
  return POWER_PRESETS.find(p => p.lvlWait === plan.lvlWait && p.lvlIdle === plan.lvlIdle) ?? null
}

// ──────────────────────────────────────────────────────────────
// Horário
// ──────────────────────────────────────────────────────────────
// "510" (minutos desde 00:00) <-> "08:30" (pro <input type="time">). Valores
// fora de 0–1439 são normalizados (mod 24h).
export function minutesToHHMM(min: number): string {
  const m = ((min % 1440) + 1440) % 1440
  const h = Math.floor(m / 60)
  const mm = m % 60
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  if (!isFinite(h) || !isFinite(m)) return 0
  return h * 60 + m
}
