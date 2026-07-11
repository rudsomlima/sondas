'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchNearbySondes, sameCallsign, deriveReceiverStatus,
  LIVE_STALE_MS, NearbySonde, ReceiverStatus,
} from '@/app/lib/sondehub'
import { getSettings } from '@/app/lib/settings'

// Uma sonda que o receptor DO USUÁRIO já decodificou nesta sessão. Posição/
// altitude vêm do frame mais recente (de qualquer uploader — a sonda é a
// mesma); snr/rssi/frequência vêm do último frame subido pelo callsign dele.
export interface MyReceiverSonde {
  serial: string
  lat: number
  lon: number
  alt: number
  vel_v: number
  lastReportUtc: string // frame mais recente (qualquer uploader)
  myLastHeardUtc: string // último frame subido pelo MEU callsign
  frequency?: number
  type?: string
  rssi?: number
  snr?: number
  battV?: number // bateria da sonda (V), quando o frame traz
  isLive: boolean
}

const SEARCH_RADIUS_KM = 300
const LAST_SECONDS = 3 * 3600 // mesma janela do raio de busca do /sondes
// Sonda some da lista quando o receptor não a ouve há mais que isso — cobre
// o voo inteiro (~2h) sem segurar voos de ciclos sinóticos anteriores.
export const FORGET_MS = LAST_SECONDS * 1000

interface StickyEntry {
  latest: NearbySonde // frame mais recente visto (qualquer uploader)
  mine: NearbySonde // último frame cujo uploader era o usuário
}

/**
 * Polling do "meu receptor" via SondeHub (ver nota em app/lib/sondehub.ts):
 * o endpoint /sondes só expõe o ÚLTIMO uploader de cada sonda, então este
 * hook mantém memória sticky por sessão — uma vez visto um frame do callsign
 * do usuário para um serial, a sonda continua "dele" enquanto viva, mesmo
 * que outras estações vençam a corrida do último upload nos polls seguintes.
 *
 * Estrutura de polling clonada de useLiveFlights (app/historico/hooks), com
 * uma diferença deliberada: com alertas ativados o polling NÃO pausa com a
 * aba oculta (é em segundo plano que a notificação vale a pena) — apenas
 * alonga o intervalo para 60s.
 */
export function useReceiverStatus(pollSeconds = 20) {
  const [mySondes, setMySondes] = useState<MyReceiverSonde[]>([])
  const [status, setStatus] = useState<ReceiverStatus | null>(null)
  const [checked, setChecked] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [alertsEnabled, setAlertsEnabled] = useState(false)
  const stickyRef = useRef<Map<string, StickyEntry>>(new Map())
  const settingsRef = useRef(getSettings())

  useEffect(() => {
    // getSettings() é no-op no servidor; relê no mount pro valor real do browser.
    settingsRef.current = getSettings()
    const s = settingsRef.current
    setEnabled(s.uploaderCallsign !== '' && s.homeLat != null && s.homeLon != null)
    setAlertsEnabled(s.receiverAlertsEnabled)
  }, [])

  const fetchReceiver = useCallback(async () => {
    const s = settingsRef.current
    if (!s.uploaderCallsign || s.homeLat == null || s.homeLon == null) return
    try {
      const nearby = await fetchNearbySondes(s.homeLat, s.homeLon, SEARCH_RADIUS_KM, LAST_SECONDS)
      const sticky = stickyRef.current
      const now = Date.now()

      for (const sonde of nearby) {
        const isMine = sameCallsign(sonde.uploaderCallsign, s.uploaderCallsign)
        const entry = sticky.get(sonde.serial)
        if (entry) {
          entry.latest = sonde
          if (isMine) entry.mine = sonde
        } else if (isMine) {
          sticky.set(sonde.serial, { latest: sonde, mine: sonde })
        }
      }

      // Esquece sondas sem frame recente (pousadas há horas / fora da janela).
      for (const [serial, entry] of sticky) {
        const t = new Date(entry.latest.datetime).getTime()
        if (isNaN(t) || now - t > FORGET_MS) sticky.delete(serial)
      }

      const list: MyReceiverSonde[] = [...sticky.values()].map(({ latest, mine }) => ({
        serial: latest.serial,
        lat: latest.lat,
        lon: latest.lon,
        alt: latest.alt,
        vel_v: latest.vel_v,
        lastReportUtc: latest.datetime,
        myLastHeardUtc: mine.datetime,
        frequency: mine.frequency ?? latest.frequency,
        type: mine.type ?? latest.type,
        rssi: mine.rssi,
        snr: mine.snr,
        battV: mine.battV ?? latest.battV,
        isLive: now - new Date(latest.datetime).getTime() < LIVE_STALE_MS,
      })).sort((a, b) => b.myLastHeardUtc.localeCompare(a.myLastHeardUtc))

      setMySondes(list)
      setStatus(deriveReceiverStatus(
        list.map(m => ({ datetime: m.myLastHeardUtc } as NearbySonde)), now
      ))
    } catch {
      // Falha pontual de rede: mantém o que está na tela, tenta no próximo poll.
    }
    setChecked(true)
  }, [])

  useEffect(() => {
    if (!enabled) { setChecked(true); return }
    fetchReceiver()
    const startInterval = (secs: number) => setInterval(fetchReceiver, secs * 1000)
    let interval: ReturnType<typeof setInterval> | null = startInterval(pollSeconds)

    const onVisibility = () => {
      if (interval) { clearInterval(interval); interval = null }
      if (document.hidden) {
        // Com alertas ligados continua em segundo plano, só mais devagar.
        if (settingsRef.current.receiverAlertsEnabled) interval = startInterval(60)
      } else {
        fetchReceiver()
        interval = startInterval(pollSeconds)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      if (interval) clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [enabled, fetchReceiver, pollSeconds])

  return { mySondes, status, checked, enabled, alertsEnabled, refresh: fetchReceiver }
}
