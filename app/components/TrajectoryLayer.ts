/**
 * Desenho imperativo da trajetória de um voo num mapa Leaflet já criado:
 * polyline de subida (ciano), polyline de descida (âmbar), marcador de
 * estouro com a altitude, e nada mais (o marcador de pouso fica a cargo de
 * quem chama — normalmente o balão já existente).
 *
 * Compartilhado entre MissionMap (painel) e LaunchMap (histórico).
 */
import { TRAJECTORY } from '@/app/lib/tokens'
import { TrajectoryPoint, FlightAnalysis, downsample } from '@/app/lib/trajectory'

export function drawTrajectory(
  L: any,
  layerGroup: any,
  points: TrajectoryPoint[],
  analysis: FlightAnalysis,
): void {
  if (points.length < 2) return
  const pts = downsample(points)

  // Divide a trilha no índice do estouro (ou desenha tudo como subida se não há burst).
  let burstIdx = -1
  if (analysis.burst) {
    let bestDiff = Infinity
    for (let i = 0; i < pts.length; i++) {
      const diff = Math.abs(pts[i].timeMs - analysis.burst.timeMs)
      if (diff < bestDiff) { bestDiff = diff; burstIdx = i }
    }
  }

  const ascent = burstIdx > 0 ? pts.slice(0, burstIdx + 1) : pts
  const descent = burstIdx > 0 && burstIdx < pts.length - 1 ? pts.slice(burstIdx) : []

  L.polyline(ascent.map(p => [p.lat, p.lon]), {
    color: TRAJECTORY.ascent, weight: 2.5, opacity: 0.85,
  }).addTo(layerGroup)

  if (descent.length > 1) {
    L.polyline(descent.map(p => [p.lat, p.lon]), {
      color: TRAJECTORY.descent, weight: 2.5, opacity: 0.85, dashArray: '6 4',
    }).addTo(layerGroup)
  }

  // Marcador de estouro com a altitude máxima.
  if (analysis.burst && burstIdx > 0) {
    const altKm = (analysis.maxAltM / 1000).toFixed(1)
    L.marker([analysis.burst.lat, analysis.burst.lon], {
      icon: L.divIcon({
        html: `<div style="display:flex;align-items:center;gap:3px;background:${TRAJECTORY.burst};border:1px solid rgba(255,255,255,0.6);border-radius:4px;padding:1px 5px;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,0.5);">
          <span style="color:#fff;font-size:10px;font-weight:700;">✶</span>
          <span style="color:#fff;font-size:10px;font-family:monospace;font-weight:700;">${altKm} km</span>
        </div>`,
        className: '',
        iconSize: [64, 18],
        iconAnchor: [32, 9],
      }),
      zIndexOffset: 900,
    }).addTo(layerGroup).bindPopup(
      `<b>Estouro do balão</b><br>Altitude: ${Math.round(analysis.maxAltM).toLocaleString('pt-BR')} m` +
      (analysis.ascentRateMs ? `<br>Taxa de subida: ${analysis.ascentRateMs.toFixed(1)} m/s` : '')
    )
  }
}
