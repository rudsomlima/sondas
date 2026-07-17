'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getSettings } from '@/app/lib/settings'
import { RdzConfig } from '@/app/lib/rdzConfig'
import {
  cfgGetTopic, cfgGetRespTopic, cfgSetTopic, cfgSetRespTopic,
  parseCfgGetResp, parseCfgSetResp, computeCfgAuth,
} from '@/app/lib/mqtt'

// Único canal: MQTT (funciona de qualquer lugar, inclusive pelo site
// publicado em https://). O canal HTTP local foi removido — só funcionava
// com o app aberto em http:// na mesma rede do receptor.
export type RdzConfigChannel = 'mqtt'

export interface ApplyResult {
  ok: boolean
  rebooting?: boolean
}

export interface FirmwareConfigState {
  config: RdzConfig | null
  loadedAt: number | null // epoch ms da última carga bem-sucedida
  loading: boolean
  error: string | null
  channel: RdzConfigChannel | null
  load: () => void
  applying: boolean
  applyError: string | null
  applyResult: ApplyResult | null
  apply: (changes: Record<string, string>, mode: 'live' | 'reboot') => void
}

const MQTT_TIMEOUT_MS = 8000

function randomReqId(): string {
  return Math.random().toString(16).slice(2, 10).padEnd(8, '0')
}

// Canal MQTT: conexão curta e própria (não a always-on de useReceiverMqtt,
// que não sabe publicar) — só existe enquanto a página /meu-receptor precisa
// de um round-trip de request/response, depois desconecta.
async function withShortMqttConnection<T>(
  brokerUrl: string,
  fn: (client: import('mqtt').MqttClient) => Promise<T>
): Promise<T> {
  const mod: any = await import('mqtt')
  const mqttConnect = mod.connect ?? mod.default?.connect
  if (!mqttConnect) throw new Error('mqtt: connect() indisponível no módulo importado')
  const client = mqttConnect(brokerUrl, {
    reconnectPeriod: 0,
    connectTimeout: 10000,
    clientId: `sondas-cfg-${Math.random().toString(16).slice(2, 10)}`,
    clean: true,
  })
  try {
    await new Promise<void>((resolve, reject) => {
      client.once('connect', () => resolve())
      client.once('error', (e: Error) => reject(e))
    })
    return await fn(client)
  } finally {
    client.end(true)
  }
}

async function fetchMqttConfig(brokerUrl: string, prefix: string): Promise<RdzConfig> {
  return withShortMqttConnection(brokerUrl, client => new Promise<RdzConfig>((resolve, reject) => {
    const reqId = randomReqId()
    const respTopic = cfgGetRespTopic(prefix)
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('Sem resposta do receptor via MQTT (timeout) — ele precisa estar ligado e acordado.'))
    }, MQTT_TIMEOUT_MS)

    function cleanup() {
      clearTimeout(timeout)
      client.removeListener('message', onMessage)
    }
    function onMessage(topic: string, payload: Buffer) {
      if (topic !== respTopic) return
      const parsed = parseCfgGetResp(payload.toString('utf8'))
      if (!parsed || parsed.reqId !== reqId) return
      cleanup()
      if (parsed.error) reject(new Error(parsed.error))
      else if (!parsed.config) reject(new Error('Resposta de config vazia ou inválida'))
      else resolve(parsed.config)
    }

    client.on('message', onMessage)
    client.subscribe(respTopic, { qos: 1 }, err => {
      if (err) { cleanup(); reject(err); return }
      client.publish(cfgGetTopic(prefix), JSON.stringify({ reqId }), { qos: 1 })
    })
  }))
}

async function writeMqttConfig(
  brokerUrl: string, prefix: string, secret: string, changes: Record<string, string>, apply: 'live' | 'reboot'
): Promise<ApplyResult> {
  if (!secret.trim()) {
    throw new Error('Defina o segredo de gravação (mqtt.cfgsecret) em Meu Receptor antes de aplicar via MQTT.')
  }
  return withShortMqttConnection(brokerUrl, client => new Promise<ApplyResult>((resolve, reject) => {
    const reqId = randomReqId()
    const respTopic = cfgSetRespTopic(prefix)
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('Sem resposta do receptor via MQTT (timeout) — ele precisa estar ligado e acordado.'))
    }, MQTT_TIMEOUT_MS)

    function cleanup() {
      clearTimeout(timeout)
      client.removeListener('message', onMessage)
    }
    function onMessage(topic: string, payload: Buffer) {
      if (topic !== respTopic) return
      const parsed = parseCfgSetResp(payload.toString('utf8'))
      if (!parsed || parsed.reqId !== reqId) return
      cleanup()
      if (!parsed.ok) reject(new Error(parsed.error ?? 'O receptor recusou a gravação'))
      else resolve({ ok: true, rebooting: parsed.rebooting })
    }

    client.on('message', onMessage)
    client.subscribe(respTopic, { qos: 1 }, async err => {
      if (err) { cleanup(); reject(err); return }
      const changesJson = JSON.stringify(changes)
      const auth = await computeCfgAuth(secret, reqId, changesJson)
      client.publish(cfgSetTopic(prefix), JSON.stringify({ reqId, auth, apply, changes }), { qos: 1 })
    })
  }))
}

export function useFirmwareConfig(): FirmwareConfigState {
  const [config, setConfig] = useState<RdzConfig | null>(null)
  const [loadedAt, setLoadedAt] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [channel, setChannel] = useState<RdzConfigChannel | null>(null)
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null)
  const hasLoadedRef = useRef(false)
  const configRef = useRef<RdzConfig | null>(null)
  configRef.current = config

  const load = useCallback(() => {
    const s = getSettings()
    if (!s.mqttEnabled || !s.mqttTopicPrefix) {
      setChannel('mqtt')
      setError('Configure e ative o MQTT em Meu Receptor antes de carregar a configuração.')
      return
    }

    setChannel('mqtt')
    setLoading(true)
    setError(null)
    fetchMqttConfig(s.mqttBrokerUrl, s.mqttTopicPrefix)
      .then(cfg => { setConfig(cfg); setLoadedAt(Date.now()) })
      .catch((e: Error) => setError(e.message || 'Falha ao carregar a configuração'))
      .finally(() => setLoading(false))
  }, [])

  // Carrega sozinho uma vez por sessão, assim que MQTT estiver configurado —
  // hasLoadedRef garante no máximo uma chamada mesmo com o double-invoke do
  // StrictMode em dev.
  useEffect(() => {
    if (hasLoadedRef.current) return
    const s = getSettings()
    if (!s.mqttEnabled || !s.mqttTopicPrefix) return
    hasLoadedRef.current = true
    load()
  }, [load])

  const apply = useCallback((changes: Record<string, string>, mode: 'live' | 'reboot') => {
    const s = getSettings()
    const base = configRef.current
    if (!base) return
    setApplying(true)
    setApplyError(null)
    setApplyResult(null)
    writeMqttConfig(s.mqttBrokerUrl, s.mqttTopicPrefix, s.rdzConfigSecret, changes, mode)
      .then(result => {
        setApplyResult(result)
        setConfig(prev => prev ? { ...prev, ...changes } : prev)
      })
      .catch((e: Error) => setApplyError(e.message || 'Falha ao aplicar a configuração'))
      .finally(() => setApplying(false))
  }, [])

  return { config, loadedAt, loading, error, channel, load, applying, applyError, applyResult, apply }
}
