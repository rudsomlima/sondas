'use client'

import { useMemo } from 'react'
import { ReceiverStatus } from '@/app/lib/sondehub'
import { useReceiverStatus, MyReceiverSonde } from './useReceiverStatus'
import { useReceiverLiveStatus } from './useReceiverLiveStatus'
import type { RdzPower, RdzBoot } from '@/app/lib/mqtt'
import { getSettings } from '@/app/lib/settings'
import { receiverKey as toReceiverKey } from '@/app/lib/receiverKey'
import { usePowerStateHistory, PowerHistoryEntry } from './usePowerStateHistory'
import { useBatteryHistory, BattVoltageEntry } from './useBatteryHistory'
import { deriveSleepState, isReceiverFresh } from '@/app/lib/powerState'
import { useHistorySettings, type HistoryRecording } from './useHistorySettings'

export type { PowerHistoryEntry, BattVoltageEntry }

export type ReceiverSource = 'live' | 'sondehub'

export interface ReceiverState {
  mySondes: MyReceiverSonde[]
  status: ReceiverStatus | null
  checked: boolean
  enabled: boolean
  alertsEnabled: boolean
  source: ReceiverSource // fonte primária ativa agora (informativo de UI)
  liveConfigured: boolean
  liveConnected: boolean
  ttgoBattV: number | null // bateria do TTGO (V) — reporte HTTP direto (última leitura conhecida)
  // Deep sleep v2 do firmware: receptor dormindo de propósito até `until`
  // (epoch ms). Distingue "dormindo" de "morto/offline" no card.
  sleeping: { until: number; reason?: string } | null
  // Escuta estendida: acordado ouvindo um lançamento atrasado (modos A/B/C)
  // até `until`. Diferente de "dormindo" — o receptor está ativo, só esperando.
  waitingLate: { until: number; reason?: string } | null
  // Epoch (ms) do último report HTTP conhecido (pmu/sleep/power) — epoch bruto
  // (não um "há Xs" pré-calculado) para o componente tickar por conta própria
  // a cada segundo, em vez de depender de re-renders de outras partes do app.
  liveLastMessageAt: number | null
  // Estado de energia (CPU/WiFi/economia por bateria crítica) reportado pelo
  // firmware — null se nunca recebido.
  power: RdzPower | null
  // Motivo do reset do boot atual (esp_reset_reason), reportado uma vez por
  // boot — null se nunca recebido. Ver ABNORMAL_RESET_REASONS em mqtt.ts.
  boot: RdzBoot | null
  // Histórico local (localStorage) de transições dormindo/acordado/escutando/
  // economia, pra linha do tempo em app/meu-receptor — ver usePowerStateHistory.
  powerHistory: PowerHistoryEntry[]
  deletePowerHistoryDay: (dayKey: string) => void
  batteryHistory: BattVoltageEntry[]
  deleteBatteryHistoryDay: (dayKey: string) => void
  // Liga/desliga do registro de histórico no servidor (R2), por gráfico.
  historyRecording: HistoryRecording
  setHistoryRecording: (patch: Partial<HistoryRecording>) => void
}

/**
 * Composição híbrida do "meu receptor": reporte HTTP direto do firmware
 * (quando configurado e fresco — ver useReceiverLiveStatus.ts) por cima do
 * polling SondeHub (useReceiverStatus, intocado, fallback autônomo). MQTT
 * (branch mqtt-cfg-only) ficou restrito à configuração remota completa, ver
 * useFirmwareConfig.ts — não alimenta mais este hook.
 *
 * Merge por serial: vence o frame com datetime mais recente. Sem tracking
 * de sonda ao vivo por HTTP (só SondeHub, ~20s) — ver conversa sobre o
 * trade-off ao desligar a telemetria MQTT.
 */
// reportIntervalMs: cadência real do receptor (mqtt.report_interval), quando
// já conhecida (ver meu-receptor/page.tsx) — repassada pro polling de live
// status, pra não checar mais rápido do que o receptor de fato reporta.
export function useReceiver(reportIntervalMs?: number): ReceiverState {
  const sondehub = useReceiverStatus()

  // Chave de armazenamento derivada do prefix ativo (imutável por sessão —
  // troca de receptor exige reload da página).
  const rKey = useMemo(() => toReceiverKey(getSettings().mqttTopicPrefix), [])
  const live = useReceiverLiveStatus(rKey, reportIntervalMs)

  // Fora do useMemo abaixo de propósito: hooks não podem ser chamados de
  // dentro de uma factory de useMemo (regra dos hooks).
  const { sleeping, waitingLate } = useMemo(
    () => deriveSleepState(live.sleepState, Date.now()),
    [live.sleepState]
  )
  const { recording: historyRecording, setRecording: setHistoryRecording } = useHistorySettings(rKey)
  const { history: powerHistory, deleteDay: deletePowerHistoryDay } = usePowerStateHistory(sleeping, waitingLate, live.powerState, live.connected, rKey, historyRecording.power)
  const { history: batteryHistory, deleteDay: deleteBatteryHistoryDay } = useBatteryHistory(live.ttgoBattV, live.connected, rKey, historyRecording.batt, live.lastLiveMessageAt)

  return useMemo(() => {
    const now = Date.now()
    const liveFresh = live.connected && isReceiverFresh(live.lastLiveMessageAt, live.powerState, now)

    const mySondes = sondehub.mySondes

    return {
      mySondes,
      status: sondehub.status,
      checked: sondehub.checked || liveFresh,
      enabled: sondehub.enabled || !!rKey,
      alertsEnabled: sondehub.alertsEnabled,
      source: liveFresh ? 'live' as const : 'sondehub' as const,
      liveConfigured: !!getSettings().mqttTopicPrefix,
      liveConnected: live.connected,
      ttgoBattV: live.ttgoBattV,
      sleeping,
      waitingLate,
      liveLastMessageAt: live.lastLiveMessageAt,
      power: live.powerState,
      boot: live.bootState,
      powerHistory,
      deletePowerHistoryDay,
      batteryHistory,
      deleteBatteryHistoryDay,
      historyRecording,
      setHistoryRecording,
    }
  }, [sondehub, live, rKey, sleeping, waitingLate, powerHistory, deletePowerHistoryDay, batteryHistory, deleteBatteryHistoryDay, historyRecording, setHistoryRecording])
}
