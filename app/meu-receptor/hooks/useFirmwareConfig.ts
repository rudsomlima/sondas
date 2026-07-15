'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getSettings } from '@/app/lib/settings'
import { RdzConfig, parseConfigTxt, configTxtFromChanges } from '@/app/lib/rdzConfig'
import {
  cfgGetTopic, cfgGetRespTopic, cfgSetTopic, cfgSetRespTopic,
  parseCfgGetResp, parseCfgSetResp, computeCfgAuth,
} from '@/app/lib/mqtt'

export type RdzConfigChannel = 'http' | 'mqtt'

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
  httpBlocked: boolean
  load: (channel?: RdzConfigChannel) => void
  applying: boolean
  applyError: string | null
  applyResult: ApplyResult | null
  apply: (changes: Record<string, string>, mode: 'live' | 'reboot') => void
}

const HTTP_TIMEOUT_MS = 5000
const MQTT_TIMEOUT_MS = 8000

function randomReqId(): string {
  return Math.random().toString(16).slice(2, 10).padEnd(8, '0')
}

async function fetchHttpConfig(receiverIp: string): Promise<RdzConfig> {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS)
  try {
    const res = await fetch(`http://${receiverIp}/dlconfig`, { signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status} ao ler /dlconfig`)
    return parseConfigTxt(await res.text())
  } finally {
    clearTimeout(t)
  }
}

// Reenvia o config.txt inteiro (base + diff) via /ulconfig (upload de
// arquivo) — não /config.html (form), que exigiria replicar peculiaridades
// de nome de campo do form do firmware (ex.: sufixo "#" de touch pin).
async function writeHttpConfig(receiverIp: string, base: RdzConfig, changes: Record<string, string>, reboot: boolean) {
  const body = new FormData()
  const text = configTxtFromChanges(base, changes)
  body.append('cfg', new Blob([text], { type: 'text/plain' }), 'config.txt')
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS)
  try {
    const res = await fetch(`http://${receiverIp}/ulconfig`, { method: 'POST', body, signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status} ao gravar /ulconfig`)
  } finally {
    clearTimeout(t)
  }
  if (reboot) {
    const rebootBody = new URLSearchParams({ reboot: '1' })
    await fetch(`http://${receiverIp}/control.html`, { method: 'POST', body: rebootBody }).catch(() => {
      // Se o receptor já começou a reiniciar, a resposta pode nunca chegar —
      // não é erro real, o objetivo (reiniciar) já foi disparado.
    })
  }
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

export function useFirmwareConfig(receiverIp: string | null): FirmwareConfigState {
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

  const httpBlocked = typeof window !== 'undefined' && window.location.protocol === 'https:'

  const load = useCallback((requestedChannel?: RdzConfigChannel) => {
    const s = getSettings()
    const ch = requestedChannel ?? s.rdzConfigChannel
    if (!ch) return
    if (ch === 'http' && (httpBlocked || !receiverIp)) {
      setChannel(ch)
      setError(httpBlocked
        ? 'O app está em https:// — o navegador bloqueia leitura direta do receptor (http local). Abra pelo IP do receptor ou rode o app localmente (npm run dev).'
        : 'IP do receptor ainda desconhecido (precisa de pelo menos uma mensagem MQTT retida com uptime).')
      return
    }
    if (ch === 'mqtt' && (!s.mqttEnabled || !s.mqttTopicPrefix)) {
      setChannel(ch)
      setError('Configure e ative o MQTT em Meu Receptor antes de usar este canal.')
      return
    }

    setChannel(ch)
    setLoading(true)
    setError(null)
    const promise = ch === 'http'
      ? fetchHttpConfig(receiverIp!)
      : fetchMqttConfig(s.mqttBrokerUrl, s.mqttTopicPrefix)
    promise
      .then(cfg => { setConfig(cfg); setLoadedAt(Date.now()) })
      .catch((e: Error) => setError(e.message || 'Falha ao carregar a configuração'))
      .finally(() => setLoading(false))
  }, [receiverIp, httpBlocked])

  // Fetch único por sessão — dispara sozinho só se já houver canal salvo E
  // (pro canal HTTP) o IP do receptor já for conhecido (chega via a msg
  // retida de uptime do MQTT status, pode levar um instante após o mount).
  // hasLoadedRef garante que isto roda no máximo uma vez, mesmo com o efeito
  // reexecutando por causa do double-invoke do StrictMode em dev ou de
  // `receiverIp` mudando de null pro valor real.
  useEffect(() => {
    if (hasLoadedRef.current) return
    const s = getSettings()
    if (!s.rdzConfigChannel) return
    if (s.rdzConfigChannel === 'http' && receiverIp == null) return
    hasLoadedRef.current = true
    load()
  }, [receiverIp, load])

  const apply = useCallback((changes: Record<string, string>, mode: 'live' | 'reboot') => {
    const s = getSettings()
    const base = configRef.current
    if (!channel || !base) return
    setApplying(true)
    setApplyError(null)
    setApplyResult(null)
    const promise = channel === 'http'
      ? writeHttpConfig(receiverIp!, base, changes, mode === 'reboot').then(() => ({ ok: true, rebooting: mode === 'reboot' }))
      : writeMqttConfig(s.mqttBrokerUrl, s.mqttTopicPrefix, s.rdzConfigSecret, changes, mode)
    promise
      .then(result => {
        setApplyResult(result)
        setConfig(prev => prev ? { ...prev, ...changes } : prev)
      })
      .catch((e: Error) => setApplyError(e.message || 'Falha ao aplicar a configuração'))
      .finally(() => setApplying(false))
  }, [channel, receiverIp])

  return { config, loadedAt, loading, error, channel, httpBlocked, load, applying, applyError, applyResult, apply }
}
