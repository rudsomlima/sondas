'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import 'leaflet/dist/leaflet.css'
import { AlertCircle, Loader2, RefreshCw, X, Maximize2, Minimize2 } from 'lucide-react'
import { statusColor, buildBalloonIcon, gmt3IconLabelWithMonth, LEGEND_ITEMS } from '@/app/lib/radiosondy'
import { findStation } from '@/app/lib/stations'
import { createBaseMap } from '@/app/lib/leafletBase'
import type { Launch } from '@/app/lib/types'
import { mergeWithRegistry, sondePointPopup, type SondePoint } from '@/app/lib/sondePoints'
import { launchSitePopupHtml, POPUP_OPTIONS } from '@/app/lib/mapPopups'
import { useReceiverStations } from '@/app/lib/receiverStationsClient'
import { drawReceiverStations, receptorsFromPoints } from '@/app/lib/receiverStationsLayer'
import { getSettings } from '@/app/lib/settings'
import { useFullscreen } from '@/app/lib/useFullscreen'
import { useYearSondePoints } from './hooks/useYearSondePoints'
import { useSondeRegistry } from './hooks/useSondeRegistry'

const BALLOON_SIZE = 15

interface YearMapProps {
  year: number
  station: string
  launches: Launch[]
  onClose: () => void
  // Todas as posições reunidas, para a página preencher lançamentos sem posição.
  onPoints?: (points: SondePoint[]) => void
}

/**
 * Mapa consolidado do ano: todas as fontes (useYearSondePoints) + o registro
 * permanente de sondas no R2 (useSondeRegistry), que completa o que as fontes
 * não devolvem mais e traz receptores/último sinal pro popup.
 */
export default function YearMap({ year, station, launches, onClose, onPoints }: YearMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapDivRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const leafletRef = useRef<any>(null)
  const markersLayerRef = useRef<any>(null)
  const stationsLayerRef = useRef<any>(null)
  const fittedRef = useRef(false)
  const receiverStations = useReceiverStations()
  // Tela cheia do mapa (botão no cabeçalho); o Leaflet precisa recalcular o
  // tamanho ao entrar/sair.
  const invalidateMap = useCallback(() => mapRef.current?.invalidateSize(), [])
  const fs = useFullscreen(containerRef, invalidateMap)
  const stationInfo = findStation(station) ?? null

  const { points: sourcePoints, status, error, sources, refresh } = useYearSondePoints(stationInfo, year, launches)
  // Mais recentes primeiro: é a ordem em que o registro é completado nas fontes.
  const serials = useMemo(() => [...sourcePoints].sort((a, b) => b.date.getTime() - a.date.getTime()).map(p => p.serial), [sourcePoints])
  const records = useSondeRegistry(stationInfo?.id ?? null, [year], serials)
  const points = useMemo(() => mergeWithRegistry(sourcePoints, records,
    (r, p) => !!stationInfo && !!r.stations?.includes(stationInfo.id) && p.date.getUTCFullYear() === year),
  [sourcePoints, records, stationInfo, year])

  const onPointsRef = useRef(onPoints)
  onPointsRef.current = onPoints
  useEffect(() => {
    if (!status && points.length > 0) onPointsRef.current?.(points)
  }, [status, points])

  useEffect(() => { containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!mapDivRef.current || !stationInfo) return
      const L = leafletRef.current ?? (await import('leaflet')).default
      if (cancelled || !mapDivRef.current) return
      leafletRef.current = L
      if (!mapRef.current) {
        const { map, markersLayer } = createBaseMap(L, mapDivRef.current)
        mapRef.current = map
        markersLayerRef.current = markersLayer
        stationsLayerRef.current = L.layerGroup().addTo(mapRef.current)
      }
      const layer = markersLayerRef.current
      layer.clearLayers()
      const bounds = L.latLngBounds([])
      L.circleMarker([stationInfo.lat, stationInfo.lon], {
        radius: 6, color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.65, weight: 2,
      }).addTo(layer).bindPopup(launchSitePopupHtml(stationInfo), POPUP_OPTIONS)
      for (const p of points) {
        L.marker([p.lat, p.lon], {
          icon: buildBalloonIcon(L, statusColor(p.status), BALLOON_SIZE, gmt3IconLabelWithMonth(p.date)),
        }).addTo(layer).bindPopup(sondePointPopup(p), POPUP_OPTIONS)
        bounds.extend([p.lat, p.lon])
      }
      // Enquadra só na primeira vez: não "pula" o mapa enquanto o usuário navega.
      if (!fittedRef.current) {
        if (points.length > 0) { mapRef.current.fitBounds(bounds, { padding: [30, 30], maxZoom: 11 }); fittedRef.current = true }
        else mapRef.current.setView([stationInfo.lat, stationInfo.lon], 8)
      }
      // Estações que receberam alguma sonda do ano (+ o meu receptor).
      const settings = getSettings()
      drawReceiverStations(L, stationsLayerRef.current, receiverStations, receptorsFromPoints(points), {
        callsign: settings.uploaderCallsign,
        pos: settings.homeLat != null && settings.homeLon != null ? { lat: settings.homeLat, lon: settings.homeLon } : null,
      })
      setTimeout(() => mapRef.current?.invalidateSize(), 50)
    })()
    return () => { cancelled = true }
  }, [points, stationInfo, receiverStations])

  useEffect(() => () => {
    mapRef.current?.remove()
    mapRef.current = null
  }, [])

  const fromRegistry = points.filter(p => p.sources.length === 1 && p.sources[0] === 'registry').length
  const shownError = !stationInfo ? 'Estação inválida ou sem coordenadas cadastradas.'
    : !status && points.length === 0 ? 'Nenhuma posição foi encontrada no cache, radiosondy.info, SondeHub ou registro do app.'
    : error

  return (
    <div
      ref={containerRef}
      className={`border border-border overflow-hidden bg-bg ${fs.isFullscreen ? 'flex flex-col' : 'mt-3 rounded'} ${fs.pseudo ? 'fixed inset-0 z-[2000]' : ''}`}
    >
      <div className="px-3 py-2 bg-surface border-b border-border flex items-center gap-3 flex-wrap">
        <span className="text-xs text-gray-300">Mapa consolidado de {year}</span>
        {points.length > 0 && <span className="text-[11px] text-emerald-400 mono">{points.length} posições</span>}
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
          <div className="absolute bottom-3 right-3 z-[900] bg-bg/70 backdrop-blur-sm rounded-md p-2.5 text-xs text-gray-200 space-y-1.5">
            {LEGEND_ITEMS.map(item => <div key={item.label} className="flex items-center gap-2">
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
