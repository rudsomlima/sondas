'use client'

import { sondeHubUrl } from '@/app/lib/radiosondy'
import { ExternalLink } from 'lucide-react'
import { formatGmt3 } from '@/app/lib/launchUtils'
import type { SelectedTarget } from '../selection'

// Painel direito: telemetria da sonda selecionada.
export default function TelemetryPanel({ selected }: { selected: SelectedTarget | null }) {
  return (
    <div className="panel p-4">
      <p className="panel-title mb-3">Telemetria</p>
      {!selected ? (
        <p className="text-xs text-dim">Selecione uma sonda ou lançamento.</p>
      ) : (
        <div className="space-y-2 text-xs">
          <div className="flex justify-between gap-2">
            <span className="label-xs">Serial</span>
            <span className="mono text-amber-400">{selected.serial}</span>
          </div>
          {selected.altitude !== undefined && (
            <div className="flex justify-between gap-2">
              <span className="label-xs">Altitude</span>
              <span className="mono text-emerald-400">{Math.round(selected.altitude).toLocaleString('pt-BR')} m</span>
            </div>
          )}
          {selected.climbing !== undefined && (
            <div className="flex justify-between gap-2">
              <span className="label-xs">Var. vertical</span>
              <span className={`mono ${selected.climbing >= 0 ? 'text-sky-300' : 'text-amber-300'}`}>
                {selected.climbing >= 0 ? '+' : ''}{selected.climbing.toFixed(1)} m/s
              </span>
            </div>
          )}
          <div className="flex justify-between gap-2">
            <span className="label-xs">Posição</span>
            <span className="mono text-white">{selected.lat.toFixed(4)}, {selected.lon.toFixed(4)}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="label-xs">Situação</span>
            <span className={`mono ${selected.isLive ? 'text-live' : 'text-green-400'}`}>
              {selected.isLive ? 'EM VOO' : selected.launch?.position?.status ?? 'POUSADA'}
            </span>
          </div>
          {selected.frequency !== undefined && (
            <div className="flex justify-between gap-2">
              <span className="label-xs">Frequência</span>
              <span className="mono text-sky-300">{selected.frequency.toFixed(2)} MHz</span>
            </div>
          )}
          {selected.snr !== undefined && (
            <div className="flex justify-between gap-2">
              <span className="label-xs">SNR (meu RX)</span>
              <span className="mono text-emerald-400">{selected.snr.toFixed(1)} dB</span>
            </div>
          )}
          {selected.rssi !== undefined && (
            <div className="flex justify-between gap-2">
              <span className="label-xs">RSSI (meu RX)</span>
              <span className="mono text-violet-300">{selected.rssi.toFixed(0)} dBm</span>
            </div>
          )}
          {selected.battV !== undefined && (
            <div className="flex justify-between gap-2">
              <span className="label-xs">Bateria da sonda</span>
              <span className="mono text-white">{selected.battV.toFixed(1)} V</span>
            </div>
          )}
          {selected.lastReportUtc && (
            <div className="flex justify-between gap-2">
              <span className="label-xs">Último report</span>
              <span className="mono text-violet-300">{formatGmt3(selected.lastReportUtc)}</span>
            </div>
          )}
          {selected.launch && (
            <div className="flex justify-between gap-2">
              <span className="label-xs">Lançamento</span>
              <span className="mono text-white">
                {selected.launch.date.split('-').reverse().join('/')} {selected.launch.time_local}
              </span>
            </div>
          )}
          <a
            href={sondeHubUrl(selected.serial, selected.lat, selected.lon)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-400 hover:underline flex items-center gap-1 pt-1"
          >
            Ver no SondeHub <ExternalLink size={10} />
          </a>
        </div>
      )}
    </div>
  )
}
