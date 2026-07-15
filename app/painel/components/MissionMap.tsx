'use client'

import { useEffect, useRef, useState } from 'react'
import 'leaflet/dist/leaflet.css'
import {
  statusColor, buildBalloonIcon, buildHighlightBalloonIcon,
  buildHighlightLiveBalloonIcon, gmt3IconLabel, launchUtcInstant,
  LIVE_COLOR, LEGEND_ITEMS,
} from '@/app/lib/radiosondy'
import { createBaseMap } from '@/app/lib/leafletBase'
import { STATUS_COLORS } from '@/app/lib/tokens'
import { fetchLiveTrajectory, fetchArchiveTrajectory, analyzeTrajectory } from '@/app/lib/trajectory'
import { drawTrajectory } from '@/app/components/TrajectoryLayer'
import type { Station } from '@/app/lib/stations'
import type { Launch } from '@/app/lib/types'
import type { TodayFlight } from '@/app/lib/radiosondy'
import type { SelectedTarget } from '../selection'

const BALLOON_SIZE = 15

// Ícone de antena (mesmos paths do lucide-react "Antenna", viewBox 24x24)
// para o marcador do "meu receptor" no mapa — só o glifo em vermelho (sem
// círculo de fundo), com o nome/callsign da estação como rótulo abaixo,
// mesmo estilo de "pill" escura usado nos rótulos de dia/noite dos balões.
function antennaIconMarkup(name: string, sizePx: number): string {
  return `
    <div style="display:flex;flex-direction:column;align-items:center;">
      <svg width="${sizePx}" height="${sizePx}" viewBox="0 0 24 24"
        fill="none" stroke="${STATUS_COLORS.lost}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
        style="filter:drop-shadow(0 1px 2px rgba(0,0,0,0.9));">
        <path d="M2 12 7 2"/><path d="m7 12 5-10"/><path d="m12 12 5-10"/><path d="m17 12 5-10"/>
        <path d="M4.5 7h15"/><path d="M12 16v6"/>
      </svg>
      <div style="margin-top:2px;background:rgba(0,0,0,0.75);border:1px solid rgba(255,255,255,0.4);border-radius:4px;padding:1px 5px;white-space:nowrap;">
        <span style="color:#fff;font-size:10px;font-family:monospace;font-weight:700;">${name}</span>
      </div>
    </div>`
}

interface MissionMapProps {
  station: Station
  monthLaunches: Launch[] // lançamentos do mês corrente (pousos como contexto)
  todayFlights: TodayFlight[]
  selected: SelectedTarget | null
  chasePos: { lat: number; lon: number } | null
  receiverPos?: { lat: number; lon: number } | null // posição do "meu receptor" (rxlat/rxlon via MQTT)
  receiverName?: string | null // callsign do "meu receptor", rotulado no marcador
}

// Mapa central do mission control: pousos do mês + sondas de hoje +
// trajetória do voo selecionado + posição do caçador.
export default function MissionMap({ station, monthLaunches, todayFlights, selected, chasePos, receiverPos, receiverName }: MissionMapProps) {
  const mapDivRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const leafletRef = useRef<any>(null)
  const markersLayerRef = useRef<any>(null)
  const trajectoryLayerRef = useRef<any>(null)
  const chaseLayerRef = useRef<any>(null)
  const receiverLayerRef = useRef<any>(null)
  const [trajNote, setTrajNote] = useState<string | null>(null)

  // Inicialização única do Leaflet.
  useEffect(() => {
    let cancelled = false
    async function init() {
      if (mapRef.current || !mapDivRef.current) return
      const L = (await import('leaflet')).default
      if (cancelled || !mapDivRef.current || mapRef.current) return
      const { map, markersLayer } = createBaseMap(L, mapDivRef.current)
      leafletRef.current = L
      mapRef.current = map
      markersLayerRef.current = markersLayer
      trajectoryLayerRef.current = L.layerGroup().addTo(map)
      chaseLayerRef.current = L.layerGroup().addTo(map)
      receiverLayerRef.current = L.layerGroup().addTo(map)
      map.setView([station.lat, station.lon], 9)
      setTimeout(() => map.invalidateSize(), 50)
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

  // Recentra ao trocar de estação.
  useEffect(() => {
    mapRef.current?.setView([station.lat, station.lon], 9)
  }, [station.id, station.lat, station.lon])

  // Marcadores: estação + pousos do mês + sondas de hoje.
  useEffect(() => {
    const L = leafletRef.current
    const layer = markersLayerRef.current
    if (!L || !layer) {
      // Leaflet ainda não inicializou — este efeito roda de novo quando
      // monthLaunches/todayFlights mudarem; garantimos redraw pós-init com o
      // pequeno atraso do polling. Para o primeiro paint, agenda uma tentativa.
      const t = setTimeout(() => {
        if (leafletRef.current && markersLayerRef.current) redraw()
      }, 400)
      return () => clearTimeout(t)
    }
    redraw()

    function redraw() {
      const L = leafletRef.current
      const layer = markersLayerRef.current
      if (!L || !layer) return
      layer.clearLayers()

      // Estação (marcador fixo discreto)
      L.circleMarker([station.lat, station.lon], {
        radius: 6, color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.6, weight: 2,
      }).addTo(layer).bindPopup(`<b>${station.name}</b><br>STNM ${station.id}`)

      // Pousos do mês corrente
      const todaySerials = new Set(todayFlights.map(f => f.sondeNumber))
      for (const l of monthLaunches) {
        const pos = l.position
        if (!pos) continue
        if (todaySerials.has(pos.sondeNumber)) continue // sonda de hoje tem marcador próprio
        const instant = launchUtcInstant(l.year, l.month, l.day, l.time_utc, l.time_local)
        L.marker([pos.lat, pos.lon], {
          icon: buildBalloonIcon(L, statusColor(pos.status), BALLOON_SIZE, gmt3IconLabel(instant)),
        }).addTo(layer).bindPopup(
          `<b>${pos.sondeNumber}</b><br>Status: ${pos.status}` +
          (pos.altitude ? `<br>Altitude: ${Math.round(pos.altitude).toLocaleString('pt-BR')} m` : '')
        )
      }

      // Sondas de hoje (em voo = paraquedas pulsante; pousada = balão destacado)
      for (const f of todayFlights) {
        const icon = f.isLive
          ? buildHighlightLiveBalloonIcon(L, LIVE_COLOR, BALLOON_SIZE)
          : buildHighlightBalloonIcon(L, statusColor('UNKNOWN'), BALLOON_SIZE)
        L.marker([f.lat, f.lon], { icon, zIndexOffset: 1000 }).addTo(layer).bindPopup(
          `<b>${f.sondeNumber}</b><br>${f.isLive ? 'Em voo' : 'Pousada'}` +
          `<br>Altitude: ${Math.round(f.altitude).toLocaleString('pt-BR')} m` +
          (f.isLive ? `<br>Var. vertical: ${f.climbing.toFixed(1)} m/s` : '')
        )
      }
    }
  }, [station, monthLaunches, todayFlights])

  // Trajetória do voo selecionado.
  useEffect(() => {
    let cancelled = false
    const L = leafletRef.current
    const map = mapRef.current
    const layer = trajectoryLayerRef.current
    if (!L || !map || !layer) return

    layer.clearLayers()
    setTrajNote(null)

    if (!selected) return

    // Voa até a seleção imediatamente; a trilha chega depois.
    map.flyTo([selected.lat, selected.lon], 10, { duration: 0.8 })

    async function loadTrajectory() {
      try {
        let points = null as Awaited<ReturnType<typeof fetchLiveTrajectory>> | null
        try { points = await fetchLiveTrajectory(selected!.serial) } catch {}
        if (cancelled) return

        if ((!points || points.length < 2) && selected!.launch) {
          const l = selected!.launch
          const archive = await fetchArchiveTrajectory(station.id, l.year, l.month, l.day)
          if (cancelled) return
          if (archive && archive.points.length >= 2) points = archive.points
        }
        if (!points || points.length < 2) {
          setTrajNote('Trajetória não disponível para este voo.')
          return
        }
        const analysis = analyzeTrajectory(points)
        drawTrajectory(L, layer, points, analysis)
        setTrajNote(
          `estouro ${(analysis.maxAltM / 1000).toFixed(1)} km` +
          (analysis.durationMin ? ` · ${analysis.durationMin} min` : '') +
          (analysis.distanceKm ? ` · deriva ${Math.round(analysis.distanceKm)} km` : '') +
          (analysis.pointCount < 5 ? ' · resumida' : '')
        )
        const lats = points.map(p => p.lat)
        const lons = points.map(p => p.lon)
        map.fitBounds([[Math.min(...lats), Math.min(...lons)], [Math.max(...lats), Math.max(...lons)]], { padding: [40, 40] })
      } catch {
        if (!cancelled) setTrajNote('Erro ao buscar a trajetória.')
      }
    }
    loadTrajectory()
    return () => { cancelled = true }
  }, [selected, station.id])

  // Posição do caçador + linha até o alvo.
  useEffect(() => {
    const L = leafletRef.current
    const layer = chaseLayerRef.current
    if (!L || !layer) return
    layer.clearLayers()
    if (!chasePos) return

    L.circleMarker([chasePos.lat, chasePos.lon], {
      radius: 7, color: '#3b82f6', fillColor: '#60a5fa', fillOpacity: 0.9, weight: 2,
    }).addTo(layer).bindPopup('<b>Você</b>')

    if (selected) {
      L.polyline([[chasePos.lat, chasePos.lon], [selected.lat, selected.lon]], {
        color: '#3b82f6', weight: 2, dashArray: '8 6', opacity: 0.7,
      }).addTo(layer)
    }
  }, [chasePos, selected])

  // Posição do "meu receptor" (rxlat/rxlon publicado via MQTT) — ícone de
  // antena para diferenciar de "Você" (círculo azul, geolocalização do
  // navegador) e das sondas (balão/paraquedas).
  useEffect(() => {
    const L = leafletRef.current
    const layer = receiverLayerRef.current
    if (!L || !layer) return
    layer.clearLayers()
    if (!receiverPos) return

    const size = 26
    const labelH = 16
    L.marker([receiverPos.lat, receiverPos.lon], {
      icon: L.divIcon({
        html: antennaIconMarkup(receiverName || 'Meu receptor', size),
        className: '',
        iconSize: [Math.max(size, (receiverName?.length ?? 12) * 6), size + labelH],
        iconAnchor: [size / 2, size - 1],
      }),
    }).addTo(layer).bindPopup(`<b>${receiverName || 'Meu receptor'}</b>`)
  }, [receiverPos, receiverName])

  return (
    <div className="panel overflow-hidden h-full flex flex-col">
      <div className="relative flex-1 min-h-[420px] lg:min-h-0 bg-bg">
        <div ref={mapDivRef} className="absolute inset-0" />
        {trajNote && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[900] bg-bg/80 backdrop-blur-sm rounded-md px-3 py-1.5 text-[11px] text-sky-300 mono whitespace-nowrap">
            {trajNote}
          </div>
        )}
        <div className="absolute bottom-3 right-3 z-[900] bg-white/85 backdrop-blur-sm rounded-md p-2.5 text-xs text-black space-y-1.5">
          {LEGEND_ITEMS.map(item => (
            <div key={item.label} className="flex items-center gap-2">
              <span className="inline-block w-2.5 h-3 rounded-sm flex-shrink-0" style={{ background: item.color }} />
              {item.label}
            </div>
          ))}
          <div className="flex items-center gap-2">
            <span className="inline-block w-2.5 h-3 rounded-sm flex-shrink-0" style={{ background: LIVE_COLOR }} />
            Em voo
          </div>
        </div>
      </div>
    </div>
  )
}
