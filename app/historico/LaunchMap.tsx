'use client'

import { useEffect, useRef, useState } from 'react'
import 'leaflet/dist/leaflet.css'
import { AlertCircle, Loader2, ExternalLink, AlertTriangle, X } from 'lucide-react'
import {
  externalRadiosondyUrl, launchUtcInstant, fetchRadiosondyFeatures,
  findRecoveredMatch, fetchLiveFlights, findLiveMatch, isWithinMatchWindow,
  statusColor, buildBalloonIcon,
  buildHighlightBalloonIcon, gmt3IconLabel, LEGEND_ITEMS,
  RadiosondyFeature, roundToSynopticHour, sondeHubUrl,
} from '@/app/lib/radiosondy'
import { fetchSondeHubArchiveSondeForDay } from '@/app/lib/sondehub'
import { getRadiosondyStartplace, DEFAULT_STATION } from '@/app/lib/stations'
import type { Launch } from '@/app/lib/types'
import { fetchLiveTrajectory, fetchArchiveTrajectory, analyzeTrajectory, FlightAnalysis } from '@/app/lib/trajectory'
import { drawTrajectory } from '@/app/components/TrajectoryLayer'

const BALLOON_SIZE = 15

interface LaunchMapProps {
  launch: Launch
  onClose: () => void
  onResult?: (found: boolean) => void
  station?: string
}

export default function LaunchMap({ launch, onClose, onResult, station = DEFAULT_STATION.id }: LaunchMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapDivRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const markersLayerRef = useRef<any>(null)
  // Leaflet L guardado após o primeiro import — reutilizado sem await nos switches.
  const leafletRef = useRef<any>(null)
  const featuresCacheRef = useRef<Map<string, RadiosondyFeature[]>>(new Map())
  const [status, setStatus] = useState<string | null>('Consultando radiosondy.info…')
  const [error, setError] = useState<string | null>(null)
  const [approx, setApprox] = useState(false)
  const [sourceUrl, setSourceUrl] = useState<string | null>(null)
  const [sondeHubMapUrl, setSondeHubMapUrl] = useState<string | null>(null)
  const [isSondeHubPos, setIsSondeHubPos] = useState(false)
  // Trajetória completa do voo (sondehub.org): camada própria sobre o mapa.
  const trajectoryLayerRef = useRef<any>(null)
  const [trajLoading, setTrajLoading] = useState(false)
  const [trajAnalysis, setTrajAnalysis] = useState<FlightAnalysis | null>(null)
  const [trajError, setTrajError] = useState<string | null>(null)

  const startplace = getRadiosondyStartplace(station)
  const externalUrl = startplace ? externalRadiosondyUrl(launch.year, launch.month, startplace) : null

  // Serial conhecida (posição resolvida) habilita o botão de trajetória.
  const serial = launch.position?.sondeNumber

  async function toggleTrajectory() {
    const L = leafletRef.current
    const map = mapRef.current
    if (!L || !map) return

    // Já desenhada: remove (toggle off).
    if (trajAnalysis) {
      trajectoryLayerRef.current?.clearLayers()
      setTrajAnalysis(null)
      setTrajError(null)
      return
    }

    setTrajLoading(true)
    setTrajError(null)
    try {
      // Voo recente (até ~5 dias): API de telemetria tem alta resolução.
      // Voo antigo: arquivo S3 (pode ser resumido).
      let points = null as Awaited<ReturnType<typeof fetchLiveTrajectory>> | null
      const launchAge = Date.now() - new Date(`${launch.date}T12:00:00Z`).getTime()
      const isRecent = launchAge < 5 * 24 * 60 * 60 * 1000

      if (isRecent && serial) {
        try { points = await fetchLiveTrajectory(serial) } catch {}
      }
      if (!points || points.length < 2) {
        const archive = await fetchArchiveTrajectory(station, launch.year, launch.month, launch.day)
        if (archive && archive.points.length >= 2) points = archive.points
      }
      if (!points || points.length < 2) {
        setTrajError('Trajetória não disponível para este voo.')
        return
      }

      const analysis = analyzeTrajectory(points)
      if (!trajectoryLayerRef.current) {
        trajectoryLayerRef.current = L.layerGroup().addTo(map)
      }
      trajectoryLayerRef.current.clearLayers()
      drawTrajectory(L, trajectoryLayerRef.current, points, analysis)
      setTrajAnalysis(analysis)

      // Enquadra a trilha inteira.
      const lats = points.map(p => p.lat)
      const lons = points.map(p => p.lon)
      map.fitBounds([[Math.min(...lats), Math.min(...lons)], [Math.max(...lats), Math.max(...lons)]], { padding: [30, 30] })
    } catch (e: any) {
      setTrajError(e?.message || 'Erro ao buscar a trajetória.')
    } finally {
      setTrajLoading(false)
    }
  }

  useEffect(() => {
    containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    // Troca de lançamento: limpa a trajetória do voo anterior.
    trajectoryLayerRef.current?.clearLayers()
    setTrajAnalysis(null)
    setTrajError(null)
  }, [launch.year, launch.month, launch.day, launch.time_utc, launch.time_local])

  useEffect(() => {
    let cancelled = false
    const isFirstLoad = !mapRef.current

    function buildSourceUrl(): string {
      const pad = (n: number) => String(n).padStart(2, '0')
      const hourUtc = launch.time_utc.slice(0, 2).padStart(2, '0')
      const dt = `${launch.year}-${pad(launch.month)}-${pad(launch.day)} ${hourUtc}:00:00`
      return `https://weather.uwyo.edu/wsgi/sounding?src=FM35&datetime=${dt.replace(' ', '%20')}&id=${station}&type=TEXT:LIST`
    }

    // Atualiza marcadores no Leaflet já inicializado — chamado tanto do fast path
    // (síncrono) quanto do slow path (após await). Recebe L como parâmetro para
    // não depender de import dinâmico.
    function applyMarkers(
      L: any,
      contextFeatures: RadiosondyFeature[],
      pos: NonNullable<Launch['position']>,
    ) {
      const { lat, lon, sondeNumber, status: posStatus } = pos
      const rdFeature = contextFeatures.find(f => f.sondeNumber === sondeNumber)
      const markerLat = rdFeature ? rdFeature.lat : lat
      const markerLon = rdFeature ? rdFeature.lon : lon
      const markerStatus = rdFeature ? rdFeature.status : posStatus
      const markerPopup = rdFeature
        ? rdFeature.popupContent
        : `<b>${sondeNumber}</b><br>Status: ${posStatus}` +
          (pos.altitude ? `<br>Altitude: ${Math.round(pos.altitude).toLocaleString('pt-BR')} m` : '') +
          (pos.course ? `<br>Course: ${pos.course}°` : '')

      markersLayerRef.current.clearLayers()
      for (const f of contextFeatures) {
        if (f.sondeNumber === sondeNumber) continue
        if (Math.abs(f.lat - lat) < 0.0001 && Math.abs(f.lon - lon) < 0.0001) continue
        L.marker([f.lat, f.lon], { icon: buildBalloonIcon(L, statusColor(f.status), BALLOON_SIZE, gmt3IconLabel(f.date)) })
          .addTo(markersLayerRef.current)
          .bindPopup(f.popupContent)
      }
      L.marker([markerLat, markerLon], {
        icon: buildHighlightBalloonIcon(L, statusColor(markerStatus), BALLOON_SIZE,
          gmt3IconLabel(launchUtcInstant(launch.year, launch.month, launch.day, launch.time_utc, launch.time_local))),
        zIndexOffset: 1000,
      }).addTo(markersLayerRef.current).bindPopup(markerPopup)

      if (isFirstLoad) {
        mapRef.current.setView([markerLat, markerLon], 11)
      } else {
        mapRef.current.flyTo([markerLat, markerLon], 11, { duration: 0.8 })
      }
      setTimeout(() => mapRef.current?.invalidateSize(), 50)
    }

    function applyFeaturesMarkers(L: any, features: RadiosondyFeature[], highlight: RadiosondyFeature) {
      markersLayerRef.current.clearLayers()
      for (const f of features) {
        if (f === highlight) continue
        L.marker([f.lat, f.lon], { icon: buildBalloonIcon(L, statusColor(f.status), BALLOON_SIZE, gmt3IconLabel(f.date)) })
          .addTo(markersLayerRef.current)
          .bindPopup(f.popupContent)
      }
      L.marker([highlight.lat, highlight.lon], {
        icon: buildHighlightBalloonIcon(L, statusColor(highlight.status), BALLOON_SIZE, gmt3IconLabel(highlight.date)),
        zIndexOffset: 1000,
      }).addTo(markersLayerRef.current).bindPopup(highlight.popupContent)

      if (isFirstLoad) {
        mapRef.current.setView([highlight.lat, highlight.lon], 11)
      } else {
        mapRef.current.panTo([highlight.lat, highlight.lon], { animate: true, duration: 0.25 })
      }
      setTimeout(() => mapRef.current?.invalidateSize(), 50)
    }

    async function run() {
      const cacheKey = startplace ? `${startplace}-${launch.year}-${launch.month}` : null
      const now = new Date()
      const isCurrentMonth = launch.year === now.getUTCFullYear() && launch.month === now.getUTCMonth() + 1
      const cachedFeatures = (!isCurrentMonth && cacheKey) ? featuresCacheRef.current.get(cacheKey) : undefined

      // ── FAST PATH ────────────────────────────────────────────────────────────
      // Mapa já existe + Leaflet já carregado + features em cache:
      // atualiza marcadores diretamente sem nenhum await nem setState.
      if (!isFirstLoad && leafletRef.current && mapRef.current && markersLayerRef.current) {
        if (launch.position && cachedFeatures !== undefined) {
          // posição conhecida + contexto em cache → update síncrono
          applyMarkers(leafletRef.current, cachedFeatures, launch.position)
          onResult?.(true)
          return
        }
        if (!launch.position && cachedFeatures && cachedFeatures.length > 0 && startplace) {
          const launchInstant = launchUtcInstant(launch.year, launch.month, launch.day, launch.time_utc, launch.time_local)
          const result = launch.approx
            ? (() => { const f = cachedFeatures.find(f => roundToSynopticHour(f.date).getTime() === launchInstant.getTime()); return f ? { feature: f, approx: true } : null })()
            : findRecoveredMatch(cachedFeatures, launchInstant)
          if (result) {
            setApprox(result.approx)
            setStatus(null)
            setError(null)
            setIsSondeHubPos(false)
            applyFeaturesMarkers(leafletRef.current, cachedFeatures, result.feature)
            onResult?.(true)
            return
          }
          // Sem match mas features disponíveis → vai para fallback sem mostrar overlay
        }
      }
      // ── FIM DO FAST PATH ─────────────────────────────────────────────────────

      if (launch.position) {
        setStatus(null)
        setError(null)
        setSourceUrl(null)
        setIsSondeHubPos(false)
        setApprox(false)

        let contextFeatures: RadiosondyFeature[] = []
        if (startplace) {
          try {
            let cached = cacheKey ? featuresCacheRef.current.get(cacheKey) : undefined
            if (!cached) {
              cached = await fetchRadiosondyFeatures(launch.year, launch.month, startplace)
              if (!cancelled && cacheKey && !isCurrentMonth) featuresCacheRef.current.set(cacheKey, cached)
            }
            if (!cancelled) contextFeatures = cached
          } catch {}
        }
        if (cancelled) return

        const L = leafletRef.current ?? (await import('leaflet')).default
        if (cancelled || !mapDivRef.current) return

        if (!mapRef.current) {
          const map = L.map(mapDivRef.current)
          const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors' })
          const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Esri, Maxar, Earthstar Geographics' })
          streets.addTo(map)
          L.control.layers({ 'Mapa': streets, 'Satélite': satellite }).addTo(map)
          markersLayerRef.current = L.layerGroup().addTo(map)
          mapRef.current = map
          leafletRef.current = L
        }

        applyMarkers(L, contextFeatures, launch.position)
        onResult?.(true)
        return
      }

      if (!startplace) {
        setStatus(null)
        setError('Sem cobertura do radiosondy.info conhecida para esta estação.')
        onResult?.(false)
        return
      }

      if (isFirstLoad) setStatus('Consultando radiosondy.info…')
      setError(null)
      setSourceUrl(null)
      setIsSondeHubPos(false)
      setSondeHubMapUrl(null)

      async function plotPosition(lat: number, lon: number, label: string, source: string) {
        const L = leafletRef.current ?? (await import('leaflet')).default
        if (cancelled || !mapDivRef.current) return
        if (!mapRef.current) {
          const map = L.map(mapDivRef.current)
          const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors' })
          const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Esri, Maxar, Earthstar Geographics' })
          streets.addTo(map)
          L.control.layers({ 'Mapa': streets, 'Satélite': satellite }).addTo(map)
          markersLayerRef.current = L.layerGroup().addTo(map)
          mapRef.current = map
          leafletRef.current = L
        }
        markersLayerRef.current.clearLayers()
        const utcInstant = launchUtcInstant(launch.year, launch.month, launch.day, launch.time_utc, launch.time_local)
        L.marker([lat, lon], {
          icon: buildHighlightBalloonIcon(L, statusColor('UNKNOWN'), BALLOON_SIZE, gmt3IconLabel(utcInstant)),
          zIndexOffset: 1000,
        }).addTo(markersLayerRef.current).bindPopup(`<b>${label}</b><br>Fonte: ${source}`)
        if (isFirstLoad) { mapRef.current.setView([lat, lon], 10) }
        else { mapRef.current.panTo([lat, lon], { animate: true, duration: 0.25 }) }
        setTimeout(() => mapRef.current?.invalidateSize(), 50)
      }

      async function fallbackToSondeHub(_reason: string) {
        setSourceUrl(buildSourceUrl())
        onResult?.(false)
        const launchInstant = launchUtcInstant(launch.year, launch.month, launch.day, launch.time_utc, launch.time_local)
        if (startplace && isWithinMatchWindow(launchInstant)) {
          setStatus('Consultando feed ao vivo do radiosondy.info…')
          try {
            const live = await fetchLiveFlights()
            if (cancelled) return
            const match = findLiveMatch(live, startplace)
            if (match) {
              setStatus(null)
              setIsSondeHubPos(true)
              await plotPosition(match.lat, match.lon, match.sondeNumber, 'radiosondy.info (ao vivo)')
              setSondeHubMapUrl(sondeHubUrl(match.sondeNumber, match.lat, match.lon, 7))
              return
            }
          } catch {}
          if (cancelled) return
        }
        setStatus('Consultando sondehub.org…')
        let sonde: Awaited<ReturnType<typeof fetchSondeHubArchiveSondeForDay>> = null
        try { sonde = await fetchSondeHubArchiveSondeForDay(station, launch.year, launch.month, launch.day) } catch {}
        if (cancelled) return
        if (sonde) {
          setStatus(null)
          setIsSondeHubPos(true)
          await plotPosition(sonde.lat, sonde.lon, sonde.serial, 'sondehub.org')
          setSondeHubMapUrl(sondeHubUrl(sonde.serial, sonde.lat, sonde.lon, 7))
        } else {
          setStatus(null)
          setError('Sem dados no radiosondy.info ou sondehub.org para este lançamento.')
        }
      }

      try {
        let features = cachedFeatures
        if (!features) {
          features = await fetchRadiosondyFeatures(launch.year, launch.month, startplace)
          if (cancelled) return
          if (!isCurrentMonth && cacheKey) featuresCacheRef.current.set(cacheKey, features)
        }
        if (features.length === 0) { await fallbackToSondeHub(''); return }

        const launchInstant = launchUtcInstant(launch.year, launch.month, launch.day, launch.time_utc, launch.time_local)
        const result = launch.approx
          ? (() => { const f = features!.find(f => roundToSynopticHour(f.date).getTime() === launchInstant.getTime()); return f ? { feature: f, approx: true } : null })()
          : findRecoveredMatch(features, launchInstant)

        if (!result) { await fallbackToSondeHub(''); return }
        if (cancelled) return

        setApprox(result.approx)
        setStatus(null)

        const L = leafletRef.current ?? (await import('leaflet')).default
        if (cancelled || !mapDivRef.current) return

        if (!mapRef.current) {
          const map = L.map(mapDivRef.current)
          const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors' })
          const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Esri, Maxar, Earthstar Geographics' })
          streets.addTo(map)
          L.control.layers({ 'Mapa': streets, 'Satélite': satellite }).addTo(map)
          markersLayerRef.current = L.layerGroup().addTo(map)
          mapRef.current = map
          leafletRef.current = L
        }

        applyFeaturesMarkers(L, features, result.feature)
        onResult?.(true)
      } catch (e: any) {
        if (!cancelled) { setError(e.message || 'Erro ao carregar o mapa'); setStatus(null); onResult?.(false) }
      }
    }

    run()
    return () => { cancelled = true }
  }, [launch.year, launch.month, launch.day, launch.time_utc, launch.time_local, station])

  useEffect(() => {
    return () => {
      mapRef.current?.remove()
      mapRef.current = null
      leafletRef.current = null
    }
  }, [])

  return (
    <div ref={containerRef} className="mt-3 border border-border rounded overflow-hidden">
      <div className="px-3 py-2 bg-surface border-b border-border flex items-center gap-3 flex-wrap">
        <span className="text-xs text-gray-300">
          Lançamento {String(launch.day).padStart(2, '0')}/{String(launch.month).padStart(2, '0')}/{launch.year} às {launch.time_local} (GMT-3)
        </span>
        {approx && !isSondeHubPos && (
          <span className="text-xs text-yellow-400 flex items-center gap-1">
            <AlertTriangle size={12} /> posição aproximada
          </span>
        )}
        {isSondeHubPos && (
          <span className="text-xs text-violet-400 flex items-center gap-1">
            <AlertTriangle size={12} /> via sondehub.org
          </span>
        )}
        {serial && !status && !error && (
          <button
            onClick={toggleTrajectory}
            disabled={trajLoading}
            className={`text-xs flex items-center gap-1 px-2 py-0.5 rounded border transition-all disabled:opacity-50 ${
              trajAnalysis
                ? 'text-sky-300 border-sky-500/40 bg-sky-500/10'
                : 'text-gray-400 border-border hover:text-sky-300 hover:border-sky-500/40'
            }`}
            title="Desenhar a trajetória completa do voo (subida, estouro, descida) via sondehub.org"
          >
            {trajLoading ? <Loader2 size={11} className="animate-spin" /> : null}
            {trajAnalysis ? 'Ocultar trajetória' : 'Trajetória do voo'}
          </button>
        )}
        {trajAnalysis && (
          <span className="text-[11px] text-dim mono">
            estouro {(trajAnalysis.maxAltM / 1000).toFixed(1)} km
            {trajAnalysis.durationMin ? ` · ${trajAnalysis.durationMin} min` : ''}
            {trajAnalysis.distanceKm ? ` · deriva ${Math.round(trajAnalysis.distanceKm)} km` : ''}
            {trajAnalysis.pointCount < 5 ? ' · trajetória resumida' : ''}
          </span>
        )}
        {trajError && <span className="text-[11px] text-red-400">{trajError}</span>}
        {isSondeHubPos && sondeHubMapUrl ? (
          <a href={sondeHubMapUrl} target="_blank" rel="noopener noreferrer"
            className="ml-auto text-xs text-violet-400 hover:underline flex items-center gap-1 flex-shrink-0">
            Ver no sondehub.org <ExternalLink size={11} />
          </a>
        ) : externalUrl ? (
          <a href={externalUrl} target="_blank" rel="noopener noreferrer"
            className="ml-auto text-xs text-blue-400 hover:underline flex items-center gap-1 flex-shrink-0">
            Ver no radiosondy.info <ExternalLink size={11} />
          </a>
        ) : null}
        <button onClick={onClose} className="text-gray-400 hover:text-white flex-shrink-0" title="Fechar mapa">
          <X size={15} />
        </button>
      </div>

      <div className="relative h-[420px] bg-bg">
        <div ref={mapDivRef} className="absolute inset-0" />

        {!status && !error && (
          <div className="absolute bottom-3 right-3 z-[900] bg-bg/40 backdrop-blur-sm rounded-md p-2.5 text-xs text-gray-200 space-y-1.5">
            {LEGEND_ITEMS.map(item => (
              <div key={item.label} className="flex items-center gap-2">
                <span className="inline-block w-2.5 h-3 rounded-sm flex-shrink-0" style={{ background: item.color }} />
                {item.label}
              </div>
            ))}
          </div>
        )}

        {(status || error) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-bg/95 z-[1000]">
            {error ? (
              <>
                <AlertCircle className="text-red-400" size={26} />
                <p className="text-sm text-red-400 px-6 text-center">{error}</p>
                {sourceUrl && (
                  <>
                    <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:underline">
                      Ver sondagem na Wyoming (fonte do lançamento)
                    </a>
                    <p className="text-[11px] text-gray-500 px-6 text-center">
                      O servidor da Wyoming é instável e pode recusar a conexão às vezes — tente de novo se isso acontecer.
                    </p>
                  </>
                )}
                {externalUrl && (
                  <a href={externalUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:underline">
                    Abrir mapa completo no radiosondy.info
                  </a>
                )}
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
