'use client'

import { useState, useEffect, useCallback } from 'react'
import { Settings, Save, RotateCcw, Info, CheckCircle2, Radio, Database, RadioTower, LocateFixed } from 'lucide-react'
import { Station, DEFAULT_STATION, getSelectedStation, setSelectedStation } from '@/app/lib/stations'
import { AppSettings, DEFAULT_SETTINGS, getSettings, setSettings } from '@/app/lib/settings'
import StationPicker from '../historico/components/StationPicker'
import LocalCachePanel from './components/LocalCachePanel'
import R2Panel from './components/R2Panel'
import SyncStatusPanel from './components/SyncStatusPanel'

export default function ConfiguracoesPage() {
  const [config, setConfig] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [station, setStation] = useState<Station>(DEFAULT_STATION)
  const [showStationPicker, setShowStationPicker] = useState(false)
  const [saved, setSaved] = useState(false)
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | 'unsupported'>('default')
  const [locating, setLocating] = useState(false)

  useEffect(() => {
    setConfig(getSettings())
    setStation(getSelectedStation())
    setNotifPermission(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported')
  }, [])

  const handleSave = () => {
    setSettings(config)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  const handleReset = () => {
    setConfig(DEFAULT_SETTINGS)
    setSettings(DEFAULT_SETTINGS)
    setSaved(false)
  }

  // "Usar minha localização": preenche casa via geolocalização do navegador
  // (mesma API usada pelo chase em app/lib/chase.ts, mas pontual, não watch).
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

  // A permissão de notificação só pode ser pedida em gesto do usuário.
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

  const changeStation = useCallback((s: Station) => {
    setStation(s)
    setSelectedStation(s)
    setShowStationPicker(false)
  }, [])

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Settings size={22} className="text-blue-400" />
          Configurações
        </h1>
        <p className="text-gray-400 text-sm mt-1">Estação, preferências e armazenamento de dados</p>
      </div>

      {/* Estação padrão */}
      <div className="panel p-5 mb-6">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-4">
          <Radio size={14} className="text-blue-400" />
          Estação
        </h2>
        <button
          onClick={() => setShowStationPicker(v => !v)}
          className="flex items-center gap-2 px-3 py-2 bg-bg border border-border rounded-md text-sm text-white hover:border-border-strong transition-all"
        >
          <span>{station.name}</span>
          <span className="mono text-dim">{station.id}</span>
        </button>
        {showStationPicker && <StationPicker station={station} onSelect={changeStation} />}
        <p className="text-[11px] text-faint mt-2">
          A estação escolhida vale para todas as páginas (painel, histórico, análises).
        </p>
      </div>

      {/* Preferências */}
      <div className="panel p-5 mb-6">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-4">
          <Settings size={14} className="text-blue-400" />
          Exibição
        </h2>
        <label className="block text-xs text-gray-400 mb-1.5">Atualização automática do status do dia</label>
        <select
          value={config.autoRefreshMinutes}
          onChange={e => setConfig({ ...config, autoRefreshMinutes: Number(e.target.value) })}
          className="bg-bg border border-border rounded-md text-sm text-white px-3 py-2 outline-none focus:border-blue-500 cursor-pointer"
        >
          <option value={5}>A cada 5 minutos</option>
          <option value={10}>A cada 10 minutos</option>
          <option value={30}>A cada 30 minutos</option>
          <option value={60}>A cada 1 hora</option>
          <option value={0}>Desativada</option>
        </select>
        <p className="text-[11px] text-faint mt-2">
          Intervalo de reconsulta do "houve lançamento hoje?". O monitoramento de voo
          ao vivo (20s) não é afetado.
        </p>

        <div className="flex gap-2 mt-4">
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 rounded-md text-sm text-white hover:bg-blue-700 transition-all"
          >
            {saved ? <CheckCircle2 size={14} /> : <Save size={14} />}
            {saved ? 'Salvo!' : 'Salvar configurações'}
          </button>
          <button
            onClick={handleReset}
            className="flex items-center gap-2 px-4 py-2 bg-surface border border-border rounded-md text-sm text-gray-400 hover:text-white transition-all"
          >
            <RotateCcw size={14} />
            Restaurar padrões
          </button>
        </div>
      </div>

      {/* Meu receptor (rdzTTGOsonde / auto_rx via SondeHub) */}
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
          onChange={e => setConfig({ ...config, uploaderCallsign: e.target.value })}
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
            onChange={e => setConfig({ ...config, homeLat: e.target.value === '' ? null : Number(e.target.value) })}
            placeholder="Latitude"
            className="w-32 bg-bg border border-border rounded-md text-sm text-white mono px-3 py-2 outline-none focus:border-blue-500"
          />
          <input
            type="number"
            step="0.00001"
            value={config.homeLon ?? ''}
            onChange={e => setConfig({ ...config, homeLon: e.target.value === '' ? null : Number(e.target.value) })}
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
          onChange={e => setConfig({ ...config, alertRadiusKm: Number(e.target.value) })}
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
            onClick={() => setConfig({ ...config, mqttEnabled: !config.mqttEnabled })}
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
                  if (e.target.value !== 'custom') setConfig({ ...config, mqttBrokerUrl: e.target.value })
                  else setConfig({ ...config, mqttBrokerUrl: 'wss://' })
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
                  onChange={e => setConfig({ ...config, mqttBrokerUrl: e.target.value })}
                  placeholder="wss://seu-broker:8084/mqtt"
                  className="mt-2 w-full max-w-md block bg-bg border border-border rounded-md text-sm text-white mono px-3 py-2 outline-none focus:border-blue-500"
                />
              )}

              <label className="block text-xs text-gray-400 mt-4 mb-1.5">Prefixo do tópico</label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={config.mqttTopicPrefix}
                  onChange={e => setConfig({ ...config, mqttTopicPrefix: e.target.value })}
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
              onClick={handleSave}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 rounded-md text-sm text-white hover:bg-blue-700 transition-all"
            >
              {saved ? <CheckCircle2 size={14} /> : <Save size={14} />}
              {saved ? 'Salvo!' : 'Salvar "Meu receptor"'}
            </button>
          </div>
        </div>
      </div>

      {/* Sincronização multi-fonte (bastidores) */}
      <div className="panel p-5 mb-6">
        <SyncStatusPanel />
      </div>

      {/* Dados & Armazenamento */}
      <div id="dados" className="panel p-5 mb-6">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-1">
          <Database size={14} className="text-blue-400" />
          Dados &amp; Armazenamento
        </h2>
        <p className="text-[11px] text-faint mb-5">
          Três camadas independentes: navegador (localStorage), servidor R2 (persistente)
          e memória do servidor (efêmera, por instância — sem gestão manual).
        </p>

        <div className="mb-6">
          <LocalCachePanel stationId={station.id} />
        </div>

        <div className="pt-5 border-t border-border">
          <R2Panel />
        </div>
      </div>

      {/* Sobre */}
      <div className="panel p-5">
        <h2 className="text-xs font-semibold text-white mb-2 flex items-center gap-2">
          <Info size={13} className="text-blue-400" />
          Sobre os dados
        </h2>
        <p className="text-xs text-gray-400 leading-relaxed">
          Horários de lançamento vêm da{' '}
          <a href="https://weather.uwyo.edu/wsgi/sounding" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">University of Wyoming</a>.
          Posições e trajetórias vêm do{' '}
          <a href="https://radiosondy.info" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">radiosondy.info</a>{' '}
          (recuperações físicas) e do{' '}
          <a href="https://sondehub.org" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">SondeHub</a>{' '}
          (telemetria RF amadora). Todos os horários são convertidos de UTC para GMT-3.
        </p>
      </div>
    </div>
  )
}
