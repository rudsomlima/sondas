'use client'

import { useState, useEffect } from 'react'
import {
  Settings, Save, RotateCcw, Info, CheckCircle2
} from 'lucide-react'

interface Config {
  autoRefreshMinutes: number
}

const DEFAULT_CONFIG: Config = {
  autoRefreshMinutes: 10,
}

export default function ConfiguracoesPage() {
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    try {
      const stored = localStorage.getItem('sondas_settings')
      if (stored) setConfig({ ...DEFAULT_CONFIG, ...JSON.parse(stored) })
    } catch {}
  }, [])

  const handleSave = () => {
    try {
      localStorage.setItem('sondas_settings', JSON.stringify(config))
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch {}
  }

  const handleReset = () => {
    setConfig(DEFAULT_CONFIG)
    localStorage.removeItem('sondas_settings')
    setSaved(false)
  }

  const update = (key: keyof Config, value: number) =>
    setConfig(prev => ({ ...prev, [key]: value }))

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Settings size={22} className="text-blue-400" />
          Configurações
        </h1>
        <p className="text-gray-400 text-sm mt-1">Parâmetros de extração e exibição de dados</p>
      </div>

      {/* Display */}
      <div className="card p-5 mb-6">
        <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <Settings size={14} className="text-blue-400" />
          Exibição
        </h2>
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">Atualização automática</label>
          <select
            value={config.autoRefreshMinutes}
            onChange={e => update('autoRefreshMinutes', Number(e.target.value))}
            className="w-full sm:w-auto bg-[#111111] border border-[#2a2a2a] rounded-md px-3 py-2 text-sm text-white outline-none focus:border-blue-500 cursor-pointer"
          >
            <option value={5}>A cada 5 minutos</option>
            <option value={10}>A cada 10 minutos</option>
            <option value={30}>A cada 30 minutos</option>
            <option value={60}>A cada 1 hora</option>
            <option value={0}>Desativada</option>
          </select>
          <p className="text-xs text-gray-400 mt-1">Intervalo de reconsulta automática na página principal.</p>
        </div>
        <div className="mt-4 p-3 bg-blue-500/5 border border-blue-500/15 rounded-md flex gap-2.5">
          <Info size={14} className="text-blue-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-gray-400">
            A extração sempre cobre o dia inteiro (00Z a 23Z, GMT-3) — não há período parcial configurável.
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
            saved
              ? 'bg-green-600/20 border border-green-500/30 text-green-400'
              : 'bg-blue-600 hover:bg-blue-700 text-white border border-blue-600'
          }`}
        >
          {saved
            ? <><CheckCircle2 size={14} /> Salvo!</>
            : <><Save size={14} /> Salvar configurações</>
          }
        </button>
        <button
          onClick={handleReset}
          className="flex items-center gap-2 px-4 py-2 bg-[#1a1a1a] border border-[#2a2a2a] rounded-md text-sm text-gray-400 hover:text-white hover:border-[#3a3a3a] transition-all"
        >
          <RotateCcw size={14} />
          Restaurar padrões
        </button>
      </div>

      <div className="mt-8 p-4 card">
        <p className="text-xs text-gray-300 font-medium mb-2">Sobre os dados</p>
        <p className="text-xs text-gray-400 leading-relaxed">
          Os dados são extraídos em tempo real do servidor da{' '}
          <a href="https://weather.uwyo.edu" target="_blank" rel="noopener" className="text-blue-400 hover:underline">
            University of Wyoming
          </a>
          . Todos os horários são convertidos de UTC para GMT-3 (horário de Brasília/Natal).
          A estação padrão é a <strong className="text-gray-200">82599 — Natal Aeroporto</strong>.
        </p>
      </div>
    </div>
  )
}
