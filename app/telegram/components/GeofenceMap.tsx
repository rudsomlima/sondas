'use client'

import { useEffect, useRef } from 'react'
import 'leaflet/dist/leaflet.css'
import 'leaflet-draw/dist/leaflet.draw.css'
import { createBaseMap } from '@/app/lib/leafletBase'
import { SOUTH_AMERICA_STATIONS, type Station } from '@/app/lib/stations'
import type { Geofence, GeofenceShape } from '@/app/lib/telegramTypes'

interface GeofenceMapProps {
  station: Station
  areas: Geofence[]
  onChange: (areas: Geofence[]) => void
  // id da estação → raio de alcance (km), só das estações monitoradas
  watchedRadii: Record<string, number>
  onToggleStation: (id: string) => void
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
export default function GeofenceMap({ station, areas, onChange, watchedRadii, onToggleStation }: GeofenceMapProps) {
  const mapDivRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const leafletRef = useRef<any>(null)
  const drawnItemsRef = useRef<any>(null)
  const idByLayerRef = useRef<Map<any, string>>(new Map())
  const areasRef = useRef(areas)
  const onChangeRef = useRef(onChange)
  areasRef.current = areas
  onChangeRef.current = onChange
  const stationsLayerRef = useRef<any>(null)
  const watchedRef = useRef(watchedRadii)
  const toggleRef = useRef(onToggleStation)
  const busyRef = useRef(false) // desenhando/editando/apagando: cliques nas estações não valem
  watchedRef.current = watchedRadii
  toggleRef.current = onToggleStation

  // Estações existentes: ponto cinza (clique liga/desliga o monitoramento);
  // as monitoradas ficam azul-ciano com um círculo do raio, sem preenchimento.
  function drawStations() {
    const L = leafletRef.current
    const layer = stationsLayerRef.current
    if (!L || !layer) return
    layer.clearLayers()
    for (const st of SOUTH_AMERICA_STATIONS) {
      const radius = watchedRef.current[st.id]
      const on = radius !== undefined
      const dot = L.circleMarker([st.lat, st.lon], {
        radius: on ? 6 : 4, color: on ? '#06b6d4' : '#9ca3af', weight: 2,
        fillColor: on ? '#06b6d4' : '#374151', fillOpacity: 0.9,
      })
      dot.bindTooltip(`${st.name} (${st.id})${on ? ` — ${radius} km` : ' — clique para monitorar'}`)
      dot.on('click', () => { if (!busyRef.current) toggleRef.current(st.id) })
      layer.addLayer(dot)
      if (on) {
        layer.addLayer(L.circle([st.lat, st.lon], {
          radius: radius * 1000, color: '#06b6d4', weight: 2, fill: false, interactive: false,
        }))
      }
    }
  }

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

      stationsLayerRef.current = L.layerGroup().addTo(map)
      drawStations()

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

      const D = (L as any).Draw.Event
      for (const ev of [D.DRAWSTART, D.EDITSTART, D.DELETESTART]) map.on(ev, () => { busyRef.current = true })
      for (const ev of [D.DRAWSTOP, D.EDITSTOP, D.DELETESTOP]) map.on(ev, () => { busyRef.current = false })

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

  useEffect(() => { drawStations() }, [watchedRadii])  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="panel overflow-hidden">
      <div ref={mapDivRef} className="h-[420px] bg-bg" />
    </div>
  )
}
