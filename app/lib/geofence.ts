/**
 * Checagem geométrica das áreas de interesse desenhadas em /telegram
 * (polígonos e círculos) contra um ponto de pouso.
 */
import { haversineKm } from './geo'
import type { Geofence } from './telegramTypes'

// Ray casting padrão; `points` e o ponto testado são [lat, lon].
export function pointInPolygon(lat: number, lon: number, points: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [yi, xi] = points[i]
    const [yj, xj] = points[j]
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

export function pointInGeofence(lat: number, lon: number, area: Geofence): boolean {
  if (area.shape.type === 'circle') {
    const [clat, clon] = area.shape.center
    return haversineKm(lat, lon, clat, clon) * 1000 <= area.shape.radiusM
  }
  return pointInPolygon(lat, lon, area.shape.points)
}

// Primeira área ATIVA que contém o ponto (ordem da lista = prioridade de
// exibição). Área desligada (enabled === false) nunca casa.
export function findMatchingGeofence(lat: number, lon: number, areas: Geofence[]): Geofence | null {
  return areas.find(a => a.enabled !== false && pointInGeofence(lat, lon, a)) ?? null
}
