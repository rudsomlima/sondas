'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import 'leaflet/dist/leaflet.css'
import {
  statusColor, buildBalloonIcon, buildHighlightBalloonIcon,
  buildHighlightLiveBalloonIcon, gmt3IconLabel, gmt3IconLabelWithMonth,
  LIVE_COLOR, LEGEND_ITEMS, flightStatus, FLIGHT_STATUS_LABEL,
} from '@/app/lib/radiosondy'
import { createBaseMap } from '@/app/lib/leafletBase'
import { fetchLiveTrajectory, fetchArchiveTrajectory, analyzeTrajectory } from '@/app/lib/trajectory'
import { drawTrajectory } from '@/app/components/TrajectoryLayer'
import type { Station } from '@/app/lib/stations'
import { GMT3, nowGMT3 } from '@/app/lib/types'
import type { TodayFlight } from '@/app/lib/radiosondy'
import type { SelectedTarget } from '../selection'
import { isValidCoordinate } from '@/app/lib/launchData'
import { parseUtcDateStr } from '@/app/lib/launchUtils'
import { applyRegistryToPoints, sondePointPopup, type SondePoint } from '@/app/lib/sondePoints'
import type { SondeRecord } from '@/app/lib/sondeRegistry'
import { launchSitePopupHtml, POPUP_OPTIONS, simplePopupHtml } from '@/app/lib/mapPopups'
import { useReceiverStations } from '@/app/lib/receiverStationsClient'
import { drawReceiverStations, receptorsFromPoints } from '@/app/lib/receiverStationsLayer'

const BALLOON_SIZE = 15
const LIVE_BALLOON_SIZE = 40


interface MissionMapProps {
  station: Station
  // Todas as sondas do ano (mesma coleta do mapa anual — useYearSondePoints —
  // já completada com o registro do R2). O filtro Mês/Ano é do próprio mapa.
  points: SondePoint[]
  records?: Map<string, SondeRecord> // registro do R2, pra completar as sondas de hoje
  todayFlights: TodayFlight[]
  selected: SelectedTarget | null
  chasePos: { lat: number; lon: number } | null
  receiverPos?: { lat: number; lon: number } | null // posição do "meu receptor" (rxlat/rxlon via MQTT)
  receiverName?: string | null // callsign do "meu receptor", rotulado no marcador
}

// Mapa central do mission control: todas as sondas do ano (ou só do mês) +
// sondas de hoje + trajetória do voo selecionado + posição do caçador.
const NO_RECORDS = new Map<string, SondeRecord>()
const PERIOD_KEY = 'sondas_painel_map_period'
type MapPeriod = 'year' | 'month'

function inCurrentMonth(p: SondePoint): boolean {
  const now = nowGMT3()
  const ref = p.firstFrameUtc ? new Date(p.firstFrameUtc) : p.date
  const local = new Date((isNaN(ref.getTime()) ? p.date : ref).getTime() + GMT3)
  return local.getUTCFullYear() === now.getUTCFullYear() && local.getUTCMonth() === now.getUTCMonth()
}

// Sonda de hoje → ponto, pra usar o MESMO popup dos outros mapas
// (receptores, último sinal, recuperação) completado pelo registro.
function flightToPoint(f: TodayFlight): SondePoint {
  const date = parseUtcDateStr(f.lastReportUtc)
  return {
    serial: f.sondeNumber, lat: f.lat, lon: f.lon, status: 'UNKNOWN',
    date: isNaN(date.getTime()) ? new Date() : date, altitude: f.altitude,
    sources: [f.source.startsWith('radiosondy') ? 'radiosondy' : 'sondehub'],
    geographic: f.source === 'sondehub' || f.source === 'radiosondy-approx' || undefined,
    lastReceiver: f.lastReceiver,
    lastReceiverAt: f.lastReceiver && !isNaN(date.getTime()) ? date.toISOString().replace(/\.\d{3}Z$/, 'Z') : undefined,
    frequencyMHz: f.frequencyMHz,
  }
}

export default function MissionMap({ station, points, records = NO_RECORDS, todayFlights, selected, chasePos, receiverPos, receiverName }: MissionMapProps) {
  const [period, setPeriodState] = useState<MapPeriod>('year')
  useEffect(() => {
    try { const v = localStorage.getItem(PERIOD_KEY); if (v === 'year' || v === 'month') setPeriodState(v) } catch { }
  }, [])
  const setPeriod = (v: MapPeriod) => {
    setPeriodState(v)
    try { localStorage.setItem(PERIOD_KEY, v) } catch { }
  }
  const visiblePoints = useMemo(() => period === 'year' ? points : points.filter(inCurrentMonth), [points, period])
  const receiverStations = useReceiverStations()
  const mapDivRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const leafletRef = useRef<any>(null)
  const markersLayerRef = useRef<any>(null)
  const trajectoryLayerRef = useRef<any>(null)
  const chaseLayerRef = useRef<any>(null)
  const receiverLayerRef = useRef<any>(null)
  const [trajNote, setTrajNote] = useState<string | null>(null)
  const [mapReady, setMapReady] = useState(false)

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
      setMapReady(true)
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
      }).addTo(layer).bindPopup(launchSitePopupHtml(station), POPUP_OPTIONS)

      // Todas as sondas do período — mesmo conjunto e mesmo popup do mapa anual.
      const todaySerials = new Set(todayFlights.map(f => f.sondeNumber))
      for (const p of visiblePoints) {
        if (todaySerials.has(p.serial) || !isValidCoordinate(p.lat, p.lon)) continue // hoje tem marcador próprio
        const first = p.firstFrameUtc ? new Date(p.firstFrameUtc) : null
        const labelDate = first && !isNaN(first.getTime()) ? first : p.date
        L.marker([p.lat, p.lon], {
          icon: buildBalloonIcon(L, statusColor(p.status), BALLOON_SIZE,
            period === 'year' ? gmt3IconLabelWithMonth(labelDate) : gmt3IconLabel(labelDate)),
        }).addTo(layer).bindPopup(sondePointPopup(p), POPUP_OPTIONS)
      }

      // Sondas de hoje (em voo = paraquedas pulsante; pousada = balão destacado)
      for (const f of todayFlights) {
        if (!isValidCoordinate(f.lat, f.lon)) continue
        const reportDate = parseUtcDateStr(f.lastReportUtc)
        const label = isNaN(reportDate.getTime()) ? undefined : gmt3IconLabel(reportDate)
        const icon = f.isLive
          ? buildHighlightLiveBalloonIcon(L, LIVE_COLOR, LIVE_BALLOON_SIZE, label)
          : buildHighlightBalloonIcon(L, statusColor('UNKNOWN'), BALLOON_SIZE, label)
        const pt = applyRegistryToPoints([flightToPoint(f)], records)[0]
        const banner = {
          text: f.isLive
            ? `Em voo agora · ${f.climbing > 0 ? 'subindo' : 'descendo'} ${Math.abs(f.climbing).toFixed(1)} m/s`
            : FLIGHT_STATUS_LABEL[flightStatus(f)],
          color: f.isLive ? LIVE_COLOR : '#22c55e',
        }
        L.marker([f.lat, f.lon], { icon, zIndexOffset: 1000 }).addTo(layer).bindPopup(sondePointPopup(pt, { banner }), POPUP_OPTIONS)
      }
    }
  }, [station, visiblePoints, records, todayFlights, period, mapReady])

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
  }, [selected, station.id, mapReady])

  // Posição do caçador + linha até o alvo.
  useEffect(() => {
    const L = leafletRef.current
    const layer = chaseLayerRef.current
    if (!L || !layer) return
    layer.clearLayers()
    if (!chasePos) return

    L.circleMarker([chasePos.lat, chasePos.lon], {
      radius: 7, color: '#3b82f6', fillColor: '#60a5fa', fillOpacity: 0.9, weight: 2,
    }).addTo(layer).bindPopup(simplePopupHtml({
      title: 'Você', subtitle: 'Posição do navegador (perseguição)', icon: 'crosshair', color: '#60a5fa',
      rows: [{ icon: 'pin', label: 'Posição', value: `${chasePos.lat.toFixed(5)}, ${chasePos.lon.toFixed(5)}` }],
    }), POPUP_OPTIONS)

    if (selected) {
      L.polyline([[chasePos.lat, chasePos.lon], [selected.lat, selected.lon]], {
        color: '#3b82f6', weight: 2, dashArray: '8 6', opacity: 0.7,
      }).addTo(layer)
    }
  }, [chasePos, selected, mapReady])

  // Estações receptoras: todas as que receberam alguma sonda visível no mapa
  // (posição vinda do SondeHub, guardada no R2) + o "meu receptor" sempre.
  // Mesmo ícone de antena; vermelho = meu receptor, verde-água = demais.
  useEffect(() => {
    const L = leafletRef.current
    const layer = receiverLayerRef.current
    if (!L || !layer) return
    const counts = receptorsFromPoints([
      ...visiblePoints,
      ...applyRegistryToPoints(todayFlights.map(flightToPoint), records),
    ])
    drawReceiverStations(L, layer, receiverStations, counts, { callsign: receiverName, pos: receiverPos })
  }, [visiblePoints, todayFlights, records, receiverStations, receiverPos, receiverName, mapReady])

  return (
    <div className="panel overflow-hidden h-full flex flex-col">
      <div className="relative flex-1 min-h-[420px] lg:min-h-0 bg-bg">
        <div ref={mapDivRef} className="absolute inset-0" />
        <div className="absolute top-3 right-3 z-[900] flex rounded-md overflow-hidden border border-border bg-bg/85 backdrop-blur-sm text-[11px]">
          {(['month', 'year'] as MapPeriod[]).map(v => (
            <button
              key={v}
              onClick={() => setPeriod(v)}
              className={`px-2.5 py-1 transition-colors ${period === v ? 'bg-blue-500/30 text-white' : 'text-gray-400 hover:text-white'}`}
              title={v === 'year' ? 'Todas as sondas do ano (igual ao mapa do histórico anual)' : 'Só as sondas do mês corrente'}
            >
              {v === 'year' ? `Ano (${points.length})` : 'Mês'}
            </button>
          ))}
        </div>
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
