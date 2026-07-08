'use client'

import { useState, useEffect, useCallback } from 'react'
import { Settings, Save, RotateCcw, Info, CheckCircle2, Radio, Database } from 'lucide-react'
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

  useEffect(() => {
    setConfig(getSettings())
    setStation(getSelectedStation())
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
