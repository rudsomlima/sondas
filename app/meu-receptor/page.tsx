'use client'

import { useEffect, useState } from 'react'
import { Antenna, Loader2, RotateCw, XCircle } from 'lucide-react'
import { AppSettings, DEFAULT_SETTINGS, getSettings, setSettings } from '@/app/lib/settings'
import { useReceiver } from '../painel/hooks/useReceiver'
import { useFirmwareConfig, RdzConfigChannel } from './hooks/useFirmwareConfig'
import ReceiverSettingsPanel from './components/ReceiverSettingsPanel'
import ChannelPicker from './components/ChannelPicker'
import FullConfigEditor from './components/FullConfigEditor'
import PowerTimeline from './components/PowerTimeline'
import BatteryChart from './components/BatteryChart'
import type { RdzConfig } from '@/app/lib/rdzConfig'

export default function MeuReceptorPage() {
  const [config, setConfigState] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [saved, setSaved] = useState(false)
  // Campos de deep sleep editados mas ainda não aplicados — previsualização
  // em tempo real no gráfico sem precisar apertar "Aplicar".
  const [sleepDraft, setSleepDraft] = useState<Record<string, string> | null>(null)

  useEffect(() => { setConfigState(getSettings()) }, [])

  const setConfig = (updater: (c: AppSettings) => AppSettings) => setConfigState(updater)

  const handleSave = () => {
    setSettings(config)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  const receiver = useReceiver()
  const firmwareConfig = useFirmwareConfig(receiver.receiverIp)

  const handlePickChannel = (channel: RdzConfigChannel) => {
    setConfigState(c => {
      const next = { ...c, rdzConfigChannel: channel }
      setSettings(next)
      return next
    })
    firmwareConfig.load(channel)
  }

  // Mescla o rascunho de campos sleep com a config carregada para o gráfico
  const effectiveConfig: RdzConfig | null = firmwareConfig.config
    ? (sleepDraft ? { ...firmwareConfig.config, ...sleepDraft } : firmwareConfig.config)
    : null

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Antenna size={22} className="text-blue-400" />
          Meu Receptor
        </h1>
        <p className="text-gray-400 text-sm mt-1">
          Configurações do seu rdzTTGOsonde, config completa do firmware e histórico de energia
        </p>
      </div>

      <ReceiverSettingsPanel config={config} setConfig={setConfig} onSave={handleSave} saved={saved} />

      <ChannelPicker
        config={config}
        setConfig={setConfig}
        httpBlocked={firmwareConfig.httpBlocked}
        receiverIp={receiver.receiverIp}
        channel={firmwareConfig.channel}
        onPick={handlePickChannel}
      />

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
          {firmwareConfig.channel && (
            <button
              onClick={() => firmwareConfig.load(firmwareConfig.channel!)}
              className="mt-3 flex items-center gap-2 px-3 py-2 bg-surface border border-border rounded-md text-xs text-gray-400 hover:text-white transition-all"
            >
              <RotateCw size={12} /> Tentar de novo
            </button>
          )}
        </div>
      )}

      {firmwareConfig.config && (
        <FullConfigEditor
          config={firmwareConfig.config}
          loadedAt={firmwareConfig.loadedAt}
          applying={firmwareConfig.applying}
          applyError={firmwareConfig.applyError}
          applyResult={firmwareConfig.applyResult}
          onApply={firmwareConfig.apply}
          onSleepChanges={setSleepDraft}
        />
      )}

      <BatteryChart
        history={receiver.batteryHistory}
        config={effectiveConfig}
        onDeleteDay={receiver.deleteBatteryHistoryDay}
      />

      <PowerTimeline
        history={receiver.powerHistory}
        config={effectiveConfig}
        mqttConnected={receiver.mqttConnected}
        onDeleteDay={receiver.deletePowerHistoryDay}
      />
    </div>
  )
}
