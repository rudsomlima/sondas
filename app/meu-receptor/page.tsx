'use client'

import { useCallback, useEffect, useState } from 'react'
import { Antenna, Loader2, RotateCw, XCircle } from 'lucide-react'
import { AppSettings, DEFAULT_SETTINGS, KnownReceiver, getSettings, setSettings } from '@/app/lib/settings'
import { receiverKey } from '@/app/lib/receiverKey'
import { useReceiver } from '../painel/hooks/useReceiver'
import { useFirmwareConfig } from './hooks/useFirmwareConfig'
import ReceiverSettingsPanel from './components/ReceiverSettingsPanel'
import FullConfigEditor from './components/FullConfigEditor'
import PowerTimeline from './components/PowerTimeline'
import BatteryChart from './components/BatteryChart'
import FirmwareOtaPanel from './components/FirmwareOtaPanel'
import BootLogPanel from './components/BootLogPanel'
import PowerBoostPanel from './components/PowerBoostPanel'
import ReceptionQualityPanel from './components/ReceptionQualityPanel'
import { CollapsibleSection } from './components/Collapsible'
import type { RdzConfig } from '@/app/lib/rdzConfig'

export default function MeuReceptorPage() {
  const [config, setConfigState] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [powerDraft, setPowerDraft] = useState<Record<string, string> | null>(null)

  useEffect(() => { setConfigState(getSettings()) }, [])

  // Grava na hora (localStorage) — o painel "Meu receptor" não tem mais botão
  // "Salvar", igual ao resto da página. Parte sempre do que está gravado, não
  // do estado React, pra não sobrescrever o que outro trecho acabou de gravar.
  const updateSettings = useCallback((updater: (s: AppSettings) => AppSettings) => {
    const next = updater(getSettings())
    setSettings(next)
    setConfigState(next)
  }, [])

  const firmwareConfig = useFirmwareConfig()
  // Cadência real do receptor (mqtt.report_interval, ms) — quando a config já
  // carregou, usa ela pro polling de live status em vez do default fixo (não
  // faz sentido checar mais rápido do que ele de fato reporta).
  const reportIntervalMs = firmwareConfig.config?.['mqtt.report_interval']
    ? Number(firmwareConfig.config['mqtt.report_interval'])
    : undefined
  const receiver = useReceiver(reportIntervalMs && isFinite(reportIntervalMs) ? reportIntervalMs : undefined)

  // Callsign e posição têm uma fonte só: o firmware (sondehub.callsign,
  // rxlat/rxlon). Sempre que a config dele carrega/muda, espelha nas
  // preferências do app (que o /painel usa) — o painel "Meu receptor" só deixa
  // editar esses campos quando o firmware não os informa.
  useEffect(() => {
    const fw = firmwareConfig.config
    if (!fw) return
    const fwCallsign = String(fw['sondehub.callsign'] ?? '').trim()
    const fwLat = parseFloat(String(fw['rxlat'] ?? ''))
    const fwLon = parseFloat(String(fw['rxlon'] ?? ''))
    const fwHasPosition = isFinite(fwLat) && isFinite(fwLon) && !(fwLat === 0 && fwLon === 0)
    const cur = getSettings()
    const callsignDiffers = !!fwCallsign && fwCallsign !== cur.uploaderCallsign
    const positionDiffers = fwHasPosition && (cur.homeLat !== fwLat || cur.homeLon !== fwLon)
    if (!callsignDiffers && !positionDiffers) return
    updateSettings(s => ({
      ...s,
      uploaderCallsign: callsignDiffers ? fwCallsign : s.uploaderCallsign,
      homeLat: positionDiffers ? fwLat : s.homeLat,
      homeLon: positionDiffers ? fwLon : s.homeLon,
    }))
  }, [firmwareConfig.config, updateSettings])

  // Auto-descoberta via reporte HTTP direto (/api/receiver-report) — QUALQUER
  // receptor que já tenha mqtt.siteurl configurado (necessário pro
  // auto-OTA/persistência, ver conn-report.cpp) aparece aqui sozinho assim
  // que reporta algo, sem precisar de MQTT nem de cadastro manual. Roda uma
  // vez ao abrir a página; server-side é barato (1 GET pequeno do R2).
  useEffect(() => {
    fetch('/api/known-receivers')
      .then(r => r.json())
      .then((d: { entries?: { prefix: string }[] }) => {
        const found = d.entries ?? []
        if (found.length === 0) return
        setConfigState(prev => {
          const existing = new Set(prev.knownReceivers.map(r => r.prefix))
          const toAdd: KnownReceiver[] = found
            .filter(e => !existing.has(e.prefix))
            .map(e => ({ prefix: e.prefix, displayName: e.prefix, addedAt: Date.now() }))
          if (toAdd.length === 0) return prev
          const next = { ...prev, knownReceivers: [...prev.knownReceivers, ...toAdd] }
          setSettings(next)
          return next
        })
      })
      .catch(() => {})
  }, [])

  // Troca o receptor ativo: atualiza mqttTopicPrefix → salva → recarrega
  const switchReceiver = (prefix: string) => {
    const next = { ...config, mqttTopicPrefix: prefix }
    setSettings(next)
    window.location.reload()
  }

  // Atualiza o displayName de um receptor na lista
  const renameReceiver = (prefix: string, displayName: string) => {
    setConfigState(prev => {
      const next = {
        ...prev,
        knownReceivers: prev.knownReceivers.map(r =>
          r.prefix === prefix ? { ...r, displayName } : r
        ),
      }
      setSettings(next)
      return next
    })
  }

  // Remove um receptor da lista local e do discovery list no servidor
  // (known-receivers.json) — não apaga histórico power/batt no R2 (ver
  // R2Panel "Apagar histórico" pra isso). A remoção local é imediata e
  // incondicional; a chamada ao servidor é fire-and-forget, mesmo padrão do
  // useEffect de auto-descoberta acima — sem ela, o próximo carregamento da
  // página re-adiciona o prefix de volta a partir do known-receivers.json.
  const forgetReceiver = (prefix: string) => {
    setConfigState(prev => {
      const next = {
        ...prev,
        knownReceivers: prev.knownReceivers.filter(r => r.prefix !== prefix),
        mqttTopicPrefix: prev.mqttTopicPrefix === prefix ? '' : prev.mqttTopicPrefix,
      }
      setSettings(next)
      return next
    })
    fetch(`/api/known-receivers?prefix=${encodeURIComponent(prefix)}`, { method: 'DELETE' }).catch(() => {})
  }

  // Cadastro manual (receptor que ainda não reportou): entra na lista e vira o
  // ativo — recarrega, como a troca de receptor.
  const addReceiver = (prefix: string) => {
    const cur = getSettings()
    const next: AppSettings = {
      ...cur,
      mqttTopicPrefix: prefix,
      knownReceivers: cur.knownReceivers.some(r => r.prefix === prefix)
        ? cur.knownReceivers
        : [...cur.knownReceivers, { prefix, displayName: prefix, addedAt: Date.now() }],
    }
    setSettings(next)
    window.location.reload()
  }

  const scrollToFirmwareConfig = () => {
    document.getElementById('config-completa')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const effectiveConfig: RdzConfig | null = firmwareConfig.config
    ? (powerDraft ? { ...firmwareConfig.config, ...powerDraft } : firmwareConfig.config)
    : null

  const activePrefix = config.mqttTopicPrefix
  const knownReceivers = config.knownReceivers

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Antenna size={22} className="text-blue-400" />
          Meu Receptor
        </h1>
        <p className="text-gray-400 text-sm mt-1">
          Configurações do rdzTTGOsonde, firmware e histórico de energia
        </p>
      </div>

      {/* Cada painel pode ser recolhido pelo título; a escolha fica salva
          no navegador (Collapsible.tsx). */}
      <CollapsibleSection id="receptor">
      <ReceiverSettingsPanel
        settings={config}
        updateSettings={updateSettings}
        firmwareConfig={firmwareConfig.config}
        knownReceivers={knownReceivers}
        onRenameReceiver={renameReceiver}
        onForgetReceiver={forgetReceiver}
        onSwitchReceiver={switchReceiver}
        onAddReceiver={addReceiver}
        onEditFirmwareConfig={scrollToFirmwareConfig}
      />
      </CollapsibleSection>

      {firmwareConfig.loading && (
        <div className="panel p-5 mb-6 flex items-center gap-2 text-sm text-gray-400">
          <Loader2 size={14} className="animate-spin" /> Carregando configuração do receptor…
        </div>
      )}

      {firmwareConfig.error && !firmwareConfig.loading && (
        <div className="panel p-5 mb-6">
          <p className="text-sm text-red-400 flex items-center gap-2">
            <XCircle size={14} /> {firmwareConfig.error}
          </p>
          <button
            onClick={() => firmwareConfig.load()}
            className="mt-3 flex items-center gap-2 px-3 py-2 bg-surface border border-border rounded-md text-xs text-gray-400 hover:text-white transition-all"
          >
            <RotateCw size={12} /> Tentar de novo
          </button>
        </div>
      )}

      {activePrefix && (
        <CollapsibleSection id="turbo">
          <PowerBoostPanel
            power={receiver.power}
            reportMin={firmwareConfig.config?.['power.report_min'] ? Number(firmwareConfig.config['power.report_min']) || null : null}
          />
        </CollapsibleSection>
      )}

      {firmwareConfig.config && (
        <div id="config-completa" className="scroll-mt-4">
          <CollapsibleSection id="config">
          <FullConfigEditor
            config={firmwareConfig.config}
            loadedAt={firmwareConfig.loadedAt}
            applying={firmwareConfig.applying}
            applyError={firmwareConfig.applyError}
            applyResult={firmwareConfig.applyResult}
            onApply={firmwareConfig.apply}
            onPowerChanges={setPowerDraft}
          />
          </CollapsibleSection>
        </div>
      )}

      {/* Diagnóstico de antena/recepção: posição e callsign vêm do firmware
          (espelhados nas preferências acima); rxalt é a altitude do receptor. */}
      <CollapsibleSection id="recepcao">
        <ReceptionQualityPanel
          callsign={config.uploaderCallsign}
          rxLat={config.homeLat ?? null}
          rxLon={config.homeLon ?? null}
          rxAltM={Number(firmwareConfig.config?.['rxalt'] ?? 0) || 0}
        />
      </CollapsibleSection>

      <CollapsibleSection id="firmware">
        <FirmwareOtaPanel receiverKey={receiverKey(activePrefix)} pollMs={reportIntervalMs} />
      </CollapsibleSection>

      {activePrefix && (
        <CollapsibleSection id="reinicios">
          <BootLogPanel receiverKey={receiverKey(activePrefix)} />
        </CollapsibleSection>
      )}

      <CollapsibleSection id="bateria">
      <BatteryChart
        history={receiver.batteryHistory}
        config={effectiveConfig}
        onDeleteDay={receiver.deleteBatteryHistoryDay}
        recording={receiver.historyRecording.batt}
        onRecordingChange={v => receiver.setHistoryRecording({ batt: v })}
      />
      </CollapsibleSection>

      <CollapsibleSection id="energia">
      <PowerTimeline
        history={receiver.powerHistory}
        config={effectiveConfig}
        mqttConnected={receiver.liveConnected}
        onDeleteDay={receiver.deletePowerHistoryDay}
        recording={receiver.historyRecording.power}
        onRecordingChange={v => receiver.setHistoryRecording({ power: v })}
      />
      </CollapsibleSection>
    </div>
  )
}
