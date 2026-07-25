'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getSettings } from '@/app/lib/settings'
import { computeCfgAuth, randomReqId } from '@/app/lib/cfgAuth'

// Canal irmão de useFirmwareConfig.ts, mas carregando o texto bruto do
// arquivo de telas ativo (screens1.txt) em vez de chave=valor estruturado —
// mesmo desenho (fila em R2, receptor busca sozinho), ver
// app/api/receiver-screens/{snapshot,request,result} e conn-cfg.cpp no
// firmware (reportScreensSnapshot/checkPendingScreens).
export interface ScreensConfigState {
  text: string | null
  loadedAt: number | null
  loading: boolean
  error: string | null
  load: () => void
  applying: boolean
  applyError: string | null
  applyResult: { ok: boolean; pending?: boolean } | null
  apply: (text: string) => void
}

const RESULT_POLL_MS = 15_000
const RESULT_POLL_TIMEOUT_MS = 20 * 60_000

export function useScreensConfig(): ScreensConfigState {
  const [text, setText] = useState<string | null>(null)
  const [loadedAt, setLoadedAt] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [applyResult, setApplyResult] = useState<{ ok: boolean; pending?: boolean } | null>(null)
  const hasLoadedRef = useRef(false)
  const pollRef = useRef<{ id: ReturnType<typeof setInterval> | null; timeout: ReturnType<typeof setTimeout> | null }>({ id: null, timeout: null })

  const stopPolling = useCallback(() => {
    if (pollRef.current.id) clearInterval(pollRef.current.id)
    if (pollRef.current.timeout) clearTimeout(pollRef.current.timeout)
    pollRef.current = { id: null, timeout: null }
  }, [])
  useEffect(() => stopPolling, [stopPolling])

  const load = useCallback(() => {
    const s = getSettings()
    if (!s.mqttTopicPrefix) {
      setError('Configure o prefixo do receptor em Meu Receptor antes de carregar as telas.')
      return
    }
    setLoading(true)
    setError(null)
    fetch(`/api/receiver-screens/snapshot?prefix=${encodeURIComponent(s.mqttTopicPrefix)}`)
      .then(r => r.json())
      .then((d: { snapshot?: { text: string; updatedAt: number } | null }) => {
        if (!d.snapshot) {
          setError('O receptor ainda não reportou o arquivo de telas — precisa acordar pelo menos uma vez com mqtt.siteurl configurado.')
          return
        }
        setText(d.snapshot.text)
        setLoadedAt(d.snapshot.updatedAt)
      })
      .catch(() => setError('Falha ao carregar o arquivo de telas'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (hasLoadedRef.current) return
    const s = getSettings()
    if (!s.mqttTopicPrefix) return
    hasLoadedRef.current = true
    load()
  }, [load])

  const apply = useCallback((newText: string) => {
    const s = getSettings()
    if (!s.mqttTopicPrefix) { setApplyError('Configure o prefixo do receptor antes de aplicar.'); return }
    if (!s.rdzConfigSecret.trim()) {
      setApplyError('Defina o segredo de gravação (mqtt.cfgsecret) em Meu Receptor antes de aplicar.')
      return
    }
    setApplying(true)
    setApplyError(null)
    setApplyResult(null)
    stopPolling()

    const reqId = randomReqId()

    computeCfgAuth(s.rdzConfigSecret, reqId, newText)
      .then(auth => fetch('/api/receiver-screens/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix: s.mqttTopicPrefix, reqId, auth, text: newText }),
      }))
      .then(r => r.json())
      .then((d: { ok: boolean; error?: string }) => {
        if (!d.ok) throw new Error(d.error ?? 'Falha ao enfileirar a mudança')

        setApplying(false)
        setApplyResult({ ok: true, pending: true })

        const deadline = Date.now() + RESULT_POLL_TIMEOUT_MS
        const poll = () => {
          fetch(`/api/receiver-screens/result?prefix=${encodeURIComponent(s.mqttTopicPrefix)}&reqId=${reqId}`)
            .then(r => r.json())
            .then((rd: { resolved?: boolean; result?: { ok: boolean; error?: string } }) => {
              if (!rd.resolved || !rd.result) {
                if (Date.now() > deadline) stopPolling()
                return
              }
              stopPolling()
              if (!rd.result.ok) {
                setApplyResult(null)
                setApplyError(rd.result.error ?? 'O receptor recusou a gravação')
              } else {
                setApplyResult({ ok: true })
                setText(newText)
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
        setApplyError(e.message || 'Falha ao aplicar as telas')
      })
  }, [stopPolling])

  return { text, loadedAt, loading, error, load, applying, applyError, applyResult, apply }
}
