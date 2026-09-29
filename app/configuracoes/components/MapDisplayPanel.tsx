'use client'

import { Map as MapIcon } from 'lucide-react'
import { useLandedSondeClusteringEnabled, setLandedSondeClusteringEnabled } from '@/app/lib/mapDisplaySettings'

/**
 * Exibição dos mapas: liga/desliga o agrupamento de sondas pousadas por
 * proximidade em pixels (ver app/lib/markerClustering.ts). Puro display —
 * só localStorage, aplica NA HORA em qualquer mapa já aberto (painel,
 * histórico, mapa do lançamento) e nas outras abas, sem precisar recarregar.
 */
export default function MapDisplayPanel() {
  const clusterOn = useLandedSondeClusteringEnabled()

  return (
    <div className="panel p-5 mb-6">
      <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-4">
        <MapIcon size={14} className="text-blue-400" />
        Exibição dos mapas
      </h2>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-white">Agrupar sondas pousadas</p>
          <p className="text-[11px] text-faint mt-1 leading-relaxed">
            Em zoom afastado, sondas pousadas perto umas das outras viram um único círculo com a
            contagem — clique para aproximar e ver cada uma. Desligado, cada pouso sempre aparece
            como um balão individual, mesmo sobreposto. Vale para todos os mapas (painel, histórico
            e mapa do lançamento). Reaparecimentos e estações receptoras continuam agrupados
            normalmente — não são afetados por esta opção.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={clusterOn}
          aria-label="Agrupar sondas pousadas no mapa"
          onClick={() => setLandedSondeClusteringEnabled(!clusterOn)}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full border transition-colors ${
            clusterOn ? 'bg-blue-600 border-blue-500' : 'bg-surface-2 border-border-strong'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
              clusterOn ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      <p className="mt-3 text-[11px] min-h-[16px]">
        <span className={clusterOn ? 'text-emerald-400' : 'text-faint'}>
          {clusterOn ? 'Ligado — sondas próximas se agrupam em zoom afastado.' : 'Desligado — sempre um balão por sonda.'}
        </span>
      </p>
    </div>
  )
}
