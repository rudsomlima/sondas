/**
 * Lógica pura de derivação do estado de energia/deep sleep do receptor —
 * compartilhada entre os hooks do navegador (useReceiver.ts,
 * usePowerStateHistory.ts, useBatteryHistory.ts) e o poller do servidor
 * (mqttServerPoll.ts), pra não duplicar a mesma regra de "o que é uma
 * leitura nova" nos dois lados. Módulo puro (sem 'use client'), sem
 * dependência de browser.
 */
import type { RdzSleep, RdzPower } from './mqtt'

export interface SleepDerived {
  sleeping: { until: number; reason?: string } | null
  waitingLate: { until: number; reason?: string } | null
}

// Retained de propósito: o aviso é publicado ANTES de dormir/economizar e
// fica no broker; expira sozinho quando sleep_until passa (com 10 min de
// tolerância para o drift do RTC do TTGO). As razões "listen_*" significam
// "acordado, aguardando lançamento atrasado" — não é sleep de verdade.
export function deriveSleepState(s: RdzSleep | null, now: number): SleepDerived {
  const active = !!s && s.sleepUntil > 0 && now < s.sleepUntil * 1000 + 10 * 60_000
  const isListen = active && (s!.reason?.startsWith('listen') ?? false)
  const sleeping = active && !isListen ? { until: s!.sleepUntil * 1000, reason: s!.reason } : null
  const waitingLate = active && isListen ? { until: s!.sleepUntil * 1000, reason: s!.reason } : null
  return { sleeping, waitingLate }
}

export type PowerHistoryState = 'awake' | 'sleeping' | 'listening' | 'eco'

export function derivePowerHistoryState(
  sleeping: { reason?: string } | null,
  waitingLate: { reason?: string } | null,
  power: RdzPower | null,
): { state: PowerHistoryState; reason?: string } {
  const state: PowerHistoryState = sleeping ? 'sleeping' : waitingLate ? 'listening' : power?.eco ? 'eco' : 'awake'
  const reason = sleeping?.reason ?? waitingLate?.reason
  return { state, reason }
}

export function powerHistoryKey(state: PowerHistoryState, reason?: string): string {
  return `${state}|${reason ?? ''}`
}

// Formato gravado em R2/localStorage (sondas/receivers/{key}/power-history.json
// e batt-history.json) — canônico aqui, reexportado pelos hooks do navegador
// (usePowerStateHistory.ts/useBatteryHistory.ts) pros consumidores existentes
// (PowerTimeline.tsx/BatteryChart.tsx) não precisarem trocar de import.
export interface PowerHistoryEntry {
  at: number // epoch ms de quando foi percebida a transição
  state: PowerHistoryState
  reason?: string
  cpuMhz?: number
  wifi?: string
}

export interface BattVoltageEntry {
  at: number // epoch ms
  v:  number // tensão (V)
}

// Espaçamento máximo garantido entre leituras de bateria enquanto conectado
// (heartbeat) — usado tanto pelo hook do navegador quanto pelo gráfico
// (BatteryChart, pra decidir onde quebrar a linha em vez de interpolar) e
// agora pelo poller do servidor.
export const MAX_SILENT_MS = 5 * 60 * 1000
export const MIN_DELTA_V = 0.01

export function shouldRecordBattReading(last: { at: number; v: number } | null, v: number, now: number): boolean {
  return !last || Math.abs(v - last.v) >= MIN_DELTA_V || now - last.at >= MAX_SILENT_MS
}
