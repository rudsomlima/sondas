'use client'

import { useEffect, useRef, useState } from 'react'
import 'leaflet/dist/leaflet.css'
import { AlertCircle, Loader2, ExternalLink, AlertTriangle, X } from 'lucide-react'
import {
  externalRadiosondyUrl, launchUtcInstant, fetchRadiosondyFeatures,
  findRecoveredMatch, statusColor, buildBalloonIcon,
  buildHighlightBalloonIcon, gmt3IconLabel, LEGEND_ITEMS,
  RadiosondyFeature, roundToSynopticHour, sondeHubUrl,
} from '@/app/lib/radiosondy'
import { fetchSondeHubArchiveSondeForDay } from '@/app/lib/sondehub'
import { getRadiosondyStartplace, findStation, DEFAULT_STATION } from '@/app/lib/stations'

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
  // Posição final da sonda (radiosondy.info ou sondehub.org), já resolvida —
  // quando presente, monta o marcador direto, sem nenhum fetch ao vivo.
  position?: { lat: number; lon: number; sondeNumber: string; status: string }
  // Estações sem cobertura na Wyoming (Station.wyomingSupported === false):
  // 'radiosondy'/'sondehub' = horário aproximado, sem janela de match por
  // horário exato (ver bloco approx no useEffect abaixo). Ausente = Wyoming
  // (padrão).
  source?: 'wyoming' | 'radiosondy' | 'sondehub'
  approx?: boolean
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
  // Link pra fonte (Wyoming) que confirma o lançamento, mostrado só quando o
  // radiosondy.info não tem nenhuma correspondência real pra esse horário.
  const [sourceUrl, setSourceUrl] = useState<string | null>(null)
  // Sem posição do radiosondy.info pra este lançamento específico — seja
  // porque o mês inteiro não tem nada, seja porque tem outras posições mas
  // nenhuma bate com este horário (ex.: o pouso ainda não foi registrado, ou
  // o lançamento veio do sondehub.org sem nenhum voo do radiosondy.info por
  // perto pra arredondar) — nesse caso não há nada nosso pra mostrar, então
  // carrega o próprio mapa do sondehub.org no lugar, em vez de só um erro.
  // Por padrão centralizado na estação; refinado pro serial exato do dia se
  // achado no arquivo do sondehub.org (ver useEffect abaixo).
  const [showSondeHubFallback, setShowSondeHubFallback] = useState(false)
  const [sondeHubFallbackReason, setSondeHubFallbackReason] = useState('')
  const [sondeHubMapUrl, setSondeHubMapUrl] = useState<string | null>(null)

  const startplace = getRadiosondyStartplace(station)
  const externalUrl = startplace ? externalRadiosondyUrl(launch.year, launch.month, startplace) : null
  const stationCoords = findStation(station)

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
      return `https://weather.uwyo.edu/cgi-bin/sounding?region=samer&TYPE=TEXT%3ALIST&YEAR=${launch.year}` +
        `&MONTH=${pad(launch.month)}&FROM=${pad(launch.day)}${hourUtc}&TO=${pad(launch.day)}${hourUtc}&STNM=${station}`
    }

    async function run() {
      // Posição já resolvida e persistida no servidor (app/api/radiosondy-sync,
      // ou já vinda de fábrica em lançamentos aproximados) — monta o marcador
      // direto, sem nenhum fetch ao radiosondy.info/sondehub.org.
      if (launch.position) {
        setStatus(null)
        setError(null)
        setSourceUrl(null)
        setShowSondeHubFallback(false)
        setApprox(false)

        const L = (await import('leaflet')).default
        if (cancelled || !mapDivRef.current) return

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
        const { lat, lon, sondeNumber, status } = launch.position

        markersLayerRef.current.clearLayers()
        L.marker([lat, lon], {
          icon: buildHighlightBalloonIcon(L, statusColor(status), BALLOON_SIZE, gmt3IconLabel(launchUtcInstant(launch.year, launch.month, launch.day, launch.time_utc, launch.time_local))),
          zIndexOffset: 1000,
        }).addTo(markersLayerRef.current).bindPopup(`<b>${sondeNumber}</b><br>Status: ${status}`)

        if (isFirstLoad) {
          map.setView([lat, lon], 11)
        } else {
          map.flyTo([lat, lon], 11, { duration: 0.8 })
        }
        setTimeout(() => map.invalidateSize(), 50)
        onResult?.(true)
        return
      }

      if (!startplace) {
        setStatus(null)
        setError('Sem cobertura do radiosondy.info conhecida para esta estação.')
        onResult?.(false)
        return
      }

      // Só mostra o overlay cheio na primeira carga do mês; trocar de
      // horário/dia dentro do mesmo mês não deve escurecer o mapa já visível.
      if (isFirstLoad) setStatus('Consultando radiosondy.info…')
      setError(null)
      setSourceUrl(null)
      setShowSondeHubFallback(false)
      setSondeHubMapUrl(stationCoords ? `https://sondehub.org/?sondehub=1#!mt=Mapnik&mz=8&qm=12h&mc=${stationCoords.lat},${stationCoords.lon}` : null)

      // Sem posição do radiosondy.info pra este lançamento (mês vazio, ou
      // tem outras posições mas nenhuma bate com este horário): carrega o
      // mapa do próprio sondehub.org no lugar de um erro vazio. Tenta achar
      // o serial exato do dia no arquivo do sondehub.org pra focar nele (em
      // vez de só centralizar na estação, sem saber qual sonda foi).
      async function fallbackToSondeHub(reason: string) {
        setStatus(null)
        setSourceUrl(buildSourceUrl())
        setSondeHubFallbackReason(reason)
        setShowSondeHubFallback(true)
        onResult?.(false)
        try {
          const sonde = await fetchSondeHubArchiveSondeForDay(station, launch.year, launch.month, launch.day)
          if (!cancelled && sonde) {
            setSondeHubMapUrl(sondeHubUrl(sonde.serial, sonde.lat, sonde.lon, 7))
          }
        } catch {
          // Sem o serial exato: mantém o mapa centralizado na estação já definido acima.
        }
      }

      // Já checado em segundo plano (app/api/radiosondy-sync) e sem
      // correspondência — pula direto pro fallback, sem nenhum fetch no navegador.
      if (launch.radiosondyMatch === 'no') {
        await fallbackToSondeHub('Sem correspondência no radiosondy.info para este horário — mostrando o mapa do sondehub.org')
        return
      }

      try {
        const cacheKey = `${startplace}-${launch.year}-${launch.month}`
        let features = featuresCacheRef.current.get(cacheKey)
        if (!features) {
          features = await fetchRadiosondyFeatures(launch.year, launch.month, startplace)
          if (cancelled) return
          featuresCacheRef.current.set(cacheKey, features)
        }
        if (features.length === 0) {
          await fallbackToSondeHub('Sem dados no radiosondy.info este mês — mostrando o mapa do sondehub.org')
          return
        }

        const launchInstant = launchUtcInstant(launch.year, launch.month, launch.day, launch.time_utc, launch.time_local)

        // Lançamento aproximado (estação sem cobertura na Wyoming, horário
        // derivado do próprio radiosondy.info): não existe um horário exato
        // de lançamento pra aplicar a janela de match de findRecoveredMatch —
        // a posição certa é a feature cujo arredondamento sinótico gerou esse
        // horário aproximado em primeiro lugar.
        const result = launch.approx
          ? (() => {
              const feature = features.find(f => roundToSynopticHour(f.date).getTime() === launchInstant.getTime())
              return feature ? { feature, approx: true } : null
            })()
          : findRecoveredMatch(features, launchInstant)

        if (!result) {
          // Sem correspondência pra este horário específico (mesmo havendo
          // outras posições no mês) — mesmo fallback do mês vazio, já que do
          // nosso lado não há nada pra mostrar de qualquer forma.
          await fallbackToSondeHub('Sem correspondência no radiosondy.info para este horário — mostrando o mapa do sondehub.org')
          return
        }
        if (cancelled) return

        setApprox(result.approx)
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
        for (const f of features) {
          if (f === result.feature) continue
          L.marker([f.lat, f.lon], { icon: buildBalloonIcon(L, statusColor(f.status), BALLOON_SIZE, gmt3IconLabel(f.date)) })
            .addTo(markersLayerRef.current)
            .bindPopup(f.popupContent)
        }

        L.marker([result.feature.lat, result.feature.lon], {
          icon: buildHighlightBalloonIcon(L, statusColor(result.feature.status), BALLOON_SIZE, gmt3IconLabel(result.feature.date)),
          zIndexOffset: 1000,
        }).addTo(markersLayerRef.current).bindPopup(result.feature.popupContent)

        if (isFirstLoad) {
          map.setView([result.feature.lat, result.feature.lon], 11)
        } else {
          map.flyTo([result.feature.lat, result.feature.lon], 11, { duration: 0.8 })
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

        {showSondeHubFallback && (
          <div className="absolute inset-0 z-[1000] flex flex-col">
            <div className="px-3 py-1.5 bg-amber-500/10 border-b border-amber-500/20 text-[11px] text-amber-300 flex items-center gap-1.5 flex-shrink-0 flex-wrap">
              <AlertTriangle size={11} className="flex-shrink-0" />
              {sondeHubFallbackReason}
              {sourceUrl && (
                <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="ml-auto text-blue-300 hover:underline flex-shrink-0">
                  Ver sondagem na Wyoming
                </a>
              )}
            </div>
            {sondeHubMapUrl && (
              <iframe
                src={sondeHubMapUrl}
                title="Mapa do sondehub.org"
                className="flex-1 w-full border-0"
              />
            )}
          </div>
        )}

        {!status && !error && !showSondeHubFallback && (
          <div className="absolute bottom-3 right-3 z-[900] bg-[#111111]/40 backdrop-blur-sm rounded-md p-2.5 text-xs text-gray-200 space-y-1.5">
            {LEGEND_ITEMS.map(item => (
              <div key={item.label} className="flex items-center gap-2">
                <span className="inline-block w-2.5 h-3 rounded-sm flex-shrink-0" style={{ background: item.color }} />
                {item.label}
              </div>
            ))}
          </div>
        )}

        {(status || error) && !showSondeHubFallback && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#111111]/95 z-[1000]">
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
