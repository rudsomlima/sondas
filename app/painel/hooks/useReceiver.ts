'use client'

import { useMemo } from 'react'
import { LIVE_STALE_MS, ReceiverStatus } from '@/app/lib/sondehub'
import { MQTT_FRESH_MS, UPTIME_ONLINE_MS } from '@/app/lib/mqtt'
import { useReceiverStatus, MyReceiverSonde, FORGET_MS } from './useReceiverStatus'
import { useReceiverMqtt } from './useReceiverMqtt'
import { parseUtcDateStr } from '@/app/lib/launchUtils'

export type ReceiverSource = 'mqtt' | 'sondehub'

export interface ReceiverState {
  mySondes: MyReceiverSonde[]
  status: ReceiverStatus | null
  checked: boolean
  enabled: boolean
  alertsEnabled: boolean
  source: ReceiverSource // fonte primária ativa agora (informativo de UI)
  mqttConfigured: boolean
  mqttConnected: boolean
  uptimeMs: number | null // uptime do TTGO (millis), só de mensagem live
  ttgoBattV: number | null // bateria do TTGO (V) — tópico pmu do dev2 (última leitura conhecida)
  // Deep sleep v2 do firmware: receptor dormindo de propósito até `until`
  // (epoch ms). Distingue "dormindo" de "morto/offline" no card.
  sleeping: { until: number; reason?: string } | null
  // Escuta estendida: acordado ouvindo um lançamento atrasado (modos A/B/C)
  // até `until`. Diferente de "dormindo" — o receptor está ativo, só esperando.
  waitingLate: { until: number; reason?: string } | null
  // Posição/IP mudam raramente — mostrados a partir da última mensagem
  // conhecida (mesmo retained), diferente de uptimeMs/status que exigem
  // mensagem "live" para não afirmar "ligado" com dado velho.
  rxPosition: { lat: number; lon: number } | null // só para o marcador no mapa
  receiverIp: string | null
  // Epoch (ms) da última mensagem MQTT NÃO-retida (packet/uptime/pmu/sleep)
  // — evidência de que o broker está entregando dados recentes. Epoch bruto
  // (não um "há Xs" pré-calculado) para o componente tickar por conta própria
  // a cada segundo, em vez de depender de re-renders de outras partes do app.
  mqttLastMessageAt: number | null
  // Epoch (ms) de quando o firmware publicou a última msg uptime (campo
  // `time`, dev2), lido mesmo de mensagem retained — dá "visto pela última
  // vez" real ao abrir a aba já com o receptor dormindo, sem sonda no ar.
  mqttPublishedAt: number | null
}

/**
 * Composição híbrida do "meu receptor": MQTT (quando habilitado, conectado e
 * fresco — latência ~1s e status REAL do hardware via tópico uptime) por cima
 * do polling SondeHub (useReceiverStatus, intocado, fallback autônomo).
 *
 * Merge por serial: vence o frame com datetime mais recente — não a fonte —
 * então uma queda do broker degrada suavemente para o comportamento atual.
 * useReceiverAlerts consome a lista mesclada sem mudanças (serial novo via
 * MQTT dispara o alerta ~19s antes, de graça).
 */
export function useReceiver(): ReceiverState {
  const sondehub = useReceiverStatus()
  const mqtt = useReceiverMqtt()

  return useMemo(() => {
    const now = Date.now()
    const mqttFresh = mqtt.connected && mqtt.lastLiveMessageAt != null &&
      now - mqtt.lastLiveMessageAt < MQTT_FRESH_MS

    // Sondas vindas do MQTT no shape do pipeline (todo frame MQTT é "meu"
    // por construção — o tópico é do usuário).
    const merged = new Map<string, MyReceiverSonde>()
    for (const s of mqtt.packetsBySerial.values()) {
      const t = new Date(s.datetime).getTime()
      if (isNaN(t) || now - t > FORGET_MS) continue
      merged.set(s.serial, {
        serial: s.serial,
        lat: s.lat,
        lon: s.lon,
        alt: s.alt,
        vel_v: s.vel_v,
        lastReportUtc: s.datetime,
        myLastHeardUtc: s.datetime,
        frequency: s.frequency,
        type: s.type,
        rssi: s.rssi,
        snr: s.snr,
        battV: s.battV,
        isLive: now - t < LIVE_STALE_MS,
      })
    }
    for (const s of sondehub.mySondes) {
      const existing = merged.get(s.serial)
      // Vence o frame mais recente; empate fica com o SondeHub, que traz o
      // `latest` de qualquer uploader (útil quando outra estação ainda ouve
      // a sonda que meu receptor perdeu).
      if (!existing || s.lastReportUtc >= existing.lastReportUtc) merged.set(s.serial, s)
    }
    const mySondes = [...merged.values()]
      .sort((a, b) => b.myLastHeardUtc.localeCompare(a.myLastHeardUtc))

    // Uptime live < 90s = hardware comprovadamente ligado, mesmo sem sonda no
    // ar (o que o SondeHub não consegue afirmar).
    const uptimeLive = mqtt.uptime && !mqtt.uptime.retained &&
      now - mqtt.uptime.receivedAt < UPTIME_ONLINE_MS ? mqtt.uptime : null

    let status: ReceiverStatus | null = sondehub.status
    if (uptimeLive) {
      status = { online: true, lastHeardUtc: sondehub.status?.lastHeardUtc ?? null }
    }

    const up = uptimeLive?.data
    // Posição/IP: último valor conhecido (mesmo retained) — raramente mudam,
    // então vale mostrar de imediato ao abrir a página, antes da 1ª msg live.
    const lastKnown = mqtt.uptime?.data
    const rxPosition = lastKnown?.rxlat !== undefined && lastKnown?.rxlon !== undefined
      ? { lat: lastKnown.rxlat, lon: lastKnown.rxlon }
      : null
    const receiverIp = lastKnown?.ip ?? null
    // Epoch (ms) de quando o firmware (dev2) publicou a última msg uptime, lido
    // do campo `time` do payload — vale mesmo em msg retained (diferente de
    // mqtt.uptime.receivedAt, que numa retained é só a hora em que a aba
    // conectou). É o que dá "visto pela última vez" real ao abrir a aba com o
    // receptor já dormindo, sem depender de outra sonda ter aparecido agora.
    const mqttPublishedAt = lastKnown?.publishedUtc ? parseUtcDateStr(lastKnown.publishedUtc).getTime() : null

    // Retained de propósito: o aviso é publicado ANTES de dormir/economizar e
    // fica no broker; expira sozinho quando sleep_until passa (com 10 min de
    // tolerância para o drift do RTC do TTGO). As razões "listen_*" significam
    // "acordado, aguardando lançamento atrasado" — não é sleep de verdade.
    const s = mqtt.sleepState
    const active = !!s && s.sleepUntil > 0 && now < s.sleepUntil * 1000 + 10 * 60_000
    const isListen = active && (s!.reason?.startsWith('listen') ?? false)
    const sleeping = active && !isListen
      ? { until: s!.sleepUntil * 1000, reason: s!.reason }
      : null
    const waitingLate = active && isListen
      ? { until: s!.sleepUntil * 1000, reason: s!.reason }
      : null

    return {
      mySondes,
      status,
      checked: sondehub.checked || mqttFresh,
      enabled: sondehub.enabled || mqtt.mqttConfigured,
      alertsEnabled: sondehub.alertsEnabled,
      source: mqttFresh ? 'mqtt' as const : 'sondehub' as const,
      mqttConfigured: mqtt.mqttConfigured,
      mqttConnected: mqtt.connected,
      uptimeMs: up?.uptimeMs ?? null,
      ttgoBattV: mqtt.ttgoBattV,
      sleeping,
      waitingLate,
      rxPosition,
      receiverIp,
      mqttLastMessageAt: mqtt.lastLiveMessageAt,
      mqttPublishedAt,
    }
  }, [sondehub, mqtt])
}
