'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getSettings } from '@/app/lib/settings'
import { RdzConfig, parseConfigJson } from '@/app/lib/rdzConfig'
import { computeCfgAuth, randomReqId } from '@/app/lib/cfgAuth'

// Único canal: HTTP direto (funciona de qualquer lugar, inclusive pelo site
// publicado em https://) — ver conn-cfg.cpp/cfgchannel.cpp no firmware.
// Leitura = último snapshot que o receptor reportou (não instantâneo, mas
// config raramente muda sozinha). Gravação = fila de pendência: o pedido
// fica em /api/receiver-config/request até o receptor buscar (no boot ou
// periodicamente enquanto acordado) e aplicar.
export type RdzConfigChannel = 'http'

export interface ApplyResult {
  ok: boolean
  rebooting?: boolean
  pending?: boolean // enfileirado, aguardando o receptor aplicar e confirmar
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

const RESULT_POLL_MS = 15_000
// Depois disso, para de aguardar ativamente — o pedido continua válido no
// servidor (o receptor aplica assim que buscar), só paramos de fazer
// polling pra não deixar um timer preso indefinidamente numa aba esquecida.
const RESULT_POLL_TIMEOUT_MS = 20 * 60_000

const DEFAULT_SNAPSHOT_POLL_MS = 20_000
const MIN_SNAPSHOT_POLL_MS = 5_000
const MAX_SNAPSHOT_POLL_MS = 60_000

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
  const pollRef = useRef<{ id: ReturnType<typeof setInterval> | null; timeout: ReturnType<typeof setTimeout> | null }>({ id: null, timeout: null })

  const stopPolling = useCallback(() => {
    if (pollRef.current.id) clearInterval(pollRef.current.id)
    if (pollRef.current.timeout) clearTimeout(pollRef.current.timeout)
    pollRef.current = { id: null, timeout: null }
  }, [])
  useEffect(() => stopPolling, [stopPolling])

  // silent=true (polling em segundo plano): não mexe em loading/error, e só
  // troca a referência de `config` se o conteúdo realmente mudou — FullConfigEditor
  // zera os campos não-salvos sempre que `config` muda de referência
  // (ver comentário lá), então recriar o objeto à toa a cada poll apagaria
  // edições em andamento do usuário sem necessidade.
  const load = useCallback((silent = false) => {
    const s = getSettings()
    if (!s.mqttTopicPrefix) {
      setChannel('http')
      if (!silent) setError('Configure o prefixo do receptor em Meu Receptor antes de carregar a configuração.')
      return
    }

    setChannel('http')
    if (!silent) { setLoading(true); setError(null) }
    fetch(`/api/receiver-config/snapshot?prefix=${encodeURIComponent(s.mqttTopicPrefix)}`)
      .then(r => r.json())
      .then((d: { snapshot?: { config: Record<string, string>; updatedAt: number } | null }) => {
        if (!d.snapshot) {
          if (!silent) setError('O receptor ainda não reportou a configuração — precisa acordar pelo menos uma vez com mqtt.siteurl configurado.')
          return
        }
        const cfg = parseConfigJson(d.snapshot.config)
        if (!cfg) { if (!silent) setError('Config recebida em formato inválido'); return }
        if (silent && JSON.stringify(cfg) === JSON.stringify(configRef.current)) {
          setLoadedAt(d.snapshot.updatedAt) // sem mudança de conteúdo, só atualiza o carimbo
          return
        }
        setConfig(cfg)
        setLoadedAt(d.snapshot.updatedAt)
      })
      .catch(() => { if (!silent) setError('Falha ao carregar a configuração') })
      .finally(() => { if (!silent) setLoading(false) })
  }, [])

  // Carrega sozinho uma vez por sessão, assim que o prefixo estiver
  // configurado — hasLoadedRef garante no máximo uma chamada mesmo com o
  // double-invoke do StrictMode em dev. Depois, atualiza sozinho em segundo
  // plano (mesmo cadenciamento do polling de live status).
  useEffect(() => {
    if (hasLoadedRef.current) return
    const s = getSettings()
    if (!s.mqttTopicPrefix) return
    hasLoadedRef.current = true
    load()
  }, [load])

  // Cadência do polling em segundo plano: usa mqtt.report_interval assim que
  // a própria config carrega (não faz sentido checar mais rápido do que o
  // receptor de fato reporta); antes disso, ou se o campo não vier, cai no
  // default.
  const reportIntervalMs = Number(config?.['mqtt.report_interval'])
  const snapshotPollMs = isFinite(reportIntervalMs) && reportIntervalMs > 0
    ? Math.min(MAX_SNAPSHOT_POLL_MS, Math.max(MIN_SNAPSHOT_POLL_MS, reportIntervalMs))
    : DEFAULT_SNAPSHOT_POLL_MS

  useEffect(() => {
    const id = setInterval(() => load(true), snapshotPollMs)
    return () => clearInterval(id)
  }, [load, snapshotPollMs])

  const apply = useCallback((changes: Record<string, string>, mode: 'live' | 'reboot') => {
    const s = getSettings()
    const base = configRef.current
    if (!base) return
    if (!s.rdzConfigSecret.trim()) {
      setApplyError('Defina o segredo de gravação (mqtt.cfgsecret) em Meu Receptor antes de aplicar.')
      return
    }
    setApplying(true)
    setApplyError(null)
    setApplyResult(null)
    stopPolling()

    const reqId = randomReqId()
    const changesJson = JSON.stringify(changes)

    computeCfgAuth(s.rdzConfigSecret, reqId, changesJson)
      .then(auth => fetch('/api/receiver-config/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix: s.mqttTopicPrefix, reqId, auth, apply: mode, changes }),
      }))
      .then(r => r.json())
      .then((d: { ok: boolean; error?: string }) => {
        if (!d.ok) throw new Error(d.error ?? 'Falha ao enfileirar a mudança')

        // Enfileirado — mostra "pendente" já (o receptor pode aplicar em
        // segundos se já estiver acordado, ou só no próximo wake) e começa
        // a fazer polling do resultado.
        setApplying(false)
        setApplyResult({ ok: true, pending: true })

        const deadline = Date.now() + RESULT_POLL_TIMEOUT_MS
        const poll = () => {
          fetch(`/api/receiver-config/result?prefix=${encodeURIComponent(s.mqttTopicPrefix)}&reqId=${reqId}`)
            .then(r => r.json())
            .then((rd: { resolved?: boolean; result?: { ok: boolean; error?: string; rebooting?: boolean } }) => {
              if (!rd.resolved || !rd.result) {
                if (Date.now() > deadline) stopPolling()
                return
              }
              stopPolling()
              if (!rd.result.ok) {
                setApplyResult(null)
                setApplyError(rd.result.error ?? 'O receptor recusou a gravação')
              } else {
                setApplyResult({ ok: true, rebooting: rd.result.rebooting })
                setConfig(prev => prev ? { ...prev, ...changes } : prev)
              }
            })
            .catch(() => {})
        }
        poll()
        pollRef.current.id = setInterval(poll, RESULT_POLL_MS)
        pollRef.current.timeout = setTimeout(stopPolling, RESULT_POLL_TIMEOUT_MS)
      })
      .catch((e: Error) => {
        setApplying(false)
        setApplyError(e.message || 'Falha ao aplicar a configuração')
      })
  }, [stopPolling])

  return { config, loadedAt, loading, error, channel, load, applying, applyError, applyResult, apply }
}
