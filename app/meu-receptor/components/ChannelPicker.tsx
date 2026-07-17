'use client'

import { Radio, ExternalLink } from 'lucide-react'
import type { AppSettings } from '@/app/lib/settings'
import type { RdzConfigChannel } from '../hooks/useFirmwareConfig'

interface ChannelPickerProps {
  config: AppSettings
  setConfig: (updater: (c: AppSettings) => AppSettings) => void
  httpBlocked: boolean
  receiverIp: string | null
  channel: RdzConfigChannel | null
  onPick: (channel: RdzConfigChannel) => void
}

// Escolha de canal pra ler/gravar a config completa do firmware — ver
// decisão de arquitetura no plano (HTTP local x MQTT, mixed-content).
export default function ChannelPicker({ config, setConfig, httpBlocked, receiverIp, channel, onPick }: ChannelPickerProps) {
  return (
    <div className="panel p-5 mb-6">
      <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-1">
        <Radio size={14} className="text-blue-400" />
        Canal de configuração do firmware
      </h2>
      <p className="text-[11px] text-faint mb-4">
        Escolha como o app conversa com o rdzTTGOsonde pra ler e gravar a configuração completa.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          onClick={() => !httpBlocked && onPick('http')}
          disabled={httpBlocked}
          className={`text-left p-3 rounded-md border transition-all ${
            channel === 'http' ? 'border-blue-500/60 bg-blue-500/10' : 'border-border hover:border-border-strong'
          } ${httpBlocked ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <div className="text-sm text-white font-medium mb-1">HTTP (rede local)</div>
          <div className="text-[11px] text-faint">
            Zero mudança no firmware. Só funciona com o app aberto em http:// (ex.: npm run dev
            local) e na mesma rede do receptor.
          </div>
        </button>
        <button
          onClick={() => onPick('mqtt')}
          className={`text-left p-3 rounded-md border transition-all ${
            channel === 'mqtt' ? 'border-blue-500/60 bg-blue-500/10' : 'border-border hover:border-border-strong'
          }`}
        >
          <div className="text-sm text-white font-medium mb-1">MQTT (de qualquer lugar)</div>
          <div className="text-[11px] text-faint">
            Funciona pelo site publicado também. Requer firmware com suporte a config por MQTT
            (tópicos cfg/get e cfg/set) e, pra gravar, um segredo configurado nos dois lados.
          </div>
        </button>
      </div>

      {httpBlocked && (
        <p className="text-[11px] text-amber-400 mt-3">
          O app está em https:// — o navegador bloqueia a leitura direta do receptor (http local).
          {receiverIp && (
            <>
              {' '}Abra{' '}
              <a
                href={`http://${receiverIp}/config.html`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline inline-flex items-center gap-0.5"
              >
                a UI do receptor <ExternalLink size={10} />
              </a>
              {' '}diretamente, ou rode o app localmente (npm run dev).
            </>
          )}
        </p>
      )}

      {channel === 'mqtt' && (
        <div className="mt-4 pt-4 border-t border-border">
          <label className="block text-xs text-gray-400 mb-1.5">
            Segredo de gravação (mqtt.cfgsecret) — só necessário pra aplicar mudanças via MQTT
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
            mesmo valor aqui. Vazio = leitura funciona, gravação por MQTT fica bloqueada.
          </p>
        </div>
      )}
    </div>
  )
}
