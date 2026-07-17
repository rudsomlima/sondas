'use client'

import { Radio } from 'lucide-react'
import type { AppSettings } from '@/app/lib/settings'

interface ChannelPickerProps {
  config: AppSettings
  setConfig: (updater: (c: AppSettings) => AppSettings) => void
}

// Canal de configuração completa do firmware: só MQTT (funciona de
// qualquer lugar, inclusive pelo site publicado em https://). O segredo
// abaixo só é necessário pra gravar mudanças — a leitura funciona sem ele.
export default function ChannelPicker({ config, setConfig }: ChannelPickerProps) {
  return (
    <div className="panel p-5 mb-6">
      <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-1">
        <Radio size={14} className="text-blue-400" />
        Canal de configuração do firmware
      </h2>
      <p className="text-[11px] text-faint mb-4">
        O app lê e grava a configuração completa do rdzTTGOsonde via MQTT — requer MQTT ativado
        e configurado acima.
      </p>

      <div>
        <label className="block text-xs text-gray-400 mb-1.5">
          Segredo de gravação (mqtt.cfgsecret) — só necessário pra aplicar mudanças
        </label>
        <input
          type="password"
          value={config.rdzConfigSecret}
          onChange={e => setConfig(c => ({ ...c, rdzConfigSecret: e.target.value }))}
          placeholder="idêntico ao mqtt.cfgsecret configurado no receptor"
          className="w-full max-w-xs bg-bg border border-border rounded-md text-sm text-white mono px-3 py-2 outline-none focus:border-blue-500"
        />
        <p className="text-[11px] text-faint mt-1.5">
          Configure primeiro no receptor (Config → mqtt.cfgsecret, via HTTP local) e copie o
          mesmo valor aqui. Vazio = leitura funciona, gravação fica bloqueada.
        </p>
      </div>
    </div>
  )
}
