/**
 * Grava no R2 o histórico de energia/bateria/deep-sleep de um receptor a
 * partir do que foi reportado (pmu/sleep/power) — usado hoje só pelo reporte
 * HTTP direto do firmware (/api/receiver-report, ver conn-report.cpp).
 *
 * Renomeado de mqttServerPoll.ts (branch mqtt-cfg-only): o polling
 * server-side via MQTT (conectar ao broker, assinar tópicos retidos,
 * desconectar) foi removido — o firmware não publica mais pmu/sleep/power
 * via MQTT (só cfg/get e cfg/set continuam ativos), então não havia mais
 * nada pra esse cron coletar. A lógica de dedup abaixo é a mesma de antes.
 */
import { readReceiverHistory, writeReceiverHistory } from './blobStore'
import { parseRdzPmu, parseRdzSleep, parseRdzPower } from './mqtt'
import {
  deriveSleepState, derivePowerHistoryState, powerHistoryKey, shouldRecordBattReading,
  type PowerHistoryEntry, type BattVoltageEntry,
} from './powerState'
import { receiverKey } from './receiverKey'

const MAX_HISTORY_ENTRIES_POWER = 2000
const MAX_HISTORY_ENTRIES_BATT  = 5000

export interface Collected {
  pmu?:   ReturnType<typeof parseRdzPmu>
  sleep?: ReturnType<typeof parseRdzSleep>
  power?: ReturnType<typeof parseRdzPower>
}

// Grava no R2 o que foi coletado para um receptor (pmu/sleep/power). Só
// grava se algo de fato chegou pra este prefixo — sem isso, prefixo
// errado/receptor nunca-online viraria silenciosamente um falso "acordado"
// (nenhum dado chegou, mas derivePowerHistoryState(null,null,null) resolve
// pra 'awake' por padrão). Só conta como dado o que foi realmente recebido.
export async function recordCollected(prefix: string, collected: Collected, now: number): Promise<boolean> {
  const { pmu, sleep, power } = collected
  const key = receiverKey(prefix)
  let updated = false

  if (sleep || power) {
    const { sleeping, waitingLate } = deriveSleepState(sleep ?? null, now)
    const { state, reason } = derivePowerHistoryState(sleeping, waitingLate, power ?? null)
    const powerHistory = (await readReceiverHistory<PowerHistoryEntry>(key, 'power')) ?? []
    const lastPower = powerHistory[powerHistory.length - 1]
    const lastPowerKey = lastPower ? powerHistoryKey(lastPower.state, lastPower.reason) : null
    if (lastPowerKey !== powerHistoryKey(state, reason)) {
      const next = [...powerHistory, { at: now, state, reason, cpuMhz: power?.cpuMhz, wifi: power?.wifi }]
      const trimmed = next.length > MAX_HISTORY_ENTRIES_POWER ? next.slice(next.length - MAX_HISTORY_ENTRIES_POWER) : next
      await writeReceiverHistory(key, 'power', trimmed)
      updated = true
    }
  }

  if (pmu && isFinite(pmu.vBatt)) {
    const battHistory = (await readReceiverHistory<BattVoltageEntry>(key, 'batt')) ?? []
    const last = battHistory[battHistory.length - 1] ?? null
    if (shouldRecordBattReading(last, pmu.vBatt, now)) {
      const next = [...battHistory, { at: now, v: pmu.vBatt }]
      const trimmed = next.length > MAX_HISTORY_ENTRIES_BATT ? next.slice(next.length - MAX_HISTORY_ENTRIES_BATT) : next
      await writeReceiverHistory(key, 'batt', trimmed)
      updated = true
    }
  }

  return updated
}
