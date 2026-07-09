'use client'

import { Crosshair, Navigation, ExternalLink, StopCircle } from 'lucide-react'
import { googleMapsNavUrl, wazeNavUrl, GeoState } from '@/app/lib/chase'
import { haversineKm, bearingDeg, bearingToCardinal, formatDistance } from '@/app/lib/geo'
import type { SelectedTarget } from '../selection'

interface ChasePanelProps {
  selected: SelectedTarget | null
  geo: GeoState
}

// Painel direito: modo caçador — distância/rumo até o alvo + navegação.
export default function ChasePanel({ selected, geo }: ChasePanelProps) {
  const target = selected

  return (
    <div className="panel p-4">
      <p className="panel-title mb-3">Modo caçador</p>

      {!geo.watching ? (
        <>
          <button
            onClick={geo.start}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-blue-600/20 border border-blue-500/30 rounded text-xs text-blue-300 hover:bg-blue-600/30 transition-all"
          >
            <Crosshair size={13} />
            Ativar modo caçador
          </button>
          {geo.error && <p className="text-[11px] text-red-400 mt-2">{geo.error}</p>}
          <p className="text-[11px] text-faint mt-2">
            Usa sua localização para calcular distância e rota até a sonda.
          </p>
        </>
      ) : (
        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-green-400 flex items-center gap-1.5">
              <Crosshair size={12} className="pulse-soft" /> Localizando
            </span>
            <button onClick={geo.stop} className="text-gray-500 hover:text-red-400 flex items-center gap-1 px-2 py-1">
              <StopCircle size={12} /> parar
            </button>
          </div>

          {!geo.pos ? (
            <p className="text-dim">Obtendo posição…</p>
          ) : !target ? (
            <p className="text-dim">Selecione uma sonda para calcular a rota.</p>
          ) : (() => {
            const dist = haversineKm(geo.pos.lat, geo.pos.lon, target.lat, target.lon)
            const brg = bearingDeg(geo.pos.lat, geo.pos.lon, target.lat, target.lon)
            return (
              <>
                <div className="flex justify-between gap-2">
                  <span className="label-xs">Distância</span>
                  <span className="mono text-white text-sm font-bold">{formatDistance(dist)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="label-xs">Rumo</span>
                  <span className="mono text-white">{Math.round(brg)}° {bearingToCardinal(brg)}</span>
                </div>
                {target.isLive && (
                  <p className="text-[11px] text-yellow-400/90">
                    ⚠ Sonda ainda em voo — o alvo se move; ponto estimado.
                  </p>
                )}
                <div className="flex gap-2 pt-1">
                  <a
                    href={googleMapsNavUrl(target.lat, target.lon)}
                    target="_blank" rel="noopener noreferrer"
                    className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 bg-green-600/20 border border-green-500/30 rounded text-green-300 hover:bg-green-600/30 transition-all"
                  >
                    <Navigation size={11} /> Maps <ExternalLink size={9} />
                  </a>
                  <a
                    href={wazeNavUrl(target.lat, target.lon)}
                    target="_blank" rel="noopener noreferrer"
                    className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 bg-sky-600/20 border border-sky-500/30 rounded text-sky-300 hover:bg-sky-600/30 transition-all"
                  >
                    <Navigation size={11} /> Waze <ExternalLink size={9} />
                  </a>
                </div>
                <p className="text-[10px] text-faint">
                  Precisão do GPS: ±{Math.round(geo.pos.accuracyM)} m
                </p>
              </>
            )
          })()}
        </div>
      )}
    </div>
  )
}
