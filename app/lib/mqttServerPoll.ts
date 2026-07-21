/**
 * Coleta server-side de telemetria MQTT — roda dentro de uma rota da Vercel
 * (app/api/poll), chamada periodicamente por um cron externo, pra continuar
 * gravando energia/bateria/deep-sleep no R2 mesmo sem ninguém com o site
 * aberto. Substitui, pro histórico persistido, o que useReceiverMqtt.ts +
 * usePowerStateHistory.ts/useBatteryHistory.ts faziam só enquanto uma aba
 * ficava aberta (ver app/lib/powerState.ts pra lógica compartilhada).
 *
 * Funções serverless não são processos de longa duração — não dá pra manter
 * uma assinatura MQTT sempre aberta entre execuções. Em vez disso, cada
 * receptor registrado (ver receiverRegistry em blobStore.ts) recebe uma
 * conexão CURTA: assina os tópicos retidos, espera alguns segundos pelas
 * mensagens retidas chegarem (é exatamente pra isso que "retained" serve —
 * dão o último valor na hora, sem precisar de um evento novo), desconecta.
 */
import { readReceiverRegistry, readReceiverHistory, writeReceiverHistory } from './blobStore'
import { parseRdzPmu, parseRdzSleep, parseRdzPower } from './mqtt'
import {
  deriveSleepState, derivePowerHistoryState, powerHistoryKey, shouldRecordBattReading,
  type PowerHistoryEntry, type BattVoltageEntry,
} from './powerState'
import { receiverKey } from './receiverKey'

const CONNECT_TIMEOUT_MS = 8000
const WAIT_RETAINED_MS   = 4000
const MAX_HISTORY_ENTRIES_POWER = 2000
const MAX_HISTORY_ENTRIES_BATT  = 5000

interface Collected {
  pmu?:   ReturnType<typeof parseRdzPmu>
  sleep?: ReturnType<typeof parseRdzSleep>
  power?: ReturnType<typeof parseRdzPower>
}

async function collectRetained(brokerUrl: string, prefix: string): Promise<Collected> {
  const mod: any = await import('mqtt')
  const mqttConnect = mod.connect ?? mod.default?.connect
  if (!mqttConnect) throw new Error('mqtt: connect() indisponível no módulo importado')

  return new Promise<Collected>((resolve) => {
    const collected: Collected = {}
    let settled = false
    const client = mqttConnect(brokerUrl, {
      reconnectPeriod: 0,
      connectTimeout: CONNECT_TIMEOUT_MS,
      clientId: `sondas-poll-${Math.random().toString(16).slice(2, 10)}`,
      clean: true,
    })

    const finish = () => {
      if (settled) return
      settled = true
      client.end(true)
      resolve(collected)
    }

    const timeout = setTimeout(finish, CONNECT_TIMEOUT_MS + WAIT_RETAINED_MS)

    client.on('connect', () => {
      client.subscribe([`${prefix}pmu`, `${prefix}sleep`, `${prefix}power`], { qos: 1 })
      setTimeout(finish, WAIT_RETAINED_MS)
    })
    client.on('message', (topic: string, payload: Buffer) => {
      const text = payload.toString('utf8')
      if (topic === `${prefix}pmu`) collected.pmu = parseRdzPmu(text)
      else if (topic === `${prefix}sleep`) collected.sleep = parseRdzSleep(text)
      else if (topic === `${prefix}power`) collected.power = parseRdzPower(text)
    })
    client.on('error', () => { clearTimeout(timeout); finish() })
  })
}

export interface PollReceiverResult {
  prefix: string
  ok: boolean
  updated: boolean
}

// Processa um receptor: coleta os tópicos retidos, deriva o estado (mesma
// lógica do navegador, ver powerState.ts) e grava a nova leitura no R2 se
// for de fato uma leitura nova (mesmo critério de dedup do navegador —
// dedup existe pra não inflar o histórico com repetição do mesmo estado).
export async function pollReceiver(prefix: string, brokerUrl: string): Promise<PollReceiverResult> {
  const key = receiverKey(prefix)
  try {
    const { pmu, sleep, power } = await collectRetained(brokerUrl, prefix)
    const now = Date.now()
    let updated = false

    // Só grava se o broker de fato respondeu algo pra este prefixo — sem
    // isso, prefixo errado/receptor nunca-online/broker fora do ar viravam
    // silenciosamente um falso "acordado" (nenhum tópico chegou, mas
    // derivePowerHistoryState(null,null,null) resolve pra 'awake' por
    // padrão). Mesmo espírito das outras correções desta sessão: só contar
    // como dado o que foi realmente recebido.
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

    return { prefix, ok: true, updated }
  } catch (e) {
    console.error(`[mqttServerPoll] falhou pra ${prefix}:`, e)
    return { prefix, ok: false, updated: false }
  }
}

export interface PollReceiversSummary {
  total:   number
  updated: number
  errors:  number
  results: PollReceiverResult[]
}

// Processa todos os receptores registrados, sequencialmente (a maioria das
// contas tem 1-2 receptores; conexões MQTT curtas em paralelo demais
// arriscam saturar o maxDuration da function à toa).
export async function pollAllReceivers(): Promise<PollReceiversSummary> {
  const registry = await readReceiverRegistry()
  const results: PollReceiverResult[] = []
  for (const entry of registry) {
    results.push(await pollReceiver(entry.prefix, entry.brokerUrl))
  }
  return {
    total:   results.length,
    updated: results.filter(r => r.updated).length,
    errors:  results.filter(r => !r.ok).length,
    results,
  }
}
