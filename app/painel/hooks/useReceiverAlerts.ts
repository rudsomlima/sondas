'use client'

import { useEffect, useRef } from 'react'
import { haversineKm } from '@/app/lib/geo'
import { getSettings } from '@/app/lib/settings'
import type { MyReceiverSonde } from './useReceiverStatus'
import type { SelectedTarget } from '../selection'

// Serials já notificados: sessionStorage (não localStorage) de propósito —
// sobrevive a um refresh da aba sem re-notificar, mas reseta em sessão nova.
const NOTIFIED_KEY = 'sondas_rx_notified'

function readNotified(): Set<string> {
  try {
    const raw = sessionStorage.getItem(NOTIFIED_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(arr) ? arr.filter(x => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

function writeNotified(set: Set<string>) {
  try { sessionStorage.setItem(NOTIFIED_KEY, JSON.stringify([...set])) } catch { /* não crítico */ }
}

/**
 * Notification API quando o receptor do usuário começa a decodificar uma
 * sonda NOVA. Limitação inerente de app 100% client-side: só dispara com a
 * aba do painel aberta (mesmo em segundo plano — o useReceiverStatus segue
 * pollando oculto quando alertas estão ativados).
 *
 * A primeira carga da sessão marca tudo que já estava no ar como "visto"
 * sem notificar — senão abrir o painel no meio de um voo dispararia alerta
 * de algo que o usuário obviamente já sabe.
 */
export function useReceiverAlerts(
  mySondes: MyReceiverSonde[],
  checked: boolean,
  onSelect: (t: SelectedTarget) => void
) {
  const initializedRef = useRef(false)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  useEffect(() => {
    if (!checked) return
    const notified = readNotified()

    if (!initializedRef.current) {
      initializedRef.current = true
      for (const m of mySondes) notified.add(m.serial)
      writeNotified(notified)
      return
    }

    const s = getSettings()
    let changed = false
    for (const m of mySondes) {
      if (notified.has(m.serial)) continue
      notified.add(m.serial)
      changed = true

      if (!s.receiverAlertsEnabled) continue
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') continue

      const distKm = s.homeLat != null && s.homeLon != null
        ? haversineKm(s.homeLat, s.homeLon, m.lat, m.lon)
        : null
      if (s.alertRadiusKm > 0 && distKm != null && distKm > s.alertRadiusKm) continue

      try {
        const parts = [
          m.frequency !== undefined ? `${m.frequency.toFixed(2)} MHz` : null,
          m.type ?? null,
          distKm != null ? `${Math.round(distKm)} km de casa` : null,
        ].filter(Boolean)
        const n = new Notification('Nova sonda no seu receptor', {
          body: `${m.serial}${parts.length ? ' — ' + parts.join(' · ') : ''}`,
          tag: m.serial, // dedupe nativo do navegador
        })
        n.onclick = () => {
          window.focus()
          onSelectRef.current({
            serial: m.serial, lat: m.lat, lon: m.lon,
            altitude: m.alt, climbing: m.vel_v,
            isLive: m.isLive, lastReportUtc: m.lastReportUtc,
            snr: m.snr, rssi: m.rssi, frequency: m.frequency,
            receivedByMe: true,
          })
          n.close()
        }
      } catch {
        // Notification pode lançar em navegadores/contextos sem suporte — nunca
        // deixar isso derrubar o painel.
      }
    }
    if (changed) writeNotified(notified)
  }, [mySondes, checked])
}
