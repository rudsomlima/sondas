/**
 * Checa TODOS os receptores conhecidos (readKnownReceivers — auto-descoberta
 * via /api/receiver-report, não depende de ninguém ter cadastrado nada no
 * navegador) e avisa no Telegram quando um fica offline (sem report por
 * tempo demais, e não é deep sleep esperado) ou com bateria baixa — e quando
 * cada um desses estados se resolve. Chamado pelo cron /api/poll, que já é
 * pingado a cada poucos minutos por um serviço externo (cron-job.org) mesmo
 * sem ninguém com o app aberto — ver o comentário em api/poll/route.ts.
 *
 * Servidor-only (usa o bot token, nunca deve ser importado por código
 * 'use client'). Módulo separado de telegram-notify (evento pontual de
 * lançamento/pouso) porque aqui o que importa é NÍVEL — só manda mensagem
 * quando o estado muda (updateReceiverAlertState), não a cada checagem.
 */
import { readKnownReceivers, readReceiverLiveStatus, readTelegramSettings, updateReceiverAlertState } from './blobStore'
import { sendTelegramMessage } from './telegramClient'
import { buildReceiverAlertText } from './telegramMessage'
import { deriveSleepState, isReceiverFresh } from './powerState'
import { receiverKey } from './receiverKey'

export interface ReceiverAlertsSummary {
  checked: number
  sent: number
  error?: string
}

export async function checkReceiverAlerts(): Promise<ReceiverAlertsSummary> {
  try {
    const settings = await readTelegramSettings()
    if (!settings?.enabled || !settings.botToken || !settings.chatId) return { checked: 0, sent: 0 }
    if (!settings.notifyReceiverOffline && !settings.notifyLowBattery) return { checked: 0, sent: 0 }

    const known = await readKnownReceivers()
    const now = Date.now()
    let sent = 0

    for (const entry of known) {
      const key = receiverKey(entry.prefix)
      const live = await readReceiverLiveStatus(key)

      const { sleeping } = deriveSleepState(live?.sleep ?? null, now)
      const fresh = isReceiverFresh(live?.updatedAt ?? null, live?.power ?? null, now)
      // Deep sleep de propósito nunca conta como offline, mesmo há muito
      // tempo sem report — é o comportamento esperado do modo Sono profundo.
      const minutesSilent = live?.updatedAt != null ? Math.round((now - live.updatedAt) / 60_000) : null
      const thresholdMs = Math.max(settings.receiverOfflineMinutes, 1) * 60_000
      const offline = !sleeping && (live?.updatedAt == null
        ? true
        : !fresh && now - live.updatedAt >= thresholdMs)

      const vBatt = live?.pmu?.vBatt ?? live?.sleep?.vBatt
      const lowBattery = typeof vBatt === 'number' ? vBatt < settings.lowBatteryVoltage : undefined

      const { offlineChanged, batteryChanged } = await updateReceiverAlertState(key, {
        offline: settings.notifyReceiverOffline ? offline : undefined,
        battery: settings.notifyLowBattery && lowBattery !== undefined ? lowBattery : undefined,
      })

      if (settings.notifyReceiverOffline && offlineChanged) {
        const text = buildReceiverAlertText(offline ? 'offline' : 'online', entry.prefix, { minutesSilent: minutesSilent ?? undefined })
        const r = await sendTelegramMessage(settings.botToken, settings.chatId, text)
        if (r.ok) sent++
      }
      if (settings.notifyLowBattery && batteryChanged && lowBattery !== undefined) {
        const text = buildReceiverAlertText(lowBattery ? 'lowBattery' : 'batteryOk', entry.prefix, { vBatt })
        const r = await sendTelegramMessage(settings.botToken, settings.chatId, text)
        if (r.ok) sent++
      }
    }

    return { checked: known.length, sent }
  } catch (e: any) {
    console.error('[receiverAlerts] checkReceiverAlerts falhou:', e)
    return { checked: 0, sent: 0, error: String(e?.message ?? 'falhou') }
  }
}
