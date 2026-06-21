'use client'

import { useEffect, useRef, useState } from 'react'
import 'leaflet/dist/leaflet.css'
import { AlertCircle, Loader2, ExternalLink, AlertTriangle, X } from 'lucide-react'
import {
  externalRadiosondyUrl, launchUtcInstant, fetchRadiosondyFeatures,
  findClosestAfter, statusColor, buildBalloonIcon, buildHighlightBalloonIcon, LEGEND_ITEMS,
} from '@/app/lib/radiosondy'

interface Launch {
  date: string
  time_local: string
  time_utc: string
  day: number
  month: number
  year: number
}

const BALLOON_SIZE = 26

export default function LaunchMap({ launch, onClose }: { launch: Launch; onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapDivRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const [status, setStatus] = useState<string | null>('Consultando radiosondy.info…')
  const [error, setError] = useState<string | null>(null)
  const [approx, setApprox] = useState(false)

  const externalUrl = externalRadiosondyUrl(launch.year, launch.month)

  // Rola a tela para deixar o mapa centralizado ao abrir
  useEffect(() => {
    containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [launch.year, launch.month, launch.day, launch.time_utc, launch.time_local])

  useEffect(() => {
    let cancelled = false

    async function run() {
      setStatus('Consultando radiosondy.info…')
      setError(null)
      try {
        const features = await fetchRadiosondyFeatures(launch.year, launch.month)
        if (cancelled) return
        if (features.length === 0) throw new Error('Nenhum voo encontrado no radiosondy.info para este mês.')

        const launchInstant = launchUtcInstant(launch.year, launch.month, launch.day, launch.time_utc, launch.time_local)
        const result = findClosestAfter(features, launchInstant)
        if (!result) throw new Error('Não foi possível localizar uma posição correspondente.')
        if (cancelled) return

        setApprox(result.approx)
        setStatus(null)

        const L = (await import('leaflet')).default
        if (cancelled || !mapDivRef.current) return

        mapRef.current?.remove()
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
        mapRef.current = map

        for (const f of features) {
          if (f === result.feature) continue
          L.marker([f.lat, f.lon], { icon: buildBalloonIcon(L, statusColor(f.status), BALLOON_SIZE) })
            .addTo(map)
            .bindPopup(f.popupContent)
        }

        L.marker([result.feature.lat, result.feature.lon], {
          icon: buildHighlightBalloonIcon(L, statusColor(result.feature.status), BALLOON_SIZE),
          zIndexOffset: 1000,
        })
          .addTo(map)
          .bindPopup(result.feature.popupContent)
          .openPopup()

        map.setView([result.feature.lat, result.feature.lon], 11)
        setTimeout(() => map.invalidateSize(), 50)
      } catch (e: any) {
        if (!cancelled) {
          setError(e.message || 'Erro ao carregar o mapa')
          setStatus(null)
        }
      }
    }

    run()
    return () => { cancelled = true }
  }, [launch.year, launch.month, launch.day, launch.time_utc, launch.time_local])

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
        <a
          href={externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto text-xs text-blue-400 hover:underline flex items-center gap-1 flex-shrink-0"
        >
          Ver no radiosondy.info <ExternalLink size={11} />
        </a>
        <button onClick={onClose} className="text-gray-500 hover:text-white flex-shrink-0" title="Fechar mapa">
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
                <a href={externalUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:underline">
                  Abrir mapa completo no radiosondy.info
                </a>
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
