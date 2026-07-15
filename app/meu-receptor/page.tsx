'use client'

import { useEffect, useRef, useState } from 'react'
import { Antenna, Loader2, Plus, Radio, RotateCw, XCircle } from 'lucide-react'
import { AppSettings, DEFAULT_SETTINGS, KnownReceiver, getSettings, setSettings } from '@/app/lib/settings'
import { receiverKey } from '@/app/lib/receiverKey'
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
  const [importedToast, setImportedToast] = useState<string | null>(null)
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

  // Auto-preenche callsign e posição de casa a partir da config do firmware
  const autoFillDone = useRef(false)
  useEffect(() => {
    if (!firmwareConfig.config || autoFillDone.current) return
    autoFillDone.current = true
    const fwCallsign = String(firmwareConfig.config['sondehub.callsign'] ?? '').trim()
    const fwLat = parseFloat(String(firmwareConfig.config['rxlat'] ?? ''))
    const fwLon = parseFloat(String(firmwareConfig.config['rxlon'] ?? ''))
    setConfigState(prev => {
      const next = { ...prev }
      const msgs: string[] = []
      if (fwCallsign && !prev.uploaderCallsign) {
        next.uploaderCallsign = fwCallsign
        msgs.push('callsign')
      }
      if (isFinite(fwLat) && isFinite(fwLon) && prev.homeLat === null) {
        next.homeLat = fwLat
        next.homeLon = fwLon
        msgs.push('posição')
      }
      if (msgs.length > 0) {
        setSettings(next)
        setImportedToast(`${msgs.join(' e ')} importado${msgs.length > 1 ? 's' : ''} do firmware`)
        setTimeout(() => setImportedToast(null), 3500)
      }
      return next
    })
  }, [firmwareConfig.config])

  // Auto-adiciona receptores descobertos via MQTT à lista de conhecidos
  useEffect(() => {
    if (receiver.discoveredReceivers.size === 0) return
    setConfigState(prev => {
      const existing = new Set(prev.knownReceivers.map(r => r.prefix))
      const toAdd: KnownReceiver[] = []
      for (const dr of receiver.discoveredReceivers.values()) {
        if (!existing.has(dr.prefix)) {
          toAdd.push({
            prefix:      dr.prefix,
            displayName: dr.uptime.user || dr.prefix,
            addedAt:     Date.now(),
          })
        }
      }
      if (toAdd.length === 0) return prev
      const next = { ...prev, knownReceivers: [...prev.knownReceivers, ...toAdd] }
      setSettings(next)
      return next
    })
  }, [receiver.discoveredReceivers])

  // Garante que o receptor ativo também está na lista de conhecidos
  useEffect(() => {
    if (!config.mqttTopicPrefix) return
    const prefix = config.mqttTopicPrefix
    if (config.knownReceivers.some(r => r.prefix === prefix)) return
    setConfigState(prev => {
      const next = {
        ...prev,
        knownReceivers: [...prev.knownReceivers, {
          prefix,
          displayName: prev.uploaderCallsign || prefix,
          addedAt: Date.now(),
        }],
      }
      setSettings(next)
      return next
    })
  }, [config.mqttTopicPrefix, config.knownReceivers, config.uploaderCallsign])

  const handlePickChannel = (channel: RdzConfigChannel) => {
    setConfigState(c => {
      const next = { ...c, rdzConfigChannel: channel }
      setSettings(next)
      return next
    })
    firmwareConfig.load(channel)
  }

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

  // Remove um receptor da lista (não apaga os dados do R2)
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
  }

  const effectiveConfig: RdzConfig | null = firmwareConfig.config
    ? (sleepDraft ? { ...firmwareConfig.config, ...sleepDraft } : firmwareConfig.config)
    : null

  const activePrefix = config.mqttTopicPrefix
  const knownReceivers = config.knownReceivers

  // Receptores descobertos mas ainda não confirmados como "conhecidos"
  const newlyDiscovered = [...receiver.discoveredReceivers.values()].filter(
    dr => !knownReceivers.some(kr => kr.prefix === dr.prefix)
  )

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

      {/* ── Seletor de receptor ─────────────────────────────────────── */}
      {knownReceivers.length > 1 && (
        <div className="mb-6 panel p-4">
          <p className="text-[10px] text-faint uppercase tracking-wide mb-2">Receptores conhecidos</p>
          <div className="flex flex-wrap gap-2">
            {knownReceivers.map(kr => {
              const isActive = kr.prefix === activePrefix
              const discovered = receiver.discoveredReceivers.get(kr.prefix)
              return (
                <button
                  key={kr.prefix}
                  onClick={() => !isActive && switchReceiver(kr.prefix)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs transition-all ${
                    isActive
                      ? 'bg-blue-600/30 border-blue-500/60 text-blue-200 cursor-default'
                      : 'border-border text-gray-400 hover:text-white hover:border-border-strong'
                  }`}
                  title={`prefix: ${kr.prefix}\nkey: ${receiverKey(kr.prefix)}`}
                >
                  {discovered && (
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" title="Online agora" />
                  )}
                  {kr.displayName}
                  {isActive && <span className="text-[9px] text-blue-400 ml-0.5">ativo</span>}
                </button>
              )
            })}
          </div>
          {knownReceivers.length > 0 && (
            <p className="text-[10px] text-faint mt-2">
              Trocar de receptor recarrega a página para carregar os dados corretos.
              Cada receptor mantém seu histórico separado (localStorage + R2).
            </p>
          )}
        </div>
      )}

      {importedToast && (
        <div className="mb-4 px-4 py-2.5 bg-emerald-900/40 border border-emerald-600/40 rounded-md text-xs text-emerald-300 flex items-center gap-2">
          <span className="text-emerald-400">✓</span> {importedToast}
        </div>
      )}

      <ReceiverSettingsPanel
        config={config}
        setConfig={setConfig}
        onSave={handleSave}
        saved={saved}
        rxPosition={receiver.rxPosition}
        knownReceivers={knownReceivers}
        onRenameReceiver={renameReceiver}
        onForgetReceiver={forgetReceiver}
        onSwitchReceiver={switchReceiver}
      />

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

      {/* Receptores descobertos na rede mas ainda não na lista */}
      {(newlyDiscovered.length > 0 || receiver.discoveredReceivers.size > 0) && (
        <div className="panel p-5 mb-6">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
            <Radio size={14} className="text-cyan-400" />
            Outros receptores na rede
            <span className="ml-1 px-1.5 py-0.5 bg-cyan-900/40 text-cyan-300 rounded text-[10px]">
              {receiver.discoveredReceivers.size}
            </span>
          </h2>
          <div className="space-y-2">
            {[...receiver.discoveredReceivers.values()].map(dr => {
              const isKnown = knownReceivers.some(kr => kr.prefix === dr.prefix)
              return (
                <div key={dr.prefix} className="flex flex-wrap items-center gap-3 border border-border rounded-md px-3 py-2.5 bg-bg text-xs">
                  <div className="flex-1 min-w-0">
                    <p className="text-white mono font-medium truncate">{dr.uptime.user || dr.prefix}</p>
                    <p className="text-faint mt-0.5 font-mono text-[10px]">
                      prefixo: <span className="text-gray-400">{dr.prefix}</span>
                      {dr.uptime.ip && <> · IP: <span className="text-gray-400">{dr.uptime.ip}</span></>}
                      {dr.uptime.rxlat !== undefined && (
                        <> · {dr.uptime.rxlat.toFixed(4)}, {dr.uptime.rxlon?.toFixed(4)}</>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {!isKnown && (
                      <button
                        onClick={() => {
                          setConfigState(prev => {
                            const next = {
                              ...prev,
                              knownReceivers: [...prev.knownReceivers, {
                                prefix:      dr.prefix,
                                displayName: dr.uptime.user || dr.prefix,
                                addedAt:     Date.now(),
                              }],
                            }
                            setSettings(next)
                            return next
                          })
                        }}
                        className="px-2.5 py-1 bg-surface border border-border text-gray-400 rounded text-[10px] hover:text-white transition-colors"
                        title="Adicionar à lista sem trocar o receptor ativo"
                      >
                        <Plus size={11} className="inline mr-1" />
                        Adicionar
                      </button>
                    )}
                    <button
                      onClick={() => switchReceiver(dr.prefix)}
                      className="px-2.5 py-1 bg-cyan-600/20 border border-cyan-500/40 text-cyan-300 rounded text-[10px] hover:bg-cyan-600/30 transition-colors"
                    >
                      Usar este receptor
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
