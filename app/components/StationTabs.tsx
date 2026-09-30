'use client'

import { Radio, Star } from 'lucide-react'
import { Station, stationShortName } from '@/app/lib/stations'

interface StationTabsProps {
  stations: Station[]
  activeId: string
  onChange: (station: Station) => void
  className?: string
}

// Abas entre as estações escolhidas em Configurações, pras telas que mostram
// uma estação por vez (histórico anual, análises). Com uma estação só, some.
export default function StationTabs({ stations, activeId, onChange, className = '' }: StationTabsProps) {
  if (stations.length < 2) return null
  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`} role="tablist" aria-label="Estações escolhidas">
      {stations.map((s, i) => {
        const active = s.id === activeId
        return (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(s)}
            title={`${s.name} · STNM ${s.id}${i === 0 ? ' (principal)' : ''}`}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs transition-colors ${
              active
                ? 'border-blue-500/60 bg-blue-500/20 text-white'
                : 'border-border bg-surface text-gray-400 hover:text-white hover:border-border-strong'
            }`}
          >
            {i === 0 ? <Star size={10} className="text-yellow-400" fill="currentColor" /> : <Radio size={10} className="text-blue-400" />}
            <span className="truncate max-w-[160px]">{stationShortName(s)}</span>
          </button>
        )
      })}
    </div>
  )
}
