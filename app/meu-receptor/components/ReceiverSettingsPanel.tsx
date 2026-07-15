'use client'

import { useEffect, useState } from 'react'
import { RadioTower, LocateFixed, Save, CheckCircle2 } from 'lucide-react'
import type { AppSettings } from '@/app/lib/settings'

interface ReceiverSettingsPanelProps {
  config: AppSettings
  setConfig: (updater: (c: AppSettings) => AppSettings) => void
  onSave: () => void
  saved: boolean
}

// Bloco "Meu receptor" — movido de app/configuracoes/page.tsx pra esta
// página dedicada (callsign/posição/raio de alerta/notificações + MQTT de
// status), sem mudança de comportamento, só de localização.
export default function ReceiverSettingsPanel({ config, setConfig, onSave, saved }: ReceiverSettingsPanelProps) {
  // Lido só no efeito (não no useState inicial): Notification não existe no
  // servidor, então calcular isso direto na primeira renderização faz o HTML
  // do server ('unsupported') divergir do primeiro render do client (valor
  // real) e quebra a hidratação. Mesmo padrão do configuracoes/page.tsx original.
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | 'unsupported'>('default')
  useEffect(() => {
    setNotifPermission(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported')
  }, [])
  const [locating, setLocating] = useState(false)

  const useMyLocation = () => {
    if (!navigator.geolocation) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      pos => {
        setConfig(c => ({
          ...c,
          homeLat: Number(pos.coords.latitude.toFixed(5)),
          homeLon: Number(pos.coords.longitude.toFixed(5)),
        }))
        setLocating(false)
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 15000 }
    )
  }

  const toggleAlerts = async () => {
    if (config.receiverAlertsEnabled) {
      setConfig(c => ({ ...c, receiverAlertsEnabled: false }))
      return
    }
    if (typeof Notification === 'undefined') return
    let permission = Notification.permission
    if (permission === 'default') {
      try { permission = await Notification.requestPermission() } catch { permission = 'denied' }
    }
    setNotifPermission(permission)
    if (permission === 'granted') setConfig(c => ({ ...c, receiverAlertsEnabled: true }))
  }

  return (
    <div className="panel p-5 mb-6">
      <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-1">
        <RadioTower size={14} className="text-blue-400" />
        Meu receptor
      </h2>
      <p className="text-[11px] text-faint mb-4">
        Se você tem um receptor (rdzTTGOsonde, auto_rx) enviando ao SondeHub, informe o
        callsign de uploader para acompanhar no painel as sondas que ELE está decodificando.
      </p>

      <label className="block text-xs text-gray-400 mb-1.5">Callsign de uploader no SondeHub</label>
      <input
        type="text"
        value={config.uploaderCallsign}
        onChange={e => setConfig(c => ({ ...c, uploaderCallsign: e.target.value }))}
        placeholder="ex.: PU7ABC ou MEU-RDZ"
        className="w-full max-w-xs bg-bg border border-border rounded-md text-sm text-white mono px-3 py-2 outline-none focus:border-blue-500"
      />
      <p className="text-[11px] text-faint mt-1.5 mb-4">
        Exatamente como configurado no firmware (campo &quot;SondeHub callsign&quot;) — é como
        seus frames aparecem em sondehub.org.
      </p>

      <label className="block text-xs text-gray-400 mb-1.5">
        Posição de casa (centro da busca por sondas próximas) — <strong>obrigatória</strong> junto
        com o callsign para a via SondeHub funcionar (o MQTT abaixo não depende disso)
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="number"
          step="0.00001"
          value={config.homeLat ?? ''}
          onChange={e => setConfig(c => ({ ...c, homeLat: e.target.value === '' ? null : Number(e.target.value) }))}
          placeholder="Latitude"
          className="w-32 bg-bg border border-border rounded-md text-sm text-white mono px-3 py-2 outline-none focus:border-blue-500"
        />
        <input
          type="number"
          step="0.00001"
          value={config.homeLon ?? ''}
          onChange={e => setConfig(c => ({ ...c, homeLon: e.target.value === '' ? null : Number(e.target.value) }))}
          placeholder="Longitude"
          className="w-32 bg-bg border border-border rounded-md text-sm text-white mono px-3 py-2 outline-none focus:border-blue-500"
        />
        <button
          onClick={useMyLocation}
          disabled={locating}
          className="flex items-center gap-1.5 px-3 py-2 bg-surface border border-border rounded-md text-xs text-gray-400 hover:text-white transition-all disabled:opacity-60"
        >
          <LocateFixed size={13} />
          {locating ? 'Localizando…' : 'Usar minha localização'}
        </button>
      </div>

      <label className="block text-xs text-gray-400 mt-4 mb-1.5">Alertar sonda nova só até esta distância de casa</label>
      <select
        value={config.alertRadiusKm}
        onChange={e => setConfig(c => ({ ...c, alertRadiusKm: Number(e.target.value) }))}
        className="bg-bg border border-border rounded-md text-sm text-white px-3 py-2 outline-none focus:border-blue-500 cursor-pointer"
      >
        <option value={0}>Sem filtro de distância</option>
        <option value={50}>Até 50 km</option>
        <option value={100}>Até 100 km</option>
        <option value={200}>Até 200 km</option>
        <option value={300}>Até 300 km</option>
      </select>

      <div className="flex items-center gap-3 mt-4">
        <button
          onClick={toggleAlerts}
          className={`flex items-center gap-2 px-3 py-2 rounded-md text-xs border transition-all ${
            config.receiverAlertsEnabled
              ? 'bg-blue-600 border-blue-600 text-white'
              : 'bg-surface border-border text-gray-400 hover:text-white'
          }`}
        >
          {config.receiverAlertsEnabled ? 'Notificações ativadas' : 'Ativar notificações de sonda nova'}
        </button>
        {notifPermission === 'denied' && (
          <span className="text-[11px] text-amber-400">
            Permissão negada no navegador — libere nas configurações do site.
          </span>
        )}
        {notifPermission === 'unsupported' && (
          <span className="text-[11px] text-faint">Este navegador não suporta notificações.</span>
        )}
      </div>
      <p className="text-[11px] text-faint mt-2">
        Avisa quando o seu receptor começar a decodificar uma sonda nova. Funciona com a
        aba do painel aberta (mesmo em segundo plano). Lembre de salvar depois de alterar.
      </p>

      {/* MQTT direto do firmware (opcional) */}
      <div className="mt-5 pt-5 border-t border-border">
        <h3 className="text-xs font-semibold text-white mb-1">MQTT — tempo real (opcional)</h3>
        <p className="text-[11px] text-faint mb-3">
          Além do SondeHub (~20s), o firmware pode publicar cada frame num broker MQTT
          público e o painel assinar direto (~1s de latência, uptime e bateria do receptor).
          Desligado, o app usa só o SondeHub, como sempre.
        </p>

        <button
          onClick={() => setConfig(c => ({ ...c, mqttEnabled: !c.mqttEnabled }))}
          className={`flex items-center gap-2 px-3 py-2 rounded-md text-xs border transition-all ${
            config.mqttEnabled
              ? 'bg-blue-600 border-blue-600 text-white'
              : 'bg-surface border-border text-gray-400 hover:text-white'
          }`}
        >
          {config.mqttEnabled ? 'MQTT ativado' : 'Ativar MQTT'}
        </button>

        {config.mqttEnabled && (
          <div className="mt-4">
            <label className="block text-xs text-gray-400 mb-1.5">Broker (WebSocket, para o navegador)</label>
            <select
              value={
                config.mqttBrokerUrl === 'wss://broker.emqx.io:8084/mqtt' ||
                config.mqttBrokerUrl === 'wss://broker.hivemq.com:8884/mqtt'
                  ? config.mqttBrokerUrl : 'custom'
              }
              onChange={e => {
                if (e.target.value !== 'custom') setConfig(c => ({ ...c, mqttBrokerUrl: e.target.value }))
                else setConfig(c => ({ ...c, mqttBrokerUrl: 'wss://' }))
              }}
              className="bg-bg border border-border rounded-md text-sm text-white px-3 py-2 outline-none focus:border-blue-500 cursor-pointer"
            >
              <option value="wss://broker.emqx.io:8084/mqtt">EMQX público (broker.emqx.io)</option>
              <option value="wss://broker.hivemq.com:8884/mqtt">HiveMQ público (broker.hivemq.com)</option>
              <option value="custom">Personalizado…</option>
            </select>
            {config.mqttBrokerUrl !== 'wss://broker.emqx.io:8084/mqtt' &&
              config.mqttBrokerUrl !== 'wss://broker.hivemq.com:8884/mqtt' && (
              <input
                type="text"
                value={config.mqttBrokerUrl}
                onChange={e => setConfig(c => ({ ...c, mqttBrokerUrl: e.target.value }))}
                placeholder="wss://seu-broker:8084/mqtt"
                className="mt-2 w-full max-w-md block bg-bg border border-border rounded-md text-sm text-white mono px-3 py-2 outline-none focus:border-blue-500"
              />
            )}

            <label className="block text-xs text-gray-400 mt-4 mb-1.5">Prefixo do tópico</label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={config.mqttTopicPrefix}
                onChange={e => setConfig(c => ({ ...c, mqttTopicPrefix: e.target.value }))}
                placeholder="ex.: pu7iol (igual ao mqtt.prefix do TTGO)"
                className="w-64 bg-bg border border-border rounded-md text-sm text-white mono px-3 py-2 outline-none focus:border-blue-500"
              />
              <button
                onClick={() => setConfig(c => ({
                  ...c,
                  // Sugestão = exatamente o callsign, sem barras — é o que a
                  // maioria dos firmwares reais usa em mqtt.prefix (ex.:
                  // "pu7iol", não "rdz/pu7iol/"). Precisa bater com o valor
                  // configurado no TTGO, seja lá qual for.
                  mqttTopicPrefix: c.uploaderCallsign.trim().toLowerCase().replace(/[^a-z0-9_/-]/g, ''),
                }))}
                disabled={!config.uploaderCallsign.trim()}
                className="px-3 py-2 bg-surface border border-border rounded-md text-xs text-gray-400 hover:text-white transition-all disabled:opacity-50"
              >
                Sugerir
              </button>
            </div>
            <p className="text-[11px] text-faint mt-2 leading-relaxed">
              Precisa ser <strong>idêntico</strong> ao <span className="mono">mqtt.prefix</span> já
              configurado no seu TTGO (Config → mqtt.prefix na web UI dele) — não adivinhe, copie
              o valor de lá. Exemplo real: se o TTGO tem <span className="mono">mqtt.prefix=pu7iol</span>,
              os tópicos são <span className="mono">pu7ioluptime</span>, <span className="mono">pu7iolpmu</span>
              {' '}etc. (sem barra — o prefixo é só concatenado). No TTGO, garanta também{' '}
              <span className="mono">mqtt.active=7</span> (soma de sondas+uptime+bateria) e{' '}
              <span className="mono">mqtt.host</span>/<span className="mono">mqtt.port</span> apontando
              para o mesmo broker escolhido acima.
              Atenção: broker público é aberto — os dados são visíveis a qualquer um (telemetria de
              sonda já é pública no SondeHub).
            </p>
          </div>
        )}

        <div className="mt-4 pt-4 border-t border-border">
          <button
            onClick={onSave}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 rounded-md text-sm text-white hover:bg-blue-700 transition-all"
          >
            {saved ? <CheckCircle2 size={14} /> : <Save size={14} />}
            {saved ? 'Salvo!' : 'Salvar "Meu receptor"'}
          </button>
        </div>
      </div>
    </div>
  )
}
