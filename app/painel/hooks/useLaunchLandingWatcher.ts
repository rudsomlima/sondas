'use client'

import { useEffect, useRef } from 'react'
import { flightStatus, type TodayFlight } from '@/app/lib/radiosondy'
import type { Station } from '@/app/lib/stations'

// sessionStorage (não localStorage) de propósito — sobrevive a um refresh da
// aba sem re-notificar o mesmo evento, mas reseta em sessão nova. O dedup
// "de verdade" (entre abas/sessões) é feito no servidor, ver
// blobStore.markNotifiedIfNew — isto aqui só evita um POST desnecessário a
// cada poll de 20s enquanto a sonda segue no mesmo estado.
const NOTIFIED_KEY = 'sondas_telegram_notified'
type NotifiedMap = Record<string, ('launch' | 'landing')[]>

function readNotified(): NotifiedMap {
  try {
    const raw = sessionStorage.getItem(NOTIFIED_KEY)
    const obj = raw ? JSON.parse(raw) : {}
    return obj && typeof obj === 'object' ? obj : {}
  } catch {
    return {}
  }
}

function writeNotified(map: NotifiedMap) {
  try { sessionStorage.setItem(NOTIFIED_KEY, JSON.stringify(map)) } catch { /* não crítico */ }
}

/**
 * Detecta transições "sonda iniciada" (apareceu ao vivo) e "sonda pousada"
 * nas sondas de hoje (mesmo feed do MissionMap, useLiveFlights) e avisa o
 * servidor em /api/telegram-notify, que decide se manda a mensagem no
 * Telegram (config, áreas de interesse e dedup entre abas ficam lá — o bot
 * token nunca passa pelo navegador).
 *
 * Limitação inerente de detecção 100% client-side: só dispara enquanto o
 * /painel está aberto numa aba (igual useReceiverAlerts). A 1ª carga da
 * sessão marca tudo que já estava em voo/pousado como "visto" sem notificar
 * — senão abrir o painel no meio de um voo já em andamento dispararia um
 * alerta de "lançamento" de algo que já está subindo há minutos.
 */
export function useLaunchLandingWatcher(todayFlights: TodayFlight[], station: Station) {
  const initializedRef = useRef(false)

  useEffect(() => {
    if (todayFlights.length === 0 && !initializedRef.current) return
    const notified = readNotified()

    if (!initializedRef.current) {
      initializedRef.current = true
      for (const f of todayFlights) {
        const events = new Set(notified[f.sondeNumber] ?? [])
        if (f.isLive) events.add('launch')
        if (flightStatus(f) === 'landed') events.add('landing')
        notified[f.sondeNumber] = [...events]
      }
      writeNotified(notified)
      return
    }

    let changed = false
    for (const f of todayFlights) {
      const events = new Set(notified[f.sondeNumber] ?? [])
      const status = flightStatus(f)

      if (f.isLive && !events.has('launch')) {
        events.add('launch')
        changed = true
        send('launch', f)
      }
      if (status === 'landed' && !events.has('landing')) {
        events.add('landing')
        changed = true
        send('landing', f)
      }
      notified[f.sondeNumber] = [...events]
    }
    if (changed) writeNotified(notified)

    function send(event: 'launch' | 'landing', f: TodayFlight) {
      fetch('/api/telegram-notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event, sondeNumber: f.sondeNumber, lat: f.lat, lon: f.lon, altitude: f.altitude,
          climbing: f.climbing, frequencyMHz: f.frequencyMHz, source: f.source, lastReceiver: f.lastReceiver,
          lastReportUtc: f.lastReportUtc,
          stationId: station.id, stationName: station.name, stationLat: station.lat, stationLon: station.lon,
        }),
      }).catch(() => { /* melhor esforço: falha de rede não deve travar o painel */ })
    }
  }, [todayFlights, station.id, station.name, station.lat, station.lon])
}
