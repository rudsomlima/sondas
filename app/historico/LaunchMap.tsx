'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import 'leaflet/dist/leaflet.css'
import { AlertCircle, Loader2, ExternalLink, AlertTriangle, RefreshCw, X, Antenna, Radio, Rocket, Undo2, Maximize2, Minimize2 } from 'lucide-react'
import {
  externalRadiosondyUrl, launchUtcInstant, fetchRadiosondyFeatures,
  findRecoveredMatch, fetchLiveFlights, findLiveMatch, isWithinMatchWindow,
  statusColor, buildBalloonIcon,
  buildHighlightBalloonIcon, buildHighlightLiveBalloonIcon, LIVE_COLOR,
  gmt3IconLabel, LEGEND_ITEMS,
  RadiosondyFeature, roundToSynopticHour, sondeHubUrl, parsePopupTelemetry,
} from '@/app/lib/radiosondy'
import { fetchSondeHubArchiveSondeForDay, SONDEHUB_RECENT_SECONDS } from '@/app/lib/sondehub'
import { launchDisplayTime } from '@/app/lib/launchUtils'
import { getRadiosondyStartplace, findStation, DEFAULT_STATION } from '@/app/lib/stations'
import type { Launch, LaunchPosition } from '@/app/lib/types'
import {
  applyRegistryToPoints, fetchRecentSondeHubPoints, findPointForLaunch, mergeSondePoints, pointFromFeature,
  pointToPosition, sondePointPopup, type SondePoint,
} from '@/app/lib/sondePoints'
import type { SondeRecord } from '@/app/lib/sondeRegistry'
import { POPUP_OPTIONS } from '@/app/lib/mapPopups'
import { useReceiverStations } from '@/app/lib/receiverStationsClient'
import { drawReceiverStations, receptorsFromPoints } from '@/app/lib/receiverStationsLayer'
import { getSettings } from '@/app/lib/settings'
import { useFullscreen } from '@/app/lib/useFullscreen'
import { GMT3 } from '@/app/lib/types'
import { fetchLiveTrajectory, fetchArchiveTrajectory, analyzeTrajectory, FlightAnalysis } from '@/app/lib/trajectory'
import { drawTrajectory } from '@/app/components/TrajectoryLayer'

const BALLOON_SIZE = 15


interface LaunchMapProps {
  launch: Launch
  onClose: () => void
  onResult?: (found: boolean) => void
  // Posição resolvida aqui (sem estar em launch.position), para a página guardar.
  onPosition?: (launch: Launch, position: LaunchPosition) => void
  // Sondas do mesmo mês vindas de outras fontes (SondeHub, cache), desenhadas
  // como contexto e usadas para casar o pouso antes de desistir.
  contextPoints?: SondePoint[]
  // Registro permanente de sondas (R2): completa qualquer sonda desenhada aqui
  // com receptores, último sinal, 1º quadro e recuperação.
  records?: Map<string, SondeRecord>
  station?: string
}

const NO_POINTS: SondePoint[] = []
const NO_RECORDS = new Map<string, SondeRecord>()

function fmtUtcAsLocal(iso: string | undefined, seconds = false): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  const l = new Date(d.getTime() + GMT3)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(l.getUTCDate())}/${pad(l.getUTCMonth() + 1)}/${l.getUTCFullYear()} ${pad(l.getUTCHours())}:${pad(l.getUTCMinutes())}` +
    (seconds ? `:${pad(l.getUTCSeconds())}` : '')
}

// Recepção/último sinal no cabeçalho, igual pro lançamento e pra sonda clicada.
function ReceptionInfo({ receivers, frames, lastReceiver, lastReceiverAt }: {
  receivers?: string[]; frames?: Record<string, number>; lastReceiver?: string; lastReceiverAt?: string
}) {
  return (
    <>
      {receivers && receivers.length > 0 && (
        <span className="text-xs text-gray-400 flex items-center gap-1.5" title="Estações que participaram da recepção (quadros recebidos)">
          <Antenna size={12} className="text-teal-400" />
          <span className="mono">{receivers.map(r => frames?.[r] ? `${r} (${frames[r].toLocaleString('pt-BR')})` : r).join(', ')}</span>
        </span>
      )}
      {lastReceiver && (
        <span className="text-xs text-gray-400 flex items-center gap-1.5" title="De quem foi o último quadro recebido desta sonda">
          <Radio size={12} className="text-sky-400" />
          Último sinal: <span className="mono text-white">{lastReceiver}</span>
          {fmtUtcAsLocal(lastReceiverAt, true) && <span>às {fmtUtcAsLocal(lastReceiverAt, true)!.slice(11)}</span>}
        </span>
      )}
    </>
  )
}

export default function LaunchMap({ launch, onClose, onResult, onPosition, contextPoints = NO_POINTS, records = NO_RECORDS, station = DEFAULT_STATION.id }: LaunchMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapDivRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const markersLayerRef = useRef<any>(null)
  const contextLayerRef = useRef<any>(null)
  // Seriais já desenhados pela camada principal (não repetir no contexto).
  const drawnSerialsRef = useRef<Set<string>>(new Set())
  const [drawTick, setDrawTick] = useState(0)
  const contextPointsRef = useRef(contextPoints)
  contextPointsRef.current = contextPoints
  const onPositionRef = useRef(onPosition)
  onPositionRef.current = onPosition
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
  const [resolvedSerial, setResolvedSerial] = useState<string | null>(launch.position?.sondeNumber ?? null)
  const [attempt, setAttempt] = useState(0)
  // Sonda clicada no mapa: o cabeçalho passa a mostrar os dados dela (1º
  // quadro, receptores, último sinal) em vez dos do lançamento aberto.
  const [focused, setFocused] = useState<SondePoint | null>(null)
  const recordsRef = useRef(records)
  recordsRef.current = records
  const stationsLayerRef = useRef<any>(null)
  // Sondas da camada principal (destaque + radiosondy.info do mês), pra saber
  // quais estações receptoras desenhar.
  const mainPointsRef = useRef<Map<string, SondePoint>>(new Map())
  const receiverStations = useReceiverStations()
  // Tela cheia do mapa (botão no cabeçalho); o Leaflet precisa recalcular o
  // tamanho ao entrar/sair.
  const invalidateMap = useCallback(() => mapRef.current?.invalidateSize(), [])
  const fs = useFullscreen(containerRef, invalidateMap)

  // O dado mais completo disponível pra uma sonda: o ponto da fonte que
  // desenhou o marcador + o mesmo serial nos pontos de contexto (todas as
  // fontes do mês) + o registro do R2. Calculado na hora de abrir o popup,
  // então chega sempre com o que já se sabe naquele momento.
  const bestPoint = useCallback((base: SondePoint): SondePoint => {
    const ctx = contextPointsRef.current.find(p => p.serial === base.serial)
    const merged = ctx ? mergeSondePoints([base], [ctx])[0] : base
    return applyRegistryToPoints([merged], recordsRef.current)[0]
  }, [])

  const bindSonde = useCallback((marker: any, base: SondePoint, main = true) => {
    if (main) mainPointsRef.current.set(base.serial, base)
    marker.bindPopup(() => sondePointPopup(bestPoint(base)), POPUP_OPTIONS)
    marker.on('click', () => setFocused(bestPoint(base)))
  }, [bestPoint])

  const launchBasePoint = useCallback((pos: NonNullable<Launch['position']>): SondePoint => ({
    serial: pos.sondeNumber, lat: pos.lat, lon: pos.lon, status: pos.status,
    date: launchUtcInstant(launch.year, launch.month, launch.day, launch.time_utc, launch.time_local),
    altitude: pos.altitude, sources: ['cache'],
    recoveredBy: pos.recoveredBy, recoveryNote: pos.recoveryNote,
  }), [launch.year, launch.month, launch.day, launch.time_utc, launch.time_local])

  // Cabeçalho do lançamento: Launch + o que o registro sabe da sonda dele.
  const launchInfo = useMemo(() => {
    const sn = resolvedSerial ?? launch.position?.sondeNumber
    const rec = sn ? records.get(sn) : undefined
    const withFrames = rec?.receivers?.filter(x => x.frames) ?? []
    return {
      receivers: rec?.receivers?.length ? rec.receivers.map(x => x.callsign) : launch.receivers,
      receiverFrames: withFrames.length ? Object.fromEntries(withFrames.map(x => [x.callsign, x.frames!])) : launch.receiverFrames,
      lastReceiver: rec?.lastReceiver ?? launch.lastReceiver,
      lastReceiverAt: rec?.lastReceiverAt ?? launch.lastReceiverAt,
    }
  }, [records, resolvedSerial, launch])

  const startplace = getRadiosondyStartplace(station)
  const externalUrl = startplace ? externalRadiosondyUrl(launch.year, launch.month, startplace) : null

  // Serial conhecida (posição resolvida) habilita o botão de trajetória.
  const serial = resolvedSerial ?? launch.position?.sondeNumber

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
    setResolvedSerial(launch.position?.sondeNumber ?? null)
    setFocused(null)
  }, [launch.year, launch.month, launch.day, launch.time_utc, launch.time_local])

  useEffect(() => {
    let cancelled = false
    const isFirstLoad = !mapRef.current

    function buildSourceUrl(): string {
      const pad = (n: number) => String(n).padStart(2, '0')
      const utc = launchUtcInstant(launch.year, launch.month, launch.day, launch.time_utc, launch.time_local)
      const dt = `${utc.getUTCFullYear()}-${pad(utc.getUTCMonth() + 1)}-${pad(utc.getUTCDate())} ${pad(utc.getUTCHours())}:00:00`
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
      drawnSerialsRef.current = new Set([sondeNumber, ...contextFeatures.map(f => f.sondeNumber)])
      setResolvedSerial(sondeNumber)
      const rdFeature = contextFeatures.find(f => f.sondeNumber === sondeNumber)
      const markerLat = rdFeature ? rdFeature.lat : lat
      const markerLon = rdFeature ? rdFeature.lon : lon
      const markerStatus = rdFeature ? rdFeature.status : posStatus
      // Destaque: posição do lançamento + (se houver) o ponto do radiosondy.info.
      const highlightBase = rdFeature
        ? mergeSondePoints([launchBasePoint(pos)], [pointFromFeature(rdFeature)])[0]
        : launchBasePoint(pos)

      markersLayerRef.current.clearLayers()
      mainPointsRef.current = new Map()
      for (const f of contextFeatures) {
        if (f.sondeNumber === sondeNumber) continue
        if (Math.abs(f.lat - lat) < 0.0001 && Math.abs(f.lon - lon) < 0.0001) continue
        const m = L.marker([f.lat, f.lon], { icon: buildBalloonIcon(L, statusColor(f.status), BALLOON_SIZE, gmt3IconLabel(f.date)) })
          .addTo(markersLayerRef.current)
        bindSonde(m, pointFromFeature(f))
      }
      const hm = L.marker([markerLat, markerLon], {
        icon: buildHighlightBalloonIcon(L, statusColor(markerStatus), BALLOON_SIZE,
          gmt3IconLabel(launchUtcInstant(launch.year, launch.month, launch.day, launch.time_utc, launch.time_local))),
        zIndexOffset: 1000,
      }).addTo(markersLayerRef.current)
      bindSonde(hm, { ...highlightBase, lat: markerLat, lon: markerLon })

      if (isFirstLoad) {
        mapRef.current.setView([markerLat, markerLon], 11)
      } else {
        mapRef.current.flyTo([markerLat, markerLon], 11, { duration: 0.8 })
      }
      setTimeout(() => mapRef.current?.invalidateSize(), 50)
      setDrawTick(t => t + 1)
    }

    function applyFeaturesMarkers(L: any, features: RadiosondyFeature[], highlight: RadiosondyFeature) {
      drawnSerialsRef.current = new Set(features.map(f => f.sondeNumber))
      setResolvedSerial(highlight.sondeNumber)
      const { altitude } = parsePopupTelemetry(highlight.popupContent)
      onPositionRef.current?.(launch, {
        lat: highlight.lat, lon: highlight.lon, sondeNumber: highlight.sondeNumber,
        status: highlight.status, altitude: altitude || undefined,
      })
      markersLayerRef.current.clearLayers()
      mainPointsRef.current = new Map()
      for (const f of features) {
        if (f === highlight) continue
        const m = L.marker([f.lat, f.lon], { icon: buildBalloonIcon(L, statusColor(f.status), BALLOON_SIZE, gmt3IconLabel(f.date)) })
          .addTo(markersLayerRef.current)
        bindSonde(m, pointFromFeature(f))
      }
      const hm = L.marker([highlight.lat, highlight.lon], {
        icon: buildHighlightBalloonIcon(L, statusColor(highlight.status), BALLOON_SIZE, gmt3IconLabel(highlight.date)),
        zIndexOffset: 1000,
      }).addTo(markersLayerRef.current)
      bindSonde(hm, pointFromFeature(highlight))

      if (isFirstLoad) {
        mapRef.current.setView([highlight.lat, highlight.lon], 11)
      } else {
        mapRef.current.panTo([highlight.lat, highlight.lon], { animate: true, duration: 0.25 })
      }
      setTimeout(() => mapRef.current?.invalidateSize(), 50)
      setDrawTick(t => t + 1)
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
        setIsSondeHubPos(launch.source === 'sondehub' || launch.sources?.sondehub === true)
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
        await fallbackToSondeHub('no-radiosondy-coverage')
        return
      }

      if (isFirstLoad) setStatus('Consultando radiosondy.info…')
      setError(null)
      setSourceUrl(null)
      setIsSondeHubPos(false)
      setSondeHubMapUrl(null)

      // `live` = sonda ainda em voo: usa o ícone de paraquedas (mesmo desenho
      // do sondehub.org) em vez do cilindro de posição já pousada/recuperada.
      async function plotPosition(base: SondePoint, live = false) {
        const { lat, lon } = base
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
        mainPointsRef.current = new Map()
        drawnSerialsRef.current = new Set([base.serial])
        const utcInstant = launchUtcInstant(launch.year, launch.month, launch.day, launch.time_utc, launch.time_local)
        const hm = L.marker([lat, lon], {
          icon: live
            ? buildHighlightLiveBalloonIcon(L, LIVE_COLOR, BALLOON_SIZE, gmt3IconLabel(utcInstant))
            : buildHighlightBalloonIcon(L, statusColor(base.status), BALLOON_SIZE, gmt3IconLabel(utcInstant)),
          zIndexOffset: 1000,
        }).addTo(markersLayerRef.current)
        bindSonde(hm, base)
        if (isFirstLoad) { mapRef.current.setView([lat, lon], 10) }
        else { mapRef.current.panTo([lat, lon], { animate: true, duration: 0.25 }) }
        setTimeout(() => mapRef.current?.invalidateSize(), 50)
        setDrawTick(t => t + 1)
      }

      async function fallbackToSondeHub(_reason: string) {
        setSourceUrl(buildSourceUrl())
        const launchInstant = launchUtcInstant(launch.year, launch.month, launch.day, launch.time_utc, launch.time_local)
        if (startplace && isWithinMatchWindow(launchInstant)) {
          setStatus('Consultando feed ao vivo do radiosondy.info…')
          try {
            const live = await fetchLiveFlights()
            if (cancelled) return
            const match = findLiveMatch(live, startplace)
            if (match) {
              setStatus(null)
              setIsSondeHubPos(false)
              setResolvedSerial(match.sondeNumber)
              await plotPosition({
                serial: match.sondeNumber, lat: match.lat, lon: match.lon, status: 'UNKNOWN', date: new Date(),
                altitude: match.altitude || undefined, sources: ['radiosondy'],
              }, true)
              setSondeHubMapUrl(sondeHubUrl(match.sondeNumber, match.lat, match.lon, 7))
              onResult?.(true)
              onPositionRef.current?.(launch, {
                lat: match.lat, lon: match.lon, sondeNumber: match.sondeNumber, status: 'UNKNOWN',
                altitude: match.altitude || undefined,
              })
              return
            }
          } catch {}
          if (cancelled) return
        }

        // Pouso já visto por outra fonte (SondeHub recente, arquivo) nas 4h
        // seguintes ao lançamento. Pontos com 'cache' já pertencem a outro
        // lançamento do mês e não são reaproveitados.
        let candidates = contextPointsRef.current.filter(p => !p.sources.includes('cache'))
        const stationInfo = findStation(station)
        if (stationInfo && Date.now() - launchInstant.getTime() < SONDEHUB_RECENT_SECONDS * 1000) {
          setStatus('Consultando telemetria recente do SondeHub…')
          try { candidates = mergeSondePoints(candidates, await fetchRecentSondeHubPoints(stationInfo)) } catch {}
          if (cancelled) return
        }
        const point = findPointForLaunch(launch, candidates)
        if (point) {
          setStatus(null)
          setIsSondeHubPos(!point.sources.includes('radiosondy'))
          setResolvedSerial(point.serial)
          await plotPosition(point)
          setSondeHubMapUrl(sondeHubUrl(point.serial, point.lat, point.lon, 7))
          onResult?.(true)
          onPositionRef.current?.(launch, pointToPosition(point))
          return
        }

        setStatus('Consultando sondehub.org…')
        let sonde: Awaited<ReturnType<typeof fetchSondeHubArchiveSondeForDay>> = null
        try { sonde = await fetchSondeHubArchiveSondeForDay(station, launch.year, launch.month, launch.day) } catch {}
        if (cancelled) return
        if (sonde) {
          setStatus(null)
          setIsSondeHubPos(true)
          setResolvedSerial(sonde.serial)
          await plotPosition({
            serial: sonde.serial, lat: sonde.lat, lon: sonde.lon, status: 'UNKNOWN',
            date: launchInstant, sources: ['archive'],
          })
          setSondeHubMapUrl(sondeHubUrl(sonde.serial, sonde.lat, sonde.lon, 7))
          onResult?.(true)
          onPositionRef.current?.(launch, { lat: sonde.lat, lon: sonde.lon, sondeNumber: sonde.serial, status: 'UNKNOWN' })
        } else {
          setStatus(null)
          setError('Sem dados no radiosondy.info ou sondehub.org para este lançamento.')
          onResult?.(false)
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
  // position.status: redesenha quando a posição ganha o status de recuperação
  // do SondeHub em segundo plano (UNKNOWN → FOUND/LOST, useRecoveredLaunches).
  }, [launch.year, launch.month, launch.day, launch.time_utc, launch.time_local, launch.position?.status, station, attempt])

  // Contexto: sondas do mês vindas de outras fontes que a camada principal
  // (radiosondy.info + destaque) não desenhou.
  useEffect(() => {
    const L = leafletRef.current
    const map = mapRef.current
    if (!L || !map) return
    if (!contextLayerRef.current) contextLayerRef.current = L.layerGroup().addTo(map)
    const layer = contextLayerRef.current
    layer.clearLayers()
    for (const p of contextPoints) {
      if (drawnSerialsRef.current.has(p.serial)) continue
      const m = L.marker([p.lat, p.lon], { icon: buildBalloonIcon(L, statusColor(p.status), BALLOON_SIZE, gmt3IconLabel(p.date)) })
        .addTo(layer)
      bindSonde(m, p, false)
    }
  }, [contextPoints, drawTick, bindSonde])

  // Estações receptoras de todas as sondas do mapa (+ o meu receptor).
  useEffect(() => {
    const L = leafletRef.current
    const map = mapRef.current
    if (!L || !map) return
    if (!stationsLayerRef.current) stationsLayerRef.current = L.layerGroup().addTo(map)
    const all = [...mainPointsRef.current.values(), ...contextPoints].map(bestPoint)
    const settings = getSettings()
    drawReceiverStations(L, stationsLayerRef.current, receiverStations, receptorsFromPoints(all), {
      callsign: settings.uploaderCallsign,
      pos: settings.homeLat != null && settings.homeLon != null ? { lat: settings.homeLat, lon: settings.homeLon } : null,
    })
  }, [contextPoints, records, receiverStations, drawTick, bestPoint])

  // Sonda clicada: mantém o cabeçalho atualizado quando o registro completa.
  useEffect(() => {
    setFocused(prev => prev ? bestPoint(prev) : prev)
  }, [records, contextPoints, bestPoint])

  useEffect(() => {
    return () => {
      mapRef.current?.remove()
      mapRef.current = null
      leafletRef.current = null
      contextLayerRef.current = null
      stationsLayerRef.current = null
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className={`border border-border overflow-hidden bg-bg ${fs.isFullscreen ? 'flex flex-col' : 'mt-3 rounded'} ${fs.pseudo ? 'fixed inset-0 z-[2000]' : ''}`}
    >
      <div className="px-3 py-2 bg-surface border-b border-border flex items-center gap-3 flex-wrap">
        {focused && focused.serial !== serial ? (
          <>
            <span className="text-xs text-white flex items-center gap-1.5">
              <span className="mono font-semibold">{focused.serial}</span>
              <span className="text-gray-400 flex items-center gap-1">
                <Rocket size={12} className="text-amber-400" />
                {fmtUtcAsLocal(focused.firstFrameUtc)
                  ? <>Lançamento {fmtUtcAsLocal(focused.firstFrameUtc)} (GMT-3)</>
                  : <>1º quadro desconhecido · último reporte {fmtUtcAsLocal(focused.date.toISOString(), true)}</>}
              </span>
            </span>
            <ReceptionInfo receivers={focused.receivers} frames={focused.receiverFrames}
              lastReceiver={focused.lastReceiver} lastReceiverAt={focused.lastReceiverAt} />
            <button
              onClick={() => setFocused(null)}
              className="text-xs text-blue-400 hover:underline flex items-center gap-1"
              title="Voltar aos dados do lançamento aberto"
            >
              <Undo2 size={12} /> lançamento aberto
            </button>
          </>
        ) : (
          <>
            <span className="text-xs text-gray-300 flex items-center gap-1.5">
              <Rocket size={12} className="text-amber-400" />
              Lançamento {String(launch.day).padStart(2, '0')}/{String(launch.month).padStart(2, '0')}/{launch.year} às {launchDisplayTime(launch).exact ? '' : '~'}{launchDisplayTime(launch).time} (GMT-3)
            </span>
            <ReceptionInfo receivers={launchInfo.receivers} frames={launchInfo.receiverFrames}
              lastReceiver={launchInfo.lastReceiver} lastReceiverAt={launchInfo.lastReceiverAt} />
          </>
        )}
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
        <button
          onClick={fs.toggle}
          className="text-gray-400 hover:text-white flex-shrink-0"
          title={fs.isFullscreen ? 'Sair da tela cheia (Esc)' : 'Tela cheia'}
          aria-label={fs.isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
        >
          {fs.isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
        <button onClick={onClose} className="text-gray-400 hover:text-white flex-shrink-0" title="Fechar mapa">
          <X size={15} />
        </button>
      </div>

      <div className={`relative bg-bg ${fs.isFullscreen ? 'flex-1 min-h-0' : 'h-[280px] sm:h-[340px] lg:h-[420px]'}`}>
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
                <button onClick={() => setAttempt(v => v + 1)} className="text-xs text-white border border-border rounded px-2.5 py-1.5 flex items-center gap-1.5 hover:border-blue-500/50">
                  <RefreshCw size={11} /> Tentar todas as fontes novamente
                </button>
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
