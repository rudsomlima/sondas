'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export interface HistoryRecording {
  batt: boolean
  power: boolean
}

export interface UseHistorySettingsResult {
  recording: HistoryRecording
  loaded: boolean
  setRecording: (patch: Partial<HistoryRecording>) => void
}

/**
 * Liga/desliga do registro de histórico (bateria / energia) de um receptor —
 * preferência gravada no R2 e respeitada pelo servidor ao receber reportes
 * (ver app/api/receiver-history/settings e receiverCollect.ts). Otimista: a
 * UI muda na hora e volta se o servidor recusar.
 */
export function useHistorySettings(receiverKey: string): UseHistorySettingsResult {
  const [recording, setRecordingState] = useState<HistoryRecording>({ batt: true, power: true })
  const [loaded, setLoaded] = useState(false)
  const currentRef = useRef(recording)
  currentRef.current = recording

  useEffect(() => {
    if (!receiverKey) return
    fetch(`/api/receiver-history/settings?key=${encodeURIComponent(receiverKey)}`)
      .then(r => r.json())
      .then((d: { settings?: HistoryRecording }) => { if (d.settings) setRecordingState(d.settings) })
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [receiverKey])

  const setRecording = useCallback((patch: Partial<HistoryRecording>) => {
    const previous = currentRef.current
    setRecordingState({ ...previous, ...patch })
    fetch(`/api/receiver-history/settings?key=${encodeURIComponent(receiverKey)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
      .then(r => r.json())
      .then((d: { ok: boolean; settings?: HistoryRecording }) => {
        if (d.ok && d.settings) setRecordingState(d.settings)
        else setRecordingState(previous)
      })
      .catch(() => setRecordingState(previous))
  }, [receiverKey])

  return { recording, loaded, setRecording }
}
