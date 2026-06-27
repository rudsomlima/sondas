'use client'

import { useEffect, useRef, useState } from 'react'
import 'leaflet/dist/leaflet.css'
import { AlertCircle, Loader2, X } from 'lucide-react'
import {
  fetchRadiosondyFeatures, statusColor, buildBalloonIcon,
  gmt3IconLabelWithMonth, LEGEND_ITEMS, RadiosondyFeature,
} from '@/app/lib/radiosondy'
import { getRadiosondyStartplace } from '@/app/lib/stations'

const BALLOON_SIZE = 15

interface YearMapProps {
  year: number
  station: string
  // Meses do ano que já têm lançamento carregado na página — evita consultar
  // o radiosondy.info para meses sem nenhum dado (futuro, ou ainda sem sync).
  monthsWithData: number[]
  onClose: () => void
}

export default function YearMap({ year, station, monthsWithData, onClose }: YearMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapDivRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const markersLayerRef = useRef<any>(null)
  const [status, setStatus] = useState<string | null>('Consultando radiosondy.info…')
  const [error, setError] = useState<string | null>(null)

  const startplace = getRadiosondyStartplace(station)

  useEffect(() => {
    containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [])

  useEffect(() => {
    let cancelled = false

    async function run() {
      if (!startplace) {
        setStatus(null)
        setError('Sem cobertura do radiosondy.info conhecida para esta estação.')
        return
      }
      if (monthsWithData.length === 0) {
        setStatus(null)
        setError('Nenhum mês com lançamento carregado neste ano ainda.')
        return
      }

      setStatus('Consultando radiosondy.info…')
      setError(null)
      try {
        const results = await Promise.allSettled(
          monthsWithData.map(m => fetchRadiosondyFeatures(year, m, startplace))
        )
        if (cancelled) return

        const features: RadiosondyFeature[] = results
          .filter((r): r is PromiseFulfilledResult<RadiosondyFeature[]> => r.status === 'fulfilled')
          .flatMap(r => r.value)

        if (features.length === 0) throw new Error('Nenhuma posição encontrada no radiosondy.info para este ano.')

        const L = (await import('leaflet')).default
        if (cancelled || !mapDivRef.current) return

        if (!mapRef.current) {
          const map = L.map(mapDivRef.current)
          const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors',
          })
          const satellite = L.tileLayer(
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            { attribution: 'Esri, Maxar, Earthstar Geographics' }
          )
          streets.addTo(map)
          L.control.layers({ 'Mapa': streets, 'Satélite': satellite }).addTo(map)
          markersLayerRef.current = L.layerGroup().addTo(map)
          mapRef.current = map
        }
        const map = mapRef.current

        markersLayerRef.current.clearLayers()
        const bounds = L.latLngBounds([])
        for (const f of features) {
          L.marker([f.lat, f.lon], { icon: buildBalloonIcon(L, statusColor(f.status), BALLOON_SIZE, gmt3IconLabelWithMonth(f.date)) })
            .addTo(markersLayerRef.current)
            .bindPopup(f.popupContent)
          bounds.extend([f.lat, f.lon])
        }

        setStatus(null)
        map.fitBounds(bounds, { padding: [30, 30] })
        setTimeout(() => map.invalidateSize(), 50)
      } catch (e: any) {
        if (!cancelled) {
          setError(e.message || 'Erro ao carregar o mapa')
          setStatus(null)
        }
      }
    }

    run()
    return () => { cancelled = true }
  }, [year, station, startplace, monthsWithData.join(',')])

  useEffect(() => {
    return () => {
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [])

  return (
    <div ref={containerRef} className="mt-3 border border-[#2a2a2a] rounded overflow-hidden">
      <div className="px-3 py-2 bg-[#1a1a1a] border-b border-[#2a2a2a] flex items-center gap-3 flex-wrap">
        <span className="text-xs text-gray-300">
          Todas as sondas de {year}
        </span>
        <button onClick={onClose} className="ml-auto text-gray-400 hover:text-white flex-shrink-0" title="Fechar mapa">
          <X size={15} />
        </button>
      </div>

      <div className="relative h-[420px] bg-[#111111]">
        <div ref={mapDivRef} className="absolute inset-0" />

        {!status && !error && (
          <div className="absolute bottom-3 right-3 z-[900] bg-[#111111]/40 backdrop-blur-sm rounded-md p-2.5 text-xs text-gray-200 space-y-1.5">
            {LEGEND_ITEMS.map(item => (
              <div key={item.label} className="flex items-center gap-2">
                <span className="inline-block w-2.5 h-3 rounded-sm flex-shrink-0" style={{ background: item.color }} />
                {item.label}
              </div>
            ))}
          </div>
        )}

        {(status || error) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#111111]/95 z-[1000]">
            {error ? (
              <>
                <AlertCircle className="text-red-400" size={26} />
                <p className="text-sm text-red-400 px-6 text-center">{error}</p>
              </>
            ) : (
              <>
                <Loader2 className="animate-spin text-blue-400" size={22} />
                <p className="text-sm text-gray-400">{status}</p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
