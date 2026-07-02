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
  position?: { lat: number; lon: number; sondeNumber: string; status: string; altitude?: number; course?: string }
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
  const [sondeHubMapUrl, setSondeHubMapUrl] = useState<string | null>(null)
  const [isSondeHubPos, setIsSondeHubPos] = useState(false)

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
      const hourUtc = launch.time_utc.slice(0, 2).padStart(2, '0')
      const dt = `${launch.year}-${pad(launch.month)}-${pad(launch.day)} ${hourUtc}:00:00`
      return `https://weather.uwyo.edu/wsgi/sounding?src=FM35&datetime=${dt.replace(' ', '%20')}&id=${station}&type=TEXT:LIST`
    }

    async function run() {
      // Posição já resolvida e persistida no servidor (app/api/radiosondy-sync,
      // ou já vinda de fábrica em lançamentos aproximados) — monta o marcador
      // direto, sem nenhum fetch ao radiosondy.info/sondehub.org.
      if (launch.position) {
        setStatus(null)
        setError(null)
        setSourceUrl(null)
        setIsSondeHubPos(false)
        setApprox(false)

        // Tenta buscar as features do mês pra mostrar os outros lançamentos
        // como contexto — mesmo padrão do caminho sem `position`, mas sem
        // bloquear: se falhar, mostra só o marcador destacado (que já é suficiente).
        let contextFeatures: RadiosondyFeature[] = []
        if (startplace) {
          try {
            const cacheKey = `${startplace}-${launch.year}-${launch.month}`
            let cached = featuresCacheRef.current.get(cacheKey)
            if (!cached) {
              cached = await fetchRadiosondyFeatures(launch.year, launch.month, startplace)
              if (!cancelled) featuresCacheRef.current.set(cacheKey, cached)
            }
            if (!cancelled) contextFeatures = cached
          } catch {
            // Falha pontual: o marcador destacado já está disponível — continua sem contexto.
          }
        }
        if (cancelled) return

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

        // Marcadores de contexto (outros lançamentos do mesmo mês), excluindo
        // qualquer feature que coincida com a posição já resolvida (evita duplo marcador).
        for (const f of contextFeatures) {
          if (Math.abs(f.lat - lat) < 0.0001 && Math.abs(f.lon - lon) < 0.0001) continue
          L.marker([f.lat, f.lon], { icon: buildBalloonIcon(L, statusColor(f.status), BALLOON_SIZE, gmt3IconLabel(f.date)) })
            .addTo(markersLayerRef.current)
            .bindPopup(f.popupContent)
        }

        L.marker([lat, lon], {
          icon: buildHighlightBalloonIcon(L, statusColor(status), BALLOON_SIZE, gmt3IconLabel(launchUtcInstant(launch.year, launch.month, launch.day, launch.time_utc, launch.time_local))),
          zIndexOffset: 1000,
        }).addTo(markersLayerRef.current).bindPopup(
          `<b>${sondeNumber}</b><br>Status: ${status}` +
          (launch.position?.altitude ? `<br>Altitude: ${Math.round(launch.position.altitude).toLocaleString('pt-BR')} m` : '') +
          (launch.position?.course ? `<br>Course: ${launch.position.course}°` : '')
        )

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
      setIsSondeHubPos(false)
      setSondeHubMapUrl(null)

      // Plota uma posição no Leaflet (reutilizado por radiosondy live e sondehub).
      async function plotPosition(lat: number, lon: number, label: string, source: string) {
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
        markersLayerRef.current.clearLayers()
        const utcInstant = launchUtcInstant(launch.year, launch.month, launch.day, launch.time_utc, launch.time_local)
        L.marker([lat, lon], {
          icon: buildHighlightBalloonIcon(L, statusColor('UNKNOWN'), BALLOON_SIZE, gmt3IconLabel(utcInstant)),
          zIndexOffset: 1000,
        }).addTo(markersLayerRef.current).bindPopup(`<b>${label}</b><br>Fonte: ${source}`)
        if (isFirstLoad) { map.setView([lat, lon], 10) } else { map.flyTo([lat, lon], 10, { duration: 0.8 }) }
        setTimeout(() => map.invalidateSize(), 50)
      }

      // Sem posição do radiosondy.info (mês vazio ou horário sem match):
      // 1. se ainda dentro da janela de voo → tenta o feed ao vivo do radiosondy.info
      // 2. se não → tenta o arquivo histórico do sondehub.org (lag de meses)
      // 3. se nada → mostra mensagem + link Wyoming
      async function fallbackToSondeHub(_reason: string) {
        setSourceUrl(buildSourceUrl())
        onResult?.(false)

        const launchInstant = launchUtcInstant(launch.year, launch.month, launch.day, launch.time_utc, launch.time_local)

        // Passo 1: feed ao vivo do radiosondy.info (sonda pode ainda estar em voo
        // ou acabou de pousar e ainda não apareceu no export_search.php)
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

        // Passo 2: arquivo S3 histórico do sondehub.org
        setStatus('Consultando sondehub.org…')
        let sonde: Awaited<ReturnType<typeof fetchSondeHubArchiveSondeForDay>> = null
        try {
          sonde = await fetchSondeHubArchiveSondeForDay(station, launch.year, launch.month, launch.day)
        } catch {}
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

      // Nota: não pulamos o fetch mesmo quando radiosondyMatch==='no', porque o
      // cron pode ter marcado antes de o dado aparecer no radiosondy.info (lag de
      // registro) — o browser re-checa sempre para garantir o resultado correto.

      try {
        const cacheKey = `${startplace}-${launch.year}-${launch.month}`
        const now = new Date()
        const isCurrentMonth = launch.year === now.getUTCFullYear() && launch.month === now.getUTCMonth() + 1
        let features = isCurrentMonth ? undefined : featuresCacheRef.current.get(cacheKey)
        if (!features) {
          features = await fetchRadiosondyFeatures(launch.year, launch.month, startplace)
          if (cancelled) return
          if (!isCurrentMonth) featuresCacheRef.current.set(cacheKey, features)
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
        {isSondeHubPos && sondeHubMapUrl ? (
          <a
            href={sondeHubMapUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto text-xs text-violet-400 hover:underline flex items-center gap-1 flex-shrink-0"
          >
            Ver no sondehub.org <ExternalLink size={11} />
          </a>
        ) : externalUrl ? (
          <a
            href={externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto text-xs text-blue-400 hover:underline flex items-center gap-1 flex-shrink-0"
          >
            Ver no radiosondy.info <ExternalLink size={11} />
          </a>
        ) : null}
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
