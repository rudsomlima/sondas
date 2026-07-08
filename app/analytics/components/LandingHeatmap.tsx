'use client'

import { useEffect, useRef } from 'react'
import 'leaflet/dist/leaflet.css'
import { createBaseMap } from '@/app/lib/leafletBase'
import type { LandingCell } from '@/app/lib/metrics'
import type { Station } from '@/app/lib/stations'

interface LandingHeatmapProps {
  station: Station
  cells: LandingCell[]
}

// Gradiente de intensidade: ciano → âmbar → vermelho.
function cellColor(count: number, max: number): string {
  const t = max <= 1 ? 1 : count / max
  if (t < 0.4) return '#38bdf8'
  if (t < 0.75) return '#f59e0b'
  return '#ef4444'
}

// Mapa de calor de pousos com círculos Leaflet nativos (sem dependência nova).
export default function LandingHeatmap({ station, cells }: LandingHeatmapProps) {
  const divRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const leafletRef = useRef<any>(null)
  const layerRef = useRef<any>(null)

  useEffect(() => {
    let cancelled = false
    async function init() {
      if (mapRef.current || !divRef.current) return
      const L = (await import('leaflet')).default
      if (cancelled || !divRef.current || mapRef.current) return
      const { map, markersLayer } = createBaseMap(L, divRef.current)
      leafletRef.current = L
      mapRef.current = map
      layerRef.current = markersLayer
      map.setView([station.lat, station.lon], 8)
      setTimeout(() => map.invalidateSize(), 50)
      draw()
    }
    init()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return () => {
      mapRef.current?.remove()
      mapRef.current = null
      leafletRef.current = null
    }
  }, [])

  function draw() {
    const L = leafletRef.current
    const layer = layerRef.current
    const map = mapRef.current
    if (!L || !layer || !map) return
    layer.clearLayers()

    // Estação
    L.circleMarker([station.lat, station.lon], {
      radius: 6, color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.7, weight: 2,
    }).addTo(layer).bindPopup(`<b>${station.name}</b>`)

    if (cells.length === 0) return
    const max = Math.max(...cells.map(c => c.count))

    for (const c of cells) {
      L.circleMarker([c.lat, c.lon], {
        radius: 6 + Math.min(14, c.count * 3),
        color: cellColor(c.count, max),
        fillColor: cellColor(c.count, max),
        fillOpacity: 0.45,
        weight: 1,
      }).addTo(layer).bindPopup(`${c.count} pouso${c.count > 1 ? 's' : ''} nesta área`)
    }

    const lats = [...cells.map(c => c.lat), station.lat]
    const lons = [...cells.map(c => c.lon), station.lon]
    map.fitBounds([[Math.min(...lats), Math.min(...lons)], [Math.max(...lats), Math.max(...lons)]], { padding: [30, 30] })
  }

  // Redesenha quando as células mudam (ano/estação trocados).
  useEffect(() => { draw() /* eslint-disable-line react-hooks/exhaustive-deps */ }, [cells, station.id])

  return (
    <div className="panel overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <p className="panel-title">Mapa de calor de pousos</p>
      </div>
      <div className="relative h-[420px] bg-bg">
        <div ref={divRef} className="absolute inset-0" />
        <div className="absolute bottom-3 right-3 z-[900] bg-bg/50 backdrop-blur-sm rounded-md p-2 text-[10px] text-gray-300 space-y-1">
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: '#38bdf8' }} /> poucos</div>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: '#f59e0b' }} /> médio</div>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: '#ef4444' }} /> muitos</div>
        </div>
      </div>
    </div>
  )
}
