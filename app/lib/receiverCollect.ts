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
import { readReceiverHistory, writeReceiverHistory, readHistorySettings, type HistorySettings } from './blobStore'
import { parseRdzPmu, parseRdzSleep, parseRdzPower, type RdzBoot } from './mqtt'
import {
  deriveSleepState, derivePowerHistoryState, powerHistoryKey, shouldRecordBattReading,
  type PowerHistoryEntry, type BattVoltageEntry,
} from './powerState'
import { receiverKey } from './receiverKey'

const MAX_HISTORY_ENTRIES_POWER = 2000
const MAX_HISTORY_ENTRIES_BATT  = 5000
// Reinícios são raros (não é uma leitura periódica) — 500 entradas cobrem
// anos de uso, mesmo em receptor instável reiniciando várias vezes ao dia.
const MAX_HISTORY_ENTRIES_BOOT  = 500

export interface BootLogEntry extends RdzBoot {
  at: number
}

export interface Collected {
  pmu?:   ReturnType<typeof parseRdzPmu>
  sleep?: ReturnType<typeof parseRdzSleep>
  power?: ReturnType<typeof parseRdzPower>
  boot?:  RdzBoot | null
}

// Grava no R2 o que foi coletado para um receptor (pmu/sleep/power). Só
// grava se algo de fato chegou pra este prefixo — sem isso, prefixo
// errado/receptor nunca-online viraria silenciosamente um falso "acordado"
// (nenhum dado chegou, mas derivePowerHistoryState(null,null,null) resolve
// pra 'awake' por padrão). Só conta como dado o que foi realmente recebido.
// Preferência de registro (liga/desliga por gráfico) — o receptor pode
// reportar a cada poucos segundos, então não relê do R2 a cada reporte.
// Cache por instância do servidor; a rota que grava a preferência atualiza
// o cache da própria instância (outras instâncias pegam em até 1 min).
const SETTINGS_CACHE_MS = 60_000
const settingsCache = new Map<string, { at: number; settings: HistorySettings }>()

export function setHistorySettingsCache(key: string, settings: HistorySettings) {
  settingsCache.set(key, { at: Date.now(), settings })
}

async function historySettingsFor(key: string): Promise<HistorySettings> {
  const cached = settingsCache.get(key)
  if (cached && Date.now() - cached.at < SETTINGS_CACHE_MS) return cached.settings
  const settings = await readHistorySettings(key)
  setHistorySettingsCache(key, settings)
  return settings
}

export async function recordCollected(prefix: string, collected: Collected, now: number): Promise<boolean> {
  const { pmu, sleep, power, boot } = collected
  const key = receiverKey(prefix)
  let updated = false
  const settings = await historySettingsFor(key)

  if ((sleep || power) && settings.power) {
    const { sleeping, waitingLate } = deriveSleepState(sleep ?? null, now)
    const { state, reason } = derivePowerHistoryState(sleeping, waitingLate, power ?? null)
    const powerHistory = (await readReceiverHistory<PowerHistoryEntry>(key, 'power')) ?? []
    const lastPower = powerHistory[powerHistory.length - 1]
    const lastPowerKey = lastPower ? powerHistoryKey(lastPower.state, lastPower.reason, lastPower.level) : null
    if (lastPowerKey !== powerHistoryKey(state, reason, power?.level)) {
      const next = [...powerHistory, { at: now, state, reason, cpuMhz: power?.cpuMhz, wifi: power?.wifi, level: power?.level }]
      const trimmed = next.length > MAX_HISTORY_ENTRIES_POWER ? next.slice(next.length - MAX_HISTORY_ENTRIES_POWER) : next
      await writeReceiverHistory(key, 'power', trimmed)
      updated = true
    }
  }

  if (pmu && isFinite(pmu.vBatt) && settings.batt) {
    const battHistory = (await readReceiverHistory<BattVoltageEntry>(key, 'batt')) ?? []
    const last = battHistory[battHistory.length - 1] ?? null
    if (shouldRecordBattReading(last, pmu.vBatt, now)) {
      const next = [...battHistory, { at: now, v: pmu.vBatt }]
      const trimmed = next.length > MAX_HISTORY_ENTRIES_BATT ? next.slice(next.length - MAX_HISTORY_ENTRIES_BATT) : next
      await writeReceiverHistory(key, 'batt', trimmed)
      updated = true
    }
  }

  // Um reinício por boot: reportBoot() (conn-report.cpp) roda uma vez só por
  // boot, atrás do static awakeReported em sleepLoop() — sem retry no
  // firmware (reportPost não reenvia sozinho), então não precisa de dedup
  // aqui. IMPORTANTE: `count` (sleepBootCount) NÃO é um identificador único
  // de boot — ele é zerado pra 1 em todo reset que não seja timer-wake (ver
  // sleepSetup em sleep.cpp), então "ligar na tomada" repetidas vezes chega
  // sempre com count=1/resetReason=1. Um dedup por count+resetReason (como
  // uma versão anterior fazia) descartava silenciosamente essas repetições.
  if (boot) {
    const bootHistory = (await readReceiverHistory<BootLogEntry>(key, 'boot')) ?? []
    const next = [...bootHistory, { at: now, resetReason: boot.resetReason, wake: boot.wake, count: boot.count }]
    const trimmed = next.length > MAX_HISTORY_ENTRIES_BOOT ? next.slice(next.length - MAX_HISTORY_ENTRIES_BOOT) : next
    await writeReceiverHistory(key, 'boot', trimmed)
    updated = true
  }

  return updated
}
