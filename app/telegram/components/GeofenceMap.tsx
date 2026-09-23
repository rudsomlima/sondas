'use client'

import { useEffect, useRef } from 'react'
import 'leaflet/dist/leaflet.css'
import 'leaflet-draw/dist/leaflet.draw.css'
import { createBaseMap } from '@/app/lib/leafletBase'
import type { Station } from '@/app/lib/stations'
import type { Geofence, GeofenceShape } from '@/app/lib/telegramTypes'

interface GeofenceMapProps {
  station: Station
  areas: Geofence[]
  onChange: (areas: Geofence[]) => void
}

function shapeFromLayer(L: any, layer: any): GeofenceShape | null {
  if (layer instanceof L.Circle) {
    const c = layer.getLatLng()
    return { type: 'circle', center: [c.lat, c.lng], radiusM: Math.round(layer.getRadius()) }
  }
  if (layer instanceof L.Polygon) {
    const latlngs = (layer.getLatLngs()[0] as any[]).map(p => [p.lat, p.lng] as [number, number])
    return { type: 'polygon', points: latlngs }
  }
  return null
}

function styleFor(enabled: boolean) {
  return enabled
    ? { color: '#f97316', dashArray: undefined, opacity: 1, fillOpacity: 0.2 }
    : { color: '#6b7280', dashArray: '6 6', opacity: 0.6, fillOpacity: 0.05 }
}

function layerFromShape(L: any, shape: GeofenceShape, enabled: boolean): any {
  return shape.type === 'circle'
    ? L.circle(shape.center, { radius: shape.radiusM, ...styleFor(enabled) })
    : L.polygon(shape.points, styleFor(enabled))
}

const TOOLTIP_OPTS = { permanent: true, direction: 'center' as const, className: 'geofence-label' }

/**
 * Mapa Leaflet + leaflet-draw pra desenhar/editar/apagar as áreas de
 * interesse (polígonos e círculos) avisadas quando uma sonda pousa dentro
 * delas (ver /api/telegram-notify). O mapa é dono da geometria; a lista
 * abaixo dele (telegram/page.tsx) só renomeia/apaga — mudanças feitas por
 * lá são refletidas aqui pelo efeito de sincronização no fim do arquivo.
 */
export default function GeofenceMap({ station, areas, onChange }: GeofenceMapProps) {
  const mapDivRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const leafletRef = useRef<any>(null)
  const drawnItemsRef = useRef<any>(null)
  const idByLayerRef = useRef<Map<any, string>>(new Map())
  const areasRef = useRef(areas)
  const onChangeRef = useRef(onChange)
  areasRef.current = areas
  onChangeRef.current = onChange

  // Inicialização única do Leaflet + leaflet-draw.
  useEffect(() => {
    let cancelled = false
    async function init() {
      if (mapRef.current || !mapDivRef.current) return
      const L = (await import('leaflet')).default
      await import('leaflet-draw')
      if (cancelled || !mapDivRef.current || mapRef.current) return

      const { map } = createBaseMap(L, mapDivRef.current)
      leafletRef.current = L
      mapRef.current = map
      map.setView([station.lat, station.lon], 9)

      const drawnItems = new L.FeatureGroup()
      map.addLayer(drawnItems)
      drawnItemsRef.current = drawnItems

      for (const area of areasRef.current) {
        const layer = layerFromShape(L, area.shape, area.enabled !== false)
        layer.bindTooltip(area.name, TOOLTIP_OPTS)
        drawnItems.addLayer(layer)
        idByLayerRef.current.set(layer, area.id)
      }

      const drawControl = new (L as any).Control.Draw({
        position: 'topleft',
        edit: { featureGroup: drawnItems },
        draw: {
          polygon: { shapeOptions: { color: '#f97316' }, showArea: false },
          circle: { shapeOptions: { color: '#f97316' } },
          rectangle: false, polyline: false, marker: false, circlemarker: false,
        },
      })
      map.addControl(drawControl)

      map.on((L as any).Draw.Event.CREATED, (e: any) => {
        const layer = e.layer
        const shape = shapeFromLayer(L, layer)
        if (!shape) return
        const name = (window.prompt('Nome da área de interesse (ex.: "Praia do Forte")', '') || '').trim() || 'Área sem nome'
        const id = `geo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        layer.bindTooltip(name, TOOLTIP_OPTS)
        drawnItems.addLayer(layer)
        idByLayerRef.current.set(layer, id)
        onChangeRef.current([...areasRef.current, { id, name, shape, enabled: true, createdAt: Date.now() }])
      })

      map.on((L as any).Draw.Event.EDITED, (e: any) => {
        const updates = new Map<string, GeofenceShape>()
        e.layers.eachLayer((layer: any) => {
          const id = idByLayerRef.current.get(layer)
          const shape = shapeFromLayer(L, layer)
          if (id && shape) updates.set(id, shape)
        })
        onChangeRef.current(areasRef.current.map(a => updates.has(a.id) ? { ...a, shape: updates.get(a.id)! } : a))
      })

      map.on((L as any).Draw.Event.DELETED, (e: any) => {
        const removedIds = new Set<string>()
        e.layers.eachLayer((layer: any) => {
          const id = idByLayerRef.current.get(layer)
          if (id) removedIds.add(id)
          idByLayerRef.current.delete(layer)
        })
        onChangeRef.current(areasRef.current.filter(a => !removedIds.has(a.id)))
      })

      setTimeout(() => map.invalidateSize(), 50)
    }
    init()
    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sincroniza remoções/renomeações feitas na lista (fora do mapa) de volta
  // pras camadas desenhadas — o mapa continua sendo a fonte da geometria.
  useEffect(() => {
    const L = leafletRef.current
    const drawnItems = drawnItemsRef.current
    if (!L || !drawnItems) return
    const currentIds = new Set(areas.map(a => a.id))
    for (const [layer, id] of idByLayerRef.current.entries()) {
      if (!currentIds.has(id)) {
        drawnItems.removeLayer(layer)
        idByLayerRef.current.delete(layer)
        continue
      }
      const area = areas.find(a => a.id === id)
      if (!area) continue
      layer.setTooltipContent(area.name)
      layer.setStyle(styleFor(area.enabled !== false))
    }
  }, [areas])

  return (
    <div className="panel overflow-hidden">
      <div ref={mapDivRef} className="h-[420px] bg-bg" />
    </div>
  )
}
