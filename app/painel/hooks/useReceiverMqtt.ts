'use client'

import { useEffect, useRef, useState } from 'react'
import type { MqttClient } from 'mqtt'
import { LIVE_STALE_MS, NearbySonde } from '@/app/lib/sondehub'
import {
  parseRdzPacket, parseRdzUptime, parseRdzPmu, parseRdzSleep, parseRdzPower,
  rdzPacketToSonde, RdzUptime, RdzSleep, RdzPower,
} from '@/app/lib/mqtt'
import { getSettings } from '@/app/lib/settings'

export interface MqttUptimeState {
  receivedAt: number // wall clock local da chegada
  retained: boolean // retained = pode ser velho; NUNCA conta como online
  data: RdzUptime
}

export interface DiscoveredReceiver {
  prefix: string
  uptime: RdzUptime
  seenAt: number
}

export interface ReceiverMqttState {
  connected: boolean
  lastLiveMessageAt: number | null // última mensagem NÃO-retained
  uptime: MqttUptimeState | null
  // Bateria do TTGO (tópico {prefix}pmu do dev2). Retained é aceitável aqui:
  // é a última leitura conhecida, útil mesmo com o receptor dormindo.
  ttgoBattV: number | null
  // Estado de deep sleep (tópico {prefix}sleep, retained de propósito —
  // é assim que se sabe que ele está dormindo com a aba recém-aberta).
  sleepState: RdzSleep | null
  // Estado de energia (tópico {prefix}power, retained): CPU/WiFi/economia
  // por bateria crítica — ver docs/DEEP_SLEEP_V2_GUIDE.md no firmware.
  powerState: RdzPower | null
  packetsBySerial: Map<string, NearbySonde>
  mqttConfigured: boolean
  // Receptores descobertos via wildcard (mqttDiscoveryBase). Chave = prefix.
  discoveredReceivers: Map<string, DiscoveredReceiver>
}

/**
 * Conexão MQTT-over-WebSocket com o broker público onde o rdzTTGOsonde do
 * usuário publica (ver app/lib/mqtt.ts para o contrato dos tópicos). Só
 * estado bruto — o merge com o fallback SondeHub mora em useReceiver.
 *
 * A lib `mqtt` (~50KB gzip) entra por dynamic import apenas quando o usuário
 * habilitou o MQTT nas configurações — custo zero de bundle para os demais.
 * Reconexão fica por conta do reconnectPeriod built-in (broker público cair
 * é esperado; o fallback SondeHub cobre o intervalo).
 *
 * Deliberadamente NÃO desconecta com a aba oculta: a conexão idle é barata e
 * é o que permite alerta de sonda nova com ~1s de latência em segundo plano.
 */
export function useReceiverMqtt(): ReceiverMqttState {
  const [connected, setConnected] = useState(false)
  const [lastLiveMessageAt, setLastLiveMessageAt] = useState<number | null>(null)
  const [uptime, setUptime] = useState<MqttUptimeState | null>(null)
  const [ttgoBattV, setTtgoBattV] = useState<number | null>(null)
  const [sleepState, setSleepState] = useState<RdzSleep | null>(null)
  const [powerState, setPowerState] = useState<RdzPower | null>(null)
  const [packetsBySerial, setPacketsBySerial] = useState<Map<string, NearbySonde>>(new Map())
  const [mqttConfigured, setMqttConfigured] = useState(false)
  const [discoveredReceivers, setDiscoveredReceivers] = useState<Map<string, DiscoveredReceiver>>(new Map())
  // tick de 15s só pra reavaliar frescor na UI mesmo sem mensagem nova
  const [, setTick] = useState(0)

  const packetsRef = useRef<Map<string, NearbySonde>>(new Map())
  const discoveredRef = useRef<Map<string, DiscoveredReceiver>>(new Map())

  useEffect(() => {
    const s = getSettings()
    const configured = s.mqttEnabled && !!s.mqttTopicPrefix && /^wss?:\/\//.test(s.mqttBrokerUrl)
    setMqttConfigured(configured)
    if (!configured) return

    let client: MqttClient | null = null
    let disposed = false

    ;(async () => {
      const mod: any = await import('mqtt')
      if (disposed) return
      // O build ESM do pacote `mqtt` (usado no browser) só expõe um export
      // default (o module.exports do CJS embrulhado) — `mod.connect` não
      // existe nesse formato, só `mod.default.connect`. Aceita os dois
      // formatos para não quebrar se o bundler resolver diferente.
      const mqttConnect = mod.connect ?? mod.default?.connect
      if (!mqttConnect) { console.error('mqtt: connect() indisponível no módulo importado'); return }
      client = mqttConnect(s.mqttBrokerUrl, {
        reconnectPeriod: 5000,
        connectTimeout: 10000,
        clientId: `sondas-web-${Math.random().toString(16).slice(2, 10)}`,
        clean: true,
      }) as MqttClient
      const c = client

      c.on('connect', () => {
        setConnected(true)
        const topics = [
          `${s.mqttTopicPrefix}packet`,
          `${s.mqttTopicPrefix}uptime`,
          `${s.mqttTopicPrefix}pmu`,
          `${s.mqttTopicPrefix}sleep`,
          `${s.mqttTopicPrefix}power`,
        ]
        // Autodescoberta: assina wildcard para detectar outros receptores
        if (s.mqttDiscoveryBase) topics.push(`${s.mqttDiscoveryBase}+/uptime`)
        c.subscribe(topics, { qos: 1 })
      })
      c.on('close', () => setConnected(false))
      c.on('offline', () => setConnected(false))
      c.on('error', () => { /* reconexão automática cuida */ })

      c.on('message', (topic, payload, packet) => {
        const retained = packet.retain === true
        const text = payload.toString('utf8')
        const now = Date.now()

        if (topic === `${s.mqttTopicPrefix}uptime`) {
          const data = parseRdzUptime(text)
          if (!data) return
          setUptime({ receivedAt: now, retained, data })
          if (data.batt !== undefined) setTtgoBattV(data.batt) // firmwares antigos patchados
          if (!retained) setLastLiveMessageAt(now)
          return
        }

        if (topic === `${s.mqttTopicPrefix}pmu`) {
          const data = parseRdzPmu(text)
          if (!data) return
          setTtgoBattV(data.vBatt)
          if (!retained) setLastLiveMessageAt(now)
          return
        }

        if (topic === `${s.mqttTopicPrefix}sleep`) {
          const data = parseRdzSleep(text)
          if (!data) return
          setSleepState(data)
          if (data.vBatt !== undefined) setTtgoBattV(data.vBatt)
          if (!retained) setLastLiveMessageAt(now)
          return
        }

        if (topic === `${s.mqttTopicPrefix}power`) {
          const data = parseRdzPower(text)
          if (!data) return
          setPowerState(data)
          if (!retained) setLastLiveMessageAt(now)
          return
        }

        if (topic === `${s.mqttTopicPrefix}packet`) {
          const p = parseRdzPacket(text)
          if (!p) return
          // Retained pode ser o resíduo do último voo: só aceita se o frame
          // (pelo `time` do GPS) ainda for fresco.
          if (retained && now - p.time * 1000 >= LIVE_STALE_MS) return
          const sonde = rdzPacketToSonde(p, s.uploaderCallsign)
          packetsRef.current.set(sonde.serial, sonde)
          setPacketsBySerial(new Map(packetsRef.current))
          if (!retained) setLastLiveMessageAt(now)
          return
        }

        // Autodescoberta: mensagem de uptime de outro receptor (via wildcard)
        if (s.mqttDiscoveryBase &&
            topic.startsWith(s.mqttDiscoveryBase) &&
            topic.endsWith('/uptime') &&
            topic !== `${s.mqttTopicPrefix}uptime`) {
          const prefix = topic.slice(0, -'uptime'.length) // "base/segmento/"
          if (prefix === s.mqttTopicPrefix) return       // é o receptor principal
          const data = parseRdzUptime(text)
          if (!data) return
          discoveredRef.current.set(prefix, { prefix, uptime: data, seenAt: now })
          setDiscoveredReceivers(new Map(discoveredRef.current))
        }
      })
    })()

    const tick = setInterval(() => setTick(t => t + 1), 15_000)
    return () => {
      disposed = true
      clearInterval(tick)
      client?.end(true)
    }
  }, [])

  return { connected, lastLiveMessageAt, uptime, ttgoBattV, sleepState, powerState, packetsBySerial, mqttConfigured, discoveredReceivers }
}
