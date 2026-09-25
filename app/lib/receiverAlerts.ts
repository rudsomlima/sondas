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
    const notifyReceiverOffline = settings.notifyReceiverOffline !== false
    const notifyReceiverOnline = settings.notifyReceiverOnline ?? notifyReceiverOffline
    const notifyLowBattery = settings.notifyLowBattery !== false
    const notifyBatteryOk = settings.notifyBatteryOk ?? notifyLowBattery
    const trackOffline = notifyReceiverOffline || notifyReceiverOnline
    const trackBattery = notifyLowBattery || notifyBatteryOk
    if (!trackOffline && !trackBattery) return { checked: 0, sent: 0 }

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
        offline: trackOffline ? offline : undefined,
        battery: trackBattery && lowBattery !== undefined ? lowBattery : undefined,
      })

      const shouldNotifyOfflineTransition = offline ? notifyReceiverOffline : notifyReceiverOnline
      if (offlineChanged && shouldNotifyOfflineTransition) {
        const text = buildReceiverAlertText(offline ? 'offline' : 'online', entry.prefix, { minutesSilent: minutesSilent ?? undefined }, settings.messageTemplates)
        const r = await sendTelegramMessage(settings.botToken, settings.chatId, text)
        if (r.ok) sent++
        else {
          // O estado já foi gravado; desfaz pra o próximo ping tentar de novo
          // em vez de perder o aviso pra sempre.
          console.error('[receiverAlerts] envio offline/online falhou:', r.error)
          await updateReceiverAlertState(key, { offline: !offline }).catch(() => {})
        }
      }
      const shouldNotifyBatteryTransition = lowBattery ? notifyLowBattery : notifyBatteryOk
      if (batteryChanged && lowBattery !== undefined && shouldNotifyBatteryTransition) {
        const text = buildReceiverAlertText(lowBattery ? 'lowBattery' : 'batteryOk', entry.prefix, { vBatt }, settings.messageTemplates)
        const r = await sendTelegramMessage(settings.botToken, settings.chatId, text)
        if (r.ok) sent++
        else {
          console.error('[receiverAlerts] envio de bateria falhou:', r.error)
          await updateReceiverAlertState(key, { battery: !lowBattery }).catch(() => {})
        }
      }
    }

    return { checked: known.length, sent }
  } catch (e: any) {
    console.error('[receiverAlerts] checkReceiverAlerts falhou:', e)
    return { checked: 0, sent: 0, error: String(e?.message ?? 'falhou') }
  }
}
