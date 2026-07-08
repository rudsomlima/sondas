'use client'

import { useEffect, useState } from 'react'
import { Radio, Clock } from 'lucide-react'
import type { Station } from '@/app/lib/stations'
import type { TodayFlight } from '@/app/lib/radiosondy'
import type { TodayData } from '@/app/lib/types'

interface TopStatusBarProps {
  station: Station
  todayData: TodayData | null
  todayLoading: boolean
  todayFlights: TodayFlight[]
  lastFetchAt: Date | null
  onToggleStationPicker: () => void
}

// Próximo ciclo sinótico principal (00Z ou 12Z) a partir de agora.
function nextSynopticCycle(now: Date): { label: string; msLeft: number } {
  const targetMs = now.getUTCHours() < 12
    ? Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0)
    : Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0)
  return { label: now.getUTCHours() < 12 ? '12Z' : '00Z', msLeft: targetMs - now.getTime() }
}

function fmtCountdown(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60000))
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export default function TopStatusBar({
  station, todayData, todayLoading, todayFlights, lastFetchAt, onToggleStationPicker,
}: TopStatusBarProps) {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const pad = (n: number) => String(n).padStart(2, '0')
  const utcStr = `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`
  const gmt3 = new Date(now.getTime() - 3 * 60 * 60 * 1000)
  const gmt3Str = `${pad(gmt3.getUTCHours())}:${pad(gmt3.getUTCMinutes())}:${pad(gmt3.getUTCSeconds())}`
  const cycle = nextSynopticCycle(now)

  const liveFlight = todayFlights.find(f => f.isLive)
  const landedCount = todayFlights.filter(f => !f.isLive).length
  const hadFlightToday = todayData?.launched_today || todayFlights.length > 0

  return (
    <div className="panel px-4 py-2.5 mb-4 flex items-center gap-4 flex-wrap">
      <button
        onClick={onToggleStationPicker}
        title="Trocar estação"
        className="flex items-center gap-2 text-sm text-white hover:text-blue-300 transition-colors max-w-[220px]"
      >
        <Radio size={14} className="text-blue-400 flex-shrink-0" />
        <span className="truncate font-medium">{station.name}</span>
      </button>

      {/* Pílula de status operacional */}
      {todayLoading ? (
        <span className="badge bg-gray-500/15 text-gray-400 border border-gray-500/20">verificando…</span>
      ) : liveFlight ? (
        <span className="badge bg-sky-500/15 text-sky-300 border border-sky-500/30 pulse-soft mono">
          EM VOO · {Math.round(liveFlight.altitude).toLocaleString('pt-BR')} m
        </span>
      ) : landedCount > 0 ? (
        <span className="badge badge-success mono">POUSADA{landedCount > 1 ? ` ×${landedCount}` : ''}</span>
      ) : hadFlightToday ? (
        <span className="badge badge-info mono">LANÇADA HOJE</span>
      ) : (
        <span className="badge badge-danger mono">SEM LANÇAMENTO HOJE</span>
      )}

      <span className="text-xs text-dim flex items-center gap-1.5" title="Tempo até o próximo ciclo sinótico">
        <Clock size={12} />
        próx. {cycle.label} em <span className="mono text-white">{fmtCountdown(cycle.msLeft)}</span>
      </span>

      <div className="ml-auto flex items-center gap-4 text-xs">
        <span className="text-dim">UTC <span className="mono text-white">{utcStr}</span></span>
        <span className="text-dim">GMT-3 <span className="mono text-white">{gmt3Str}</span></span>
        {lastFetchAt && (
          <span className="text-faint hidden sm:inline" title="Última checagem das fontes">
            checado {lastFetchAt.toLocaleTimeString('pt-BR', { hour12: false })}
          </span>
        )}
      </div>
    </div>
  )
}
