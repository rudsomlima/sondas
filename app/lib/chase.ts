'use client'

/**
 * Modo caçador: geolocalização do navegador + links de navegação até o
 * ponto de pouso/última posição da sonda.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export function googleMapsNavUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving`
}

export function wazeNavUrl(lat: number, lon: number): string {
  return `https://waze.com/ul?ll=${lat},${lon}&navigate=yes`
}

export interface GeoState {
  pos: { lat: number; lon: number; accuracyM: number } | null
  error: string | null
  watching: boolean
  start: () => void
  stop: () => void
}

// watchPosition com high accuracy; para automaticamente no unmount.
export function useGeolocation(): GeoState {
  const [pos, setPos] = useState<GeoState['pos']>(null)
  const [error, setError] = useState<string | null>(null)
  const [watching, setWatching] = useState(false)
  const watchIdRef = useRef<number | null>(null)

  const stop = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation?.clearWatch(watchIdRef.current)
      watchIdRef.current = null
    }
    setWatching(false)
  }, [])

  const start = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setError('Geolocalização não suportada neste navegador.')
      return
    }
    setError(null)
    setWatching(true)
    watchIdRef.current = navigator.geolocation.watchPosition(
      p => setPos({ lat: p.coords.latitude, lon: p.coords.longitude, accuracyM: p.coords.accuracy }),
      err => {
        setError(
          err.code === err.PERMISSION_DENIED
            ? 'Permissão de localização negada — habilite nas configurações do navegador.'
            : 'Não foi possível obter sua localização.'
        )
        setWatching(false)
        watchIdRef.current = null
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    )
  }, [])

  useEffect(() => stop, [stop])

  return { pos, error, watching, start, stop }
}
