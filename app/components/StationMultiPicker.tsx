'use client'

import { useMemo, useState } from 'react'
import { Search, Check, Star, X } from 'lucide-react'
import { MAX_SELECTED_STATIONS, Station, searchStations } from '@/app/lib/stations'

interface StationMultiPickerProps {
  selected: Station[]
  onChange: (stations: Station[]) => void
  autoFocus?: boolean
}

// Escolha de VÁRIAS estações: chips das escolhidas (a 1ª é a principal — a
// estrela promove outra) + busca diacritic-insensitive com marcar/desmarcar.
// Sempre fica ao menos uma; no máximo MAX_SELECTED_STATIONS.
export default function StationMultiPicker({ selected, onChange, autoFocus }: StationMultiPickerProps) {
  const [query, setQuery] = useState('')
  const results = useMemo(() => searchStations(query), [query])
  const selectedIds = new Set(selected.map(s => s.id))
  const full = selected.length >= MAX_SELECTED_STATIONS

  const toggle = (s: Station) => {
    if (selectedIds.has(s.id)) {
      if (selected.length > 1) onChange(selected.filter(x => x.id !== s.id))
    } else if (!full) {
      onChange([...selected, s])
    }
  }
  const makePrimary = (s: Station) => onChange([s, ...selected.filter(x => x.id !== s.id)])

  return (
    <div className="panel p-4 mt-3">
      <div className="flex flex-wrap gap-1.5 mb-3">
        {selected.map((s, i) => (
          <span
            key={s.id}
            className={`flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-md border text-xs ${
              i === 0 ? 'border-blue-500/50 bg-blue-500/15 text-blue-200' : 'border-border bg-bg text-gray-200'
            }`}
          >
            <button
              type="button"
              onClick={() => i > 0 && makePrimary(s)}
              title={i === 0 ? 'Estação principal' : 'Tornar principal'}
              className={i === 0 ? 'text-yellow-400 cursor-default' : 'text-gray-500 hover:text-yellow-400'}
            >
              <Star size={11} fill={i === 0 ? 'currentColor' : 'none'} />
            </button>
            <span>{s.name}</span>
            <span className="mono text-dim">{s.id}</span>
            {selected.length > 1 && (
              <button type="button" onClick={() => toggle(s)} title="Remover" className="text-gray-500 hover:text-red-400">
                <X size={12} />
              </button>
            )}
          </span>
        ))}
      </div>
      <div className="relative mb-2">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Buscar por nome ou STNM (ex.: Natal, 82599, Buenos Aires)…"
          autoFocus={autoFocus}
          className="w-full bg-bg border border-border rounded-md pl-9 pr-3 py-2 text-sm text-white outline-none focus:border-blue-500"
        />
      </div>
      <div className="max-h-56 overflow-y-auto border border-border rounded-md divide-y divide-border">
        {results.length === 0 ? (
          <p className="text-xs text-gray-400 p-3">Nenhuma estação encontrada.</p>
        ) : (
          results.map(s => {
            const isSelected = selectedIds.has(s.id)
            const disabled = (!isSelected && full) || (isSelected && selected.length === 1)
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => toggle(s)}
                disabled={disabled}
                title={!isSelected && full ? `Máximo de ${MAX_SELECTED_STATIONS} estações` : undefined}
                className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between gap-2 transition-colors ${
                  isSelected ? 'bg-blue-500/15 text-blue-300' : 'text-gray-200'
                } ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-white/10 cursor-pointer'}`}
              >
                <span className="flex items-center gap-2">
                  <span className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center flex-shrink-0 ${
                    isSelected ? 'bg-blue-500 border-blue-500' : 'border-gray-500'
                  }`}>
                    {isSelected && <Check size={10} className="text-white" />}
                  </span>
                  {s.name}
                </span>
                <span className="mono text-gray-400 flex-shrink-0">{s.id}</span>
              </button>
            )
          })
        )}
      </div>
      <p className="text-[11px] text-faint mt-2">
        {selected.length} de até {MAX_SELECTED_STATIONS} estações. A estrela marca a principal.
      </p>
    </div>
  )
}
