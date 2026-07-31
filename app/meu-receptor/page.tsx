'use client'

import { useEffect, useRef, useState } from 'react'
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
import type { RdzConfig } from '@/app/lib/rdzConfig'

export default function MeuReceptorPage() {
  const [config, setConfigState] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [saved, setSaved] = useState(false)
  const [importedToast, setImportedToast] = useState<string | null>(null)
  const [sleepDraft, setSleepDraft] = useState<Record<string, string> | null>(null)

  useEffect(() => { setConfigState(getSettings()) }, [])

  const setConfig = (updater: (c: AppSettings) => AppSettings) => setConfigState(updater)

  // Garante que o receptor ativo (mqttTopicPrefix) também está na lista de
  // conhecidos — só ao salvar explicitamente, não a cada tecla digitada no
  // campo de prefixo (um useEffect ligado a config.mqttTopicPrefix rodava a
  // cada onChange do input controlado, cadastrando cada valor PARCIAL
  // digitado — "p", "pu", "pu7"… — como um receptor separado, poluindo a
  // lista em vez de só adicionar o valor final).
  const handleSave = () => {
    const prefix = config.mqttTopicPrefix
    const next = prefix && !config.knownReceivers.some(r => r.prefix === prefix)
      ? { ...config, knownReceivers: [...config.knownReceivers, {
          prefix, displayName: config.uploaderCallsign || prefix, addedAt: Date.now(),
        }] }
      : config
    if (next !== config) setConfigState(next)
    setSettings(next)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  const firmwareConfig = useFirmwareConfig()
  // Cadência real do receptor (mqtt.report_interval, ms) — quando a config já
  // carregou, usa ela pro polling de live status em vez do default fixo (não
  // faz sentido checar mais rápido do que ele de fato reporta).
  const reportIntervalMs = firmwareConfig.config?.['mqtt.report_interval']
    ? Number(firmwareConfig.config['mqtt.report_interval'])
    : undefined
  const receiver = useReceiver(reportIntervalMs && isFinite(reportIntervalMs) ? reportIntervalMs : undefined)

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

  const effectiveConfig: RdzConfig | null = firmwareConfig.config
    ? (sleepDraft ? { ...firmwareConfig.config, ...sleepDraft } : firmwareConfig.config)
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

      {/* ── Seletor de receptor ─────────────────────────────────────── */}
      {knownReceivers.length > 1 && (
        <div className="mb-6 panel p-4">
          <p className="text-[10px] text-faint uppercase tracking-wide mb-2">Receptores conhecidos</p>
          <div className="flex flex-wrap gap-2">
            {knownReceivers.map(kr => {
              const isActive = kr.prefix === activePrefix
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
        knownReceivers={knownReceivers}
        onRenameReceiver={renameReceiver}
        onForgetReceiver={forgetReceiver}
        onSwitchReceiver={switchReceiver}
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
          <button
            onClick={() => firmwareConfig.load()}
            className="mt-3 flex items-center gap-2 px-3 py-2 bg-surface border border-border rounded-md text-xs text-gray-400 hover:text-white transition-all"
          >
            <RotateCw size={12} /> Tentar de novo
          </button>
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

      <FirmwareOtaPanel receiverKey={receiverKey(activePrefix)} pollMs={reportIntervalMs} />

      <BatteryChart
        history={receiver.batteryHistory}
        config={effectiveConfig}
        onDeleteDay={receiver.deleteBatteryHistoryDay}
      />

      <PowerTimeline
        history={receiver.powerHistory}
        config={effectiveConfig}
        mqttConnected={receiver.liveConnected}
        onDeleteDay={receiver.deletePowerHistoryDay}
      />
    </div>
  )
}
