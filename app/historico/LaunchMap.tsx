'use client'

import { useEffect, useRef, useState } from 'react'
import 'leaflet/dist/leaflet.css'
import { AlertCircle, Loader2, ExternalLink, AlertTriangle, X } from 'lucide-react'
import {
  externalRadiosondyUrl, launchUtcInstant, fetchRadiosondyFeatures, fetchLiveFlights,
  findRecoveredMatch, findLiveMatch, isWithinMatchWindow, statusColor, buildBalloonIcon,
  buildHighlightBalloonIcon, buildHighlightLiveBalloonIcon, gmt3IconLabel, LEGEND_ITEMS, LIVE_COLOR,
  RadiosondyFeature, LiveSondePosition,
} from '@/app/lib/radiosondy'
import { getRadiosondyStartplace, DEFAULT_STATION } from '@/app/lib/stations'

interface Launch {
  date: string
  time_local: string
  time_utc: string
  day: number
  month: number
  year: number
  // Preenchido pelo sync em segundo plano (app/api/radiosondy-sync) — quando
  // já se sabe que não há correspondência, evita o fetch no navegador.
  radiosondyMatch?: 'yes' | 'no'
}

const BALLOON_SIZE = 15

interface LaunchMapProps {
  launch: Launch
  onClose: () => void
  // Avisa a página se este lançamento tem (true) ou não (false) correspondência
  // no radiosondy.info, para indicar isso no badge do dia no calendário.
  onResult?: (found: boolean) => void
  // Estação Wyoming selecionada — usada para achar o "startplace" correspondente
  // no radiosondy.info (app/lib/stations.ts: getRadiosondyStartplace). Sem par
  // conhecido, o mapa de recuperação não se aplica a essa estação.
  station?: string
}

export default function LaunchMap({ launch, onClose, onResult, station = DEFAULT_STATION.id }: LaunchMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapDivRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const markersLayerRef = useRef<any>(null)
  // Evita refazer o fetch ao radiosondy.info quando o usuário troca de
  // horário/dia dentro do mesmo mês já carregado.
  const featuresCacheRef = useRef<Map<string, RadiosondyFeature[]>>(new Map())
  const [status, setStatus] = useState<string | null>('Consultando radiosondy.info…')
  const [error, setError] = useState<string | null>(null)
  const [approx, setApprox] = useState(false)
  const [stillFlying, setStillFlying] = useState(false)
  // Link pra fonte (Wyoming) que confirma o lançamento, mostrado só quando o
  // radiosondy.info não tem nenhuma correspondência real pra esse horário.
  const [sourceUrl, setSourceUrl] = useState<string | null>(null)

  const startplace = getRadiosondyStartplace(station)
  const externalUrl = startplace ? externalRadiosondyUrl(launch.year, launch.month, startplace) : null

  // Rola a tela para deixar o mapa centralizado ao abrir
  useEffect(() => {
    containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [launch.year, launch.month, launch.day, launch.time_utc, launch.time_local])

  useEffect(() => {
    let cancelled = false
    const isFirstLoad = !mapRef.current

    function buildSourceUrl(): string {
      const pad = (n: number) => String(n).padStart(2, '0')
      const hourUtc = launch.time_utc.slice(0, 2)
      return `https://weather.uwyo.edu/cgi-bin/sounding?region=samer&TYPE=TEXT:LIST&YEAR=${launch.year}` +
        `&MONTH=${pad(launch.month)}&FROM=${pad(launch.day)}${hourUtc}&TO=${pad(launch.day)}${hourUtc}&STNM=${station}`
    }

    async function run() {
      if (!startplace) {
        setStatus(null)
        setError('Sem cobertura do radiosondy.info conhecida para esta estação.')
        onResult?.(false)
        return
      }

      // Já checado em segundo plano (app/api/radiosondy-sync) e sem
      // correspondência — pula direto pra fonte, sem nenhum fetch no navegador.
      if (launch.radiosondyMatch === 'no') {
        setStatus(null)
        setSourceUrl(buildSourceUrl())
        setError('Nenhuma correspondência real encontrada no radiosondy.info para este horário.')
        onResult?.(false)
        return
      }

      // Só mostra o overlay cheio na primeira carga do mês; trocar de
      // horário/dia dentro do mesmo mês não deve escurecer o mapa já visível.
      if (isFirstLoad) setStatus('Consultando radiosondy.info…')
      setError(null)
      setSourceUrl(null)
      try {
        const cacheKey = `${startplace}-${launch.year}-${launch.month}`
        let features = featuresCacheRef.current.get(cacheKey)
        if (!features) {
          features = await fetchRadiosondyFeatures(launch.year, launch.month, startplace)
          if (cancelled) return
          featuresCacheRef.current.set(cacheKey, features)
        }
        if (features.length === 0) throw new Error('Nenhum voo encontrado no radiosondy.info para este mês.')

        const launchInstant = launchUtcInstant(launch.year, launch.month, launch.day, launch.time_utc, launch.time_local)
        // Primeiro tenta resolver só com o que já foi buscado (sem rede). O
        // feed ao vivo (~1MB) só é buscado se isso falhar e o lançamento for
        // recente o bastante pra ainda estar em voo — evita o fetch pesado
        // em toda troca de horário (mesmo de lançamentos antigos já pousados).
        const recovered = findRecoveredMatch(features, launchInstant)
        let result: { kind: 'recovered'; feature: RadiosondyFeature; approx: boolean }
          | { kind: 'live'; position: LiveSondePosition }
          | null = recovered ? { kind: 'recovered', ...recovered } : null

        if (!result && isWithinMatchWindow(launchInstant)) {
          const liveFlights = await fetchLiveFlights().catch(() => [])
          if (cancelled) return
          const live = findLiveMatch(liveFlights, startplace)
          if (live) result = { kind: 'live', position: live }
        }

        if (!result) {
          // Mostra a fonte (Wyoming) que confirma que houve esse lançamento,
          // já que o radiosondy.info não tem nenhuma posição pra mostrar.
          setSourceUrl(buildSourceUrl())
          throw new Error('Nenhuma correspondência real encontrada no radiosondy.info para este horário.')
        }
        if (cancelled) return

        setApprox(result.kind === 'recovered' && result.approx)
        setStillFlying(result.kind === 'live')
        setStatus(null)

        const L = (await import('leaflet')).default
        if (cancelled || !mapDivRef.current) return

        // Mapa e tile layers só são criados uma vez; trocar de lançamento
        // dentro do mesmo mês só atualiza os marcadores e o foco (flyTo),
        // sem recriar o Leaflet do zero.
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
        const matchedFeature = result.kind === 'recovered' ? result.feature : null
        for (const f of features) {
          if (f === matchedFeature) continue
          L.marker([f.lat, f.lon], { icon: buildBalloonIcon(L, statusColor(f.status), BALLOON_SIZE, gmt3IconLabel(f.date)) })
            .addTo(markersLayerRef.current)
            .bindPopup(f.popupContent)
        }

        let resultLat: number, resultLon: number, resultPopup: string
        if (result.kind === 'recovered') {
          resultLat = result.feature.lat
          resultLon = result.feature.lon
          resultPopup = result.feature.popupContent
          L.marker([resultLat, resultLon], {
            icon: buildHighlightBalloonIcon(L, statusColor(result.feature.status), BALLOON_SIZE, gmt3IconLabel(result.feature.date)),
            zIndexOffset: 1000,
          }).addTo(markersLayerRef.current).bindPopup(resultPopup)
        } else {
          // Ainda em voo: sem pouso registrado, usa a última posição conhecida
          // do feed ao vivo, com o ícone de paraquedas pra deixar claro que
          // não é uma posição de recuperação.
          resultLat = result.position.lat
          resultLon = result.position.lon
          resultPopup = result.position.popupContent
          const reportDate = new Date(result.position.lastReportUtc.replace(' ', 'T').replace(/z$/i, '') + 'Z')
          L.marker([resultLat, resultLon], {
            icon: buildHighlightLiveBalloonIcon(L, LIVE_COLOR, BALLOON_SIZE, gmt3IconLabel(reportDate)),
            zIndexOffset: 1000,
          }).addTo(markersLayerRef.current).bindPopup(resultPopup)
        }

        if (isFirstLoad) {
          map.setView([resultLat, resultLon], 11)
        } else {
          map.flyTo([resultLat, resultLon], 11, { duration: 0.8 })
        }
        setTimeout(() => map.invalidateSize(), 50)
        onResult?.(true)
      } catch (e: any) {
        if (!cancelled) {
          setError(e.message || 'Erro ao carregar o mapa')
          setStatus(null)
          onResult?.(false)
        }
      }
    }

    run()
    return () => { cancelled = true }
  }, [launch.year, launch.month, launch.day, launch.time_utc, launch.time_local, station])

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
          Lançamento {String(launch.day).padStart(2, '0')}/{String(launch.month).padStart(2, '0')}/{launch.year} às {launch.time_local} (GMT-3)
        </span>
        {approx && (
          <span className="text-xs text-yellow-400 flex items-center gap-1">
            <AlertTriangle size={12} /> posição aproximada
          </span>
        )}
        {stillFlying && (
          <span className="text-xs text-sky-400 flex items-center gap-1">
            <AlertTriangle size={12} /> ainda em voo, sem pouso registrado — última posição conhecida
          </span>
        )}
        {externalUrl && (
          <a
            href={externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto text-xs text-blue-400 hover:underline flex items-center gap-1 flex-shrink-0"
          >
            Ver no radiosondy.info <ExternalLink size={11} />
          </a>
        )}
        <button onClick={onClose} className="text-gray-400 hover:text-white flex-shrink-0" title="Fechar mapa">
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
                {sourceUrl && (
                  <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:underline">
                    Ver sondagem na Wyoming (fonte do lançamento)
                  </a>
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
