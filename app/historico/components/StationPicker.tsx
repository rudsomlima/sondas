'use client'

import { useMemo, useState } from 'react'
import { Search, Check } from 'lucide-react'
import { Station, searchStations } from '@/app/lib/stations'

interface StationPickerProps {
  station: Station
  onSelect: (s: Station) => void
}

// Busca/seleção de estação com pesquisa diacritic-insensitive.
export default function StationPicker({ station, onSelect }: StationPickerProps) {
  const [query, setQuery] = useState('')
  const results = useMemo(() => searchStations(query), [query])

  return (
    <div className="panel p-4 mt-3">
      <div className="relative mb-2">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Buscar por nome ou STNM (ex.: Natal, 82599, Buenos Aires)…"
          autoFocus
          className="w-full bg-bg border border-border rounded-md pl-9 pr-3 py-2 text-sm text-white outline-none focus:border-blue-500"
        />
      </div>
      <div className="max-h-56 overflow-y-auto border border-border rounded-md divide-y divide-border">
        {results.length === 0 ? (
          <p className="text-xs text-gray-400 p-3">Nenhuma estação encontrada.</p>
        ) : (
          results.map(s => {
            const isSelected = s.id === station.id
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onSelect(s)}
                className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between gap-2 hover:bg-white/10 transition-colors cursor-pointer ${
                  isSelected ? 'bg-blue-500/15 text-blue-300' : 'text-gray-200'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  {isSelected && <Check size={12} className="text-blue-400 flex-shrink-0" />}
                  {s.name}
                </span>
                <span className="mono text-gray-400 flex-shrink-0">{s.id}</span>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
