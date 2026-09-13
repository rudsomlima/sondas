'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import 'leaflet/dist/leaflet.css'
import { AlertCircle, Loader2, RefreshCw, X } from 'lucide-react'
import { statusColor, buildBalloonIcon, gmt3IconLabelWithMonth, LEGEND_ITEMS } from '@/app/lib/radiosondy'
import { findStation } from '@/app/lib/stations'
import { createBaseMap } from '@/app/lib/leafletBase'
import { nowGMT3 } from '@/app/lib/types'
import type { Launch } from '@/app/lib/types'
import {
  attachPositions, fetchArchiveMonthPoints, fetchRadiosondyMonthPoints, fetchRecentSondeHubPoints,
  mergeSondePoints, monthOverlapsRecentWindow, pointsFromLaunches, sondePointPopup,
  type SondePoint,
} from '@/app/lib/sondePoints'

const BALLOON_SIZE = 15

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c] ?? c))
}

interface YearMapProps {
  year: number
  station: string
  launches: Launch[]
  onClose: () => void
  // Todas as posições reunidas, para a página preencher lançamentos sem posição.
  onPoints?: (points: SondePoint[]) => void
}

export default function YearMap({ year, station, launches, onClose, onPoints }: YearMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapDivRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const markersLayerRef = useRef<any>(null)
  const [status, setStatus] = useState<string | null>('Reunindo posições disponíveis…')
  const [error, setError] = useState<string | null>(null)
  const [pointCount, setPointCount] = useState(0)
  const [sources, setSources] = useState<string[]>([])
  const [attempt, setAttempt] = useState(0)
  const stationInfo = findStation(station)

  // A página recria o array de lançamentos a cada render (polling ao vivo a
  // cada 20s). Depender da identidade do array reiniciava toda a busca
  // externa e descartava o resultado antes de chegar — por isso só o
  // conteúdo relevante dispara uma nova busca. A posição fica fora da chave:
  // a própria página preenche posições com o resultado (onPoints), e isso não
  // deve disparar outra rodada de consultas.
  const launchesRef = useRef(launches)
  launchesRef.current = launches
  const onPointsRef = useRef(onPoints)
  onPointsRef.current = onPoints
  const launchesKey = useMemo(() => launches.map(l => `${l.date}_${l.time_utc}`).join('|'), [launches])

  useEffect(() => { containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }, [])

  useEffect(() => {
    let cancelled = false

    async function run() {
      if (!mapDivRef.current || !stationInfo) {
        setStatus(null)
        setError('Estação inválida ou sem coordenadas cadastradas.')
        return
      }
      const currentStation = stationInfo
      const yearLaunches = launchesRef.current
      setStatus('Carregando posições preservadas…')
      setError(null)

      const L = (await import('leaflet')).default
      if (cancelled || !mapDivRef.current) return
      if (!mapRef.current) {
        const { map, markersLayer } = createBaseMap(L, mapDivRef.current)
        mapRef.current = map
        markersLayerRef.current = markersLayer
      }

      let points = pointsFromLaunches(yearLaunches)
      let fitted = false

      function draw() {
        const layer = markersLayerRef.current
        if (!layer || cancelled) return
        layer.clearLayers()
        const bounds = L.latLngBounds([])
        L.circleMarker([currentStation.lat, currentStation.lon], {
          radius: 6, color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.65, weight: 2,
        }).addTo(layer).bindPopup(`<b>${escapeHtml(currentStation.name)}</b><br>STNM ${escapeHtml(currentStation.id)}`)
        for (const p of points) {
          L.marker([p.lat, p.lon], {
            icon: buildBalloonIcon(L, statusColor(p.status), BALLOON_SIZE, gmt3IconLabelWithMonth(p.date)),
          }).addTo(layer).bindPopup(sondePointPopup(p))
          bounds.extend([p.lat, p.lon])
        }
        setPointCount(points.length)
        // Enquadra só na primeira vez que há pontos: não "pula" o mapa enquanto
        // o usuário já está navegando e a busca complementar chega.
        if (!fitted) {
          if (points.length > 0) { mapRef.current.fitBounds(bounds, { padding: [30, 30], maxZoom: 11 }); fitted = true }
          else mapRef.current.setView([currentStation.lat, currentStation.lon], 8)
        }
        setTimeout(() => mapRef.current?.invalidateSize(), 50)
      }

      draw()
      const used = new Set<string>(points.length > 0 ? ['cache'] : [])

      const clock = nowGMT3()
      const maxMonth = year < clock.getUTCFullYear() ? 12 : year === clock.getUTCFullYear() ? clock.getUTCMonth() + 1 : 0
      const months = Array.from({ length: maxMonth }, (_, i) => i + 1)
      if (months.length === 0) {
        setStatus(null)
        setError('Ano sem meses consultáveis.')
        return
      }

      // Fase 1: radiosondy.info de TODOS os meses (não só os que a Wyoming
      // publicou) + telemetria recente do SondeHub.
      setStatus('Consultando radiosondy.info e SondeHub…')
      const startplace = currentStation.radiosondyStartplace
      const phase1: Promise<{ source: string; value: SondePoint[] }>[] = []
      if (startplace) {
        for (const m of months) {
          phase1.push(fetchRadiosondyMonthPoints(startplace, year, m).then(value => ({ source: 'radiosondy', value })))
        }
      }
      if (months.some(m => monthOverlapsRecentWindow(year, m))) {
        phase1.push(fetchRecentSondeHubPoints(currentStation)
          .then(value => ({ source: 'sondehub', value: value.filter(p => p.date.getUTCFullYear() === year) })))
      }
      const results1 = await Promise.allSettled(phase1)
      if (cancelled) return
      for (const r of results1) {
        if (r.status !== 'fulfilled') continue
        used.add(r.value.source)
        points = mergeSondePoints(points, r.value.value)
      }
      draw()

      // Fase 2: arquivo S3 do SondeHub (pesado: 1 arquivo por dia) só nos
      // meses em que ainda sobra lançamento sem posição.
      const stillMissing = attachPositions(yearLaunches, points).launches.filter(l => !l.position)
      const archiveMonths = [...new Set(stillMissing.map(l => l.month))]
        .filter(m => !monthOverlapsRecentWindow(year, m))
      let failed = results1.filter(r => r.status === 'rejected').length
      if (archiveMonths.length > 0) {
        setStatus('Consultando arquivo do SondeHub…')
        const results2 = await Promise.allSettled(archiveMonths.map(m =>
          fetchArchiveMonthPoints(currentStation.id, year, m)))
        if (cancelled) return
        for (const r of results2) {
          if (r.status !== 'fulfilled') continue
          if (r.value.length > 0) used.add('archive')
          points = mergeSondePoints(points, r.value)
        }
        failed += results2.filter(r => r.status === 'rejected').length
        draw()
      }

      setSources([...used])
      setStatus(null)
      onPointsRef.current?.(points)
      if (points.length === 0) {
        setError('Nenhuma posição foi encontrada no cache, radiosondy.info ou SondeHub.')
      } else if (failed > 0) {
        setError(`${points.length} posição(ões) exibida(s); ${failed} consulta(s) complementar(es) falharam.`)
      }
    }

    run().catch((e: any) => {
      if (!cancelled) { setStatus(null); setError(e?.message || 'Erro ao carregar o mapa') }
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, station, stationInfo, launchesKey, attempt])

  useEffect(() => () => {
    mapRef.current?.remove()
    mapRef.current = null
  }, [])

  return (
    <div ref={containerRef} className="mt-3 border border-border rounded overflow-hidden">
      <div className="px-3 py-2 bg-surface border-b border-border flex items-center gap-3 flex-wrap">
        <span className="text-xs text-gray-300">Mapa consolidado de {year}</span>
        {pointCount > 0 && <span className="text-[11px] text-emerald-400 mono">{pointCount} posições</span>}
        {sources.length > 0 && <span className="text-[11px] text-dim">fontes: {sources.join(' + ')}</span>}
        {status && pointCount > 0 && <span className="text-[11px] text-blue-300 flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> complementando…</span>}
        <button onClick={() => setAttempt(v => v + 1)} className="ml-auto text-gray-400 hover:text-white" title="Tentar novamente">
          <RefreshCw size={14} />
        </button>
        <button onClick={onClose} className="text-gray-400 hover:text-white" title="Fechar mapa"><X size={15} /></button>
      </div>

      <div className="relative h-[280px] sm:h-[340px] lg:h-[420px] bg-bg">
        <div ref={mapDivRef} className="absolute inset-0" />
        {!status && pointCount > 0 && (
          <div className="absolute bottom-3 right-3 z-[900] bg-bg/70 backdrop-blur-sm rounded-md p-2.5 text-xs text-gray-200 space-y-1.5">
            {LEGEND_ITEMS.map(item => <div key={item.label} className="flex items-center gap-2">
              <span className="inline-block w-2.5 h-3 rounded-sm" style={{ background: item.color }} />{item.label}
            </div>)}
          </div>
        )}
        {status && pointCount === 0 && <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-bg/90 z-[1000]">
          <Loader2 className="animate-spin text-blue-400" size={22} /><p className="text-sm text-gray-400">{status}</p>
        </div>}
        {error && <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] max-w-[90%] bg-bg/90 border border-yellow-500/30 rounded px-3 py-2 flex items-center gap-2 text-xs text-yellow-300">
          <AlertCircle size={14} className="shrink-0" />{error}
        </div>}
      </div>
    </div>
  )
}
