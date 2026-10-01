'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import 'leaflet/dist/leaflet.css'
import { AlertCircle, Loader2, RefreshCw, X, Maximize2, Minimize2 } from 'lucide-react'
import { statusColor, buildBalloonIcon, buildClusterIcon, gmt3IconLabelWithMonth, LEGEND_ITEMS } from '@/app/lib/radiosondy'
import { stationCode, type Station } from '@/app/lib/stations'
import { createBaseMap } from '@/app/lib/leafletBase'
import type { Launch } from '@/app/lib/types'
import { mergeSondePoints, mergeWithRegistry, sondePointPopup, type SondePoint } from '@/app/lib/sondePoints'
import { launchSitePopupHtml, POPUP_OPTIONS, clusterPopupHtml } from '@/app/lib/mapPopups'
import { useReceiverStations } from '@/app/lib/receiverStationsClient'
import { drawReceiverStations, receptorsFromPoints } from '@/app/lib/receiverStationsLayer'
import { countReappearances, drawReappearances } from '@/app/lib/reappearanceLayer'
import { clusterByPixel, clusterBounds, isClusterDegenerate } from '@/app/lib/markerClustering'
import { useLandedSondeClusteringEnabled } from '@/app/lib/mapDisplaySettings'
import { reappearanceCountLabel } from '@/app/lib/reappearance'
import { STATUS_COLORS } from '@/app/lib/tokens'
import { getSettings } from '@/app/lib/settings'
import { useFullscreen } from '@/app/lib/useFullscreen'
import { useYearSondePoints } from './hooks/useYearSondePoints'
import { useSondeRegistry } from './hooks/useSondeRegistry'

const BALLOON_SIZE = 15
const BALLOON_CLUSTER_RADIUS_PX = 26 // cobre o balão (15px) + rótulo de dia/mês (16px)

interface YearMapProps {
  year: number
  // Uma ou mais estações (histórico na aba "Todas") — todas no MESMO mapa.
  stations: Station[]
  // Lançamentos do ano; com várias estações, cada um diz a sua em `stationId`.
  launches: Launch[]
  onClose: () => void
  // Posições reunidas de cada estação, para a página preencher lançamentos sem posição.
  onPoints?: (stationId: string, points: SondePoint[]) => void
}

interface StationPointsState {
  points: SondePoint[]
  status: string | null
  error: string | null
  sources: string[]
  refresh: () => void
}

const NO_LAUNCHES: Launch[] = []

/**
 * Coleta de UMA estação pro mapa (useYearSondePoints + registro do R2). O
 * mapa monta uma por estação e junta — hooks de estação nunca em laço.
 */
function StationPointsSource({ station, year, launches, onState }: {
  station: Station; year: number; launches: Launch[]
  onState: (stationId: string, state: StationPointsState | null) => void
}) {
  const { points: sourcePoints, status, error, sources, refresh } = useYearSondePoints(station, year, launches)
  // Mais recentes primeiro: é a ordem em que o registro é completado nas fontes.
  const serials = useMemo(() => [...sourcePoints].sort((a, b) => b.date.getTime() - a.date.getTime()).map(p => p.serial), [sourcePoints])
  const records = useSondeRegistry(station.id, [year], serials)
  const points = useMemo(() => mergeWithRegistry(sourcePoints, records,
    (r, p) => !!r.stations?.includes(station.id) && p.date.getUTCFullYear() === year),
  [sourcePoints, records, station.id, year])
  useEffect(() => { onState(station.id, { points, status, error, sources, refresh }) }, [station.id, points, status, error, sources, refresh, onState])
  useEffect(() => () => onState(station.id, null), [station.id, onState])
  return null
}

/**
 * Mapa consolidado do ano: todas as fontes (useYearSondePoints) + o registro
 * permanente de sondas no R2 (useSondeRegistry), que completa o que as fontes
 * não devolvem mais e traz receptores/último sinal pro popup. Com várias
 * estações, todas aparecem juntas (local de lançamento de cada uma).
 */
export default function YearMap({ year, stations, launches, onClose, onPoints }: YearMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapDivRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const leafletRef = useRef<any>(null)
  const markersLayerRef = useRef<any>(null)
  const stationsLayerRef = useRef<any>(null)
  const fittedRef = useRef(false)
  // Bumped a cada `zoomend` — entra na dependência do efeito de desenho pra
  // reagrupar os marcadores quando o nível de zoom muda (só zoom importa:
  // arrastar o mapa não muda distância em pixels entre dois lat/lon fixos).
  const [zoomTick, setZoomTick] = useState(0)
  // Configurações → Exibição: liga/desliga o agrupamento de sondas
  // pousadas (não afeta reaparecimentos nem estações receptoras).
  const clusterEnabled = useLandedSondeClusteringEnabled()
  const receiverStations = useReceiverStations()
  // Tela cheia do mapa (botão no cabeçalho); o Leaflet precisa recalcular o
  // tamanho ao entrar/sair.
  const invalidateMap = useCallback(() => mapRef.current?.invalidateSize(), [])
  const fs = useFullscreen(containerRef, invalidateMap)
  const multi = stations.length > 1
  // Lançamentos de cada estação (uma só = todos).
  const launchesByStation = useMemo(() => {
    const map = new Map<string, Launch[]>()
    for (const st of stations) map.set(st.id, multi ? launches.filter(l => (l.stationId ?? stations[0].id) === st.id) : launches)
    return map
  }, [stations, launches, multi])

  const [perStation, setPerStation] = useState<Record<string, StationPointsState>>({})
  const onStationState = useCallback((stationId: string, state: StationPointsState | null) => {
    setPerStation(prev => {
      if (state === null) {
        if (!(stationId in prev)) return prev
        const next = { ...prev }
        delete next[stationId]
        return next
      }
      return { ...prev, [stationId]: state }
    })
  }, [])
  const states = stations.map(s => perStation[s.id]).filter((x): x is StationPointsState => !!x)
  const points = useMemo(() => {
    const list = stations.map(s => perStation[s.id]?.points).filter((x): x is SondePoint[] => !!x)
    return list.length === 1 ? list[0] : mergeSondePoints(...list)
  }, [stations, perStation])
  const status = states.length < stations.length ? 'Buscando posições…' : states.find(s => s.status)?.status ?? null
  const error = states.filter(s => s.error).map(s => s.error).join(' · ') || null
  const sources = [...new Set(states.flatMap(s => s.sources))]
  const refresh = () => { for (const s of states) s.refresh() }
  const stationInfo = stations[0] ?? null

  // Cada estação devolve suas posições assim que termina de buscar.
  const onPointsRef = useRef(onPoints)
  onPointsRef.current = onPoints
  const sentRef = useRef(new Map<string, SondePoint[]>())
  useEffect(() => {
    for (const [id, st] of Object.entries(perStation)) {
      if (st.status || st.points.length === 0 || sentRef.current.get(id) === st.points) continue
      sentRef.current.set(id, st.points)
      onPointsRef.current?.(id, st.points)
    }
  }, [perStation])

  useEffect(() => { containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!mapDivRef.current || !stationInfo) return
      const L = leafletRef.current ?? (await import('leaflet')).default
      if (cancelled || !mapDivRef.current) return
      leafletRef.current = L
      if (!mapRef.current) {
        const { map: newMap, markersLayer } = createBaseMap(L, mapDivRef.current)
        mapRef.current = newMap
        markersLayerRef.current = markersLayer
        stationsLayerRef.current = L.layerGroup().addTo(mapRef.current)
        // Reagrupa (clusterByPixel depende do zoom atual) quando o zoom muda.
        newMap.on('zoomend', () => setZoomTick(t => t + 1))
      }
      const map = mapRef.current
      const layer = markersLayerRef.current
      layer.clearLayers()
      // Limites a partir dos pontos crus (+ reaparecimentos, que podem estar
      // longe do pouso) — geometria pura, não depende do mapa já ter uma
      // vista (zoom/centro) definida.
      const rawBounds = L.latLngBounds(points.map(p => [p.lat, p.lon]))
      for (const p of points) for (const r of p.reappearances ?? []) rawBounds.extend([r.lat, r.lon])
      // Enquadra ANTES de agrupar: `clusterByPixel`/`drawReappearances`
      // projetam lat/lon em pixels de tela (`latLngToContainerPoint`), que o
      // Leaflet só sabe fazer depois que o mapa já tem zoom/centro — na
      // primeira carga, sem isso, o Leaflet lança "Set map center and zoom
      // first". Só a primeira vez muda a vista; depois disso ela já existe.
      if (!fittedRef.current) {
        if (points.length > 0) { map.fitBounds(rawBounds, { padding: [30, 30], maxZoom: 11 }); fittedRef.current = true }
        else if (stations.length > 1) map.fitBounds(stations.map(s => [s.lat, s.lon]), { padding: [30, 30], maxZoom: 8 })
        else map.setView([stationInfo.lat, stationInfo.lon], 8)
      }
      // Local de lançamento de cada estação mostrada.
      for (const st of stations) {
        L.circleMarker([st.lat, st.lon], {
          radius: 6, color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.65, weight: 2,
        }).addTo(layer).bindPopup(launchSitePopupHtml(st), POPUP_OPTIONS)
      }
      // Marcadores próximos demais pra este zoom viram um badge com contagem
      // (ver markerClustering.ts) — some sozinho ao aproximar o zoom.
      for (const g of clusterByPixel(map, points, BALLOON_CLUSTER_RADIUS_PX, clusterEnabled)) {
        if (g.items.length === 1) {
          const p = g.items[0]
          L.marker([p.lat, p.lon], {
            icon: buildBalloonIcon(L, statusColor(p.status), BALLOON_SIZE, gmt3IconLabelWithMonth(p.date)),
          }).addTo(layer).bindPopup(sondePointPopup(p), POPUP_OPTIONS)
        } else {
          const marker = L.marker([g.anchor.lat, g.anchor.lon], { icon: buildClusterIcon(L, g.items.length) }).addTo(layer)
          if (isClusterDegenerate(g.anchor, g.items)) {
            marker.bindPopup(clusterPopupHtml(g.items.map(p => sondePointPopup(p))), POPUP_OPTIONS)
          } else {
            marker.on('click', () => map.fitBounds(clusterBounds(L, g.items), { padding: [50, 50], maxZoom: map.getZoom() + 4 }))
          }
        }
      }
      // Sondas reportadas de novo depois do voo: alfinete violeta ligado ao
      // pouso por uma linha tracejada (o pouso acima continua no lugar dele).
      drawReappearances(L, map, layer, points, {})
      // Estações que receberam alguma sonda do ano (+ o meu receptor).
      const settings = getSettings()
      drawReceiverStations(L, map, stationsLayerRef.current, receiverStations, receptorsFromPoints(points), {
        callsign: settings.uploaderCallsign,
        pos: settings.homeLat != null && settings.homeLon != null ? { lat: settings.homeLat, lon: settings.homeLon } : null,
      })
      setTimeout(() => map?.invalidateSize(), 50)
    })()
    return () => { cancelled = true }
  }, [points, stationInfo, stations, receiverStations, zoomTick, clusterEnabled])

  useEffect(() => () => {
    mapRef.current?.remove()
    mapRef.current = null
  }, [])

  const fromRegistry = points.filter(p => p.sources.length === 1 && p.sources[0] === 'registry').length
  const reappearances = countReappearances(points)
  const shownError = !stationInfo ? 'Estação inválida ou sem coordenadas cadastradas.'
    : !status && points.length === 0 ? 'Nenhuma posição foi encontrada no cache, radiosondy.info, SondeHub ou registro do app.'
    : error

  return (
    <div
      ref={containerRef}
      className={`border border-border overflow-hidden bg-bg ${fs.isFullscreen ? 'flex flex-col' : 'mt-3 rounded'} ${fs.pseudo ? 'fixed inset-0 z-[2000]' : ''}`}
    >
      {stations.map(st => (
        <StationPointsSource key={st.id} station={st} year={year} launches={launchesByStation.get(st.id) ?? NO_LAUNCHES} onState={onStationState} />
      ))}
      <div className="px-3 py-2 bg-surface border-b border-border flex items-center gap-3 flex-wrap">
        <span className="text-xs text-gray-300">
          Mapa consolidado de {year}
          {multi && <span className="mono text-blue-300" title={stations.map(s => s.name).join(', ')}> · {stations.map(stationCode).join(' + ')}</span>}
        </span>
        {points.length > 0 && <span className="text-[11px] text-emerald-400 mono">{points.length} posições</span>}
        {reappearances > 0 && (
          <span className="text-[11px] mono" style={{ color: STATUS_COLORS.reappeared }}
            title="Sondas reportadas de novo depois do voo, em outro lugar — cada uma ligada ao pouso original por uma linha tracejada">
            {reappearanceCountLabel(reappearances)}
          </span>
        )}
        {sources.length > 0 && <span className="text-[11px] text-dim">fontes: {sources.join(' + ')}{fromRegistry > 0 ? ` + registro (${fromRegistry} só no app)` : ''}</span>}
        {status && points.length > 0 && <span className="text-[11px] text-blue-300 flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> complementando…</span>}
        <button onClick={refresh} className="ml-auto text-gray-400 hover:text-white" title="Tentar novamente">
          <RefreshCw size={14} />
        </button>
        <button
          onClick={fs.toggle}
          className="text-gray-400 hover:text-white flex-shrink-0"
          title={fs.isFullscreen ? 'Sair da tela cheia (Esc)' : 'Tela cheia'}
          aria-label={fs.isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
        >
          {fs.isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
        <button onClick={onClose} className="text-gray-400 hover:text-white" title="Fechar mapa"><X size={15} /></button>
      </div>

      <div className={`relative bg-bg ${fs.isFullscreen ? 'flex-1 min-h-0' : 'h-[280px] sm:h-[340px] lg:h-[420px]'}`}>
        <div ref={mapDivRef} className="absolute inset-0" />
        {!status && points.length > 0 && (
          <div className="absolute bottom-3 right-3 z-[900] bg-white/85 backdrop-blur-sm rounded-md p-2.5 text-xs text-black space-y-1.5">
            {LEGEND_ITEMS.map(item => <div key={item.label} className="flex items-center gap-2" title={item.title}>
              <span className="inline-block w-2.5 h-3 rounded-sm" style={{ background: item.color }} />{item.label}
            </div>)}
          </div>
        )}
        {status && points.length === 0 && <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-bg/90 z-[1000]">
          <Loader2 className="animate-spin text-blue-400" size={22} /><p className="text-sm text-gray-400">{status}</p>
        </div>}
        {shownError && <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] max-w-[90%] bg-bg/90 border border-yellow-500/30 rounded px-3 py-2 flex items-center gap-2 text-xs text-yellow-300">
          <AlertCircle size={14} className="shrink-0" />{shownError}
        </div>}
      </div>
    </div>
  )
}
