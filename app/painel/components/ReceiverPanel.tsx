'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Antenna, Loader2, BatteryMedium, Moon, Network, Radio } from 'lucide-react'
import { formatGmt3 } from '@/app/lib/launchUtils'
import type { ReceiverStatus } from '@/app/lib/sondehub'
import type { MyReceiverSonde } from '../hooks/useReceiverStatus'
import type { ReceiverSource } from '../hooks/useReceiver'
import type { SelectedTarget } from '../selection'

interface ReceiverPanelProps {
  status: ReceiverStatus | null
  mySondes: MyReceiverSonde[]
  checked: boolean
  enabled: boolean
  callsign: string
  source: ReceiverSource
  mqttConfigured: boolean
  mqttConnected: boolean
  uptimeMs: number | null
  ttgoBattV: number | null
  sleeping: { until: number; reason?: string } | null
  receiverIp: string | null
  mqttLastMessageAt: number | null // epoch (ms) da última msg MQTT não-retida
  selected: SelectedTarget | null
  onSelect: (t: SelectedTarget | null) => void
}

// Razões de sleep publicadas pelo firmware (deep sleep v2) em pt.
// Nota: "vcrit" não dorme mais o receptor (virou modo economia sem sleep,
// ver DEEP_SLEEP_V2_GUIDE.md) — só "vpanic" (proteção física da célula,
// opt-in) ainda força sleep por causa da bateria.
const SLEEP_REASONS: Record<string, string> = {
  out_of_window: 'fora da janela de recepção',
  window_end: 'fim da janela sem sonda',
  signal_lost: 'sinal da sonda perdido',
  vpanic: 'proteção da bateria (opt-in)',
}

// "ligado há 2h 14min" a partir do uptime (millis) publicado pelo firmware.
function formatUptime(ms: number): string {
  const min = Math.floor(ms / 60000)
  if (min < 60) return `${min}min`
  const h = Math.floor(min / 60)
  if (h < 48) return `${h}h ${min % 60}min`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

// Card "Meu receptor": estado do receptor local do usuário (rdzTTGOsonde/
// auto_rx) visto através dos frames dele no SondeHub, e as sondas que ele
// está/esteve decodificando nesta janela. Clicar numa sonda foca mapa e
// telemetria, como no LivePanel.
export default function ReceiverPanel({
  status, mySondes, checked, enabled, callsign,
  source, mqttConfigured, mqttConnected, uptimeMs, ttgoBattV, sleeping,
  receiverIp, mqttLastMessageAt,
  selected, onSelect,
}: ReceiverPanelProps) {
  // Ticker próprio de 1s — não depende de re-renders de outras partes do
  // app (poll do SondeHub, geolocalização, etc.), que antes faziam o
  // contador pular em passos irregulares em vez de subir 1 em 1.
  const [nowTick, setNowTick] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const mqttAgoS = mqttLastMessageAt != null ? Math.max(0, Math.round((nowTick - mqttLastMessageAt) / 1000)) : null

  return (
    <div className="panel p-4">
      <p className="panel-title mb-3 flex items-center gap-1.5">
        <Antenna size={12} className="text-blue-400" />
        Meu receptor
      </p>

      {!enabled ? (
        <p className="text-xs text-dim">
          Nenhum receptor configurado.{' '}
          <Link href="/configuracoes" className="text-indigo-400 hover:underline">
            Configure o callsign e a posição de casa
          </Link>{' '}
          para acompanhar aqui o que o seu rdzTTGOsonde está decodificando.
        </p>
      ) : !checked ? (
        <span className="text-xs text-dim flex items-center gap-1.5">
          <Loader2 size={11} className="animate-spin" /> Verificando…
        </span>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={`w-2 h-2 rounded-full ${
              sleeping ? 'bg-indigo-400' : status?.online ? 'bg-green-400 pulse-soft' : 'bg-gray-600'
            }`} />
            <span className="mono text-xs text-white">{callsign}</span>
            {sleeping ? (
              <span
                className="badge badge-info text-[9px] px-1.5 py-0"
                title={sleeping.reason ? SLEEP_REASONS[sleeping.reason] ?? sleeping.reason : undefined}
              >
                <Moon size={9} /> dormindo até {formatGmt3(new Date(sleeping.until).toISOString()).slice(11, 16)}
              </span>
            ) : source === 'mqtt' ? (
              <span
                className="badge badge-success text-[9px] px-1.5 py-0"
                title="Tópicos packet/uptime/pmu/sleep assinados via WebSocket; o TTGO publica uptime/pmu a cada ~60s e packet a cada frame de sonda (~1s)"
              >
                <Radio size={9} /> MQTT
                {mqttAgoS != null && ` · última msg há ${mqttAgoS}s`}
              </span>
            ) : mqttConfigured && !mqttConnected ? (
              <span
                className="badge badge-warning text-[9px] px-1.5 py-0"
                title="MQTT habilitado mas sem conexão com o broker — usando o fallback SondeHub"
              >
                MQTT off
              </span>
            ) : (
              <span className="badge text-[9px] px-1.5 py-0 text-dim border border-border">SondeHub ~20s</span>
            )}
            <span className="text-[10px] text-faint">
              {status?.lastHeardUtc
                ? `ouvido ${formatGmt3(status.lastHeardUtc)}`
                : status?.online ? 'ligado, sem sonda no ar' : 'sem frames recentes'}
            </span>
          </div>
          {(uptimeMs != null || ttgoBattV != null) && (
            <div className="flex items-center gap-3 mb-3 text-[10px] text-dim mono">
              {uptimeMs != null && <span>ligado há {formatUptime(uptimeMs)}</span>}
              {ttgoBattV != null && (
                <span className="flex items-center gap-1 text-red-400 font-semibold text-sm">
                  <BatteryMedium size={15} /> {ttgoBattV.toFixed(2)} V
                </span>
              )}
            </div>
          )}
          {uptimeMs == null && ttgoBattV == null && <div className="mb-2" />}

          {receiverIp && (
            <div className="flex items-center gap-3 mb-3 text-[10px] text-dim mono flex-wrap">
              {receiverIp && (
                <a
                  href={`http://${receiverIp}/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 hover:text-white transition-colors"
                  title="Web UI do TTGO — só abre se você estiver na mesma rede local"
                >
                  <Network size={11} /> {receiverIp}
                </a>
              )}
            </div>
          )}

          {mySondes.length === 0 ? (
            <p className="text-xs text-dim">
              Nenhuma sonda decodificada agora. O receptor só transmite quando há
              sonda no ar — fora do horário sinótico isso é normal.
            </p>
          ) : (
            <div className="space-y-2">
              {mySondes.map(m => {
                const isSelected = selected?.serial === m.serial
                return (
                  <button
                    key={m.serial}
                    onClick={() => onSelect(isSelected ? null : {
                      serial: m.serial, lat: m.lat, lon: m.lon,
                      altitude: m.alt, climbing: m.vel_v,
                      isLive: m.isLive, lastReportUtc: m.lastReportUtc,
                      snr: m.snr, rssi: m.rssi, frequency: m.frequency,
                      battV: m.battV, receivedByMe: true,
                    })}
                    className={`w-full text-left p-2.5 rounded border transition-all ${
                      isSelected ? 'border-blue-500/60 bg-blue-500/10' : 'border-border hover:border-border-strong bg-bg'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="mono text-xs text-amber-400">{m.serial}</span>
                      {m.type && <span className="text-[10px] text-dim mono">{m.type}</span>}
                      {m.isLive && <span className="text-[10px] text-live pulse-soft">EM VOO</span>}
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-[10px] mono flex-wrap">
                      {m.frequency !== undefined && (
                        <span className="text-sky-300">{m.frequency.toFixed(2)} MHz</span>
                      )}
                      {m.snr !== undefined && <span className="text-emerald-400">SNR {m.snr.toFixed(1)} dB</span>}
                      {m.rssi !== undefined && <span className="text-violet-300">{m.rssi.toFixed(0)} dBm</span>}
                      {m.battV !== undefined && <span className="text-dim">{m.battV.toFixed(1)} V</span>}
                    </div>
                    <div className="text-[10px] text-faint mono mt-0.5">
                      meu último frame {formatGmt3(m.myLastHeardUtc)}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
