'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchNearbySondes, fetchSondeHubRawFrames, type NearbySonde } from '@/app/lib/sondehub'
import { analyzeReception, type RawSondeFrame, type ReceptionReport } from '@/app/lib/receptionAnalysis'
import { useReceiverStations } from '@/app/lib/receiverStationsClient'
import { stationKey } from '@/app/lib/receiverStations'
import { fetchRegistryYear } from '@/app/lib/sondeRegistryClient'

/**
 * Voos que o receptor ouviu + diagnóstico de recepção do voo escolhido (ver
 * app/lib/receptionAnalysis.ts).
 *
 * A lista junta duas origens: o SondeHub ao vivo (sondas dos últimos dias
 * num raio de 300 km, ouvidas ou não) e o registro permanente de sondas no
 * R2 (todas as do ano em que o seu callsign aparece entre os receptores). O
 * /sonde/{serial} do SondeHub guarda o voo inteiro por meses, então voos
 * antigos também podem ser analisados.
 *
 * Os quadros crus de um voo passam de 1 MB, então o relatório já calculado
 * fica em `localStorage` por voo: abrir a página de novo não rebaixa a trilha.
 */

const LIST_SECONDS = 3 * 24 * 3600
const SEARCH_RADIUS_KM = 300
// v2: os relatórios passaram a trazer `extras` (azimute, alcance, RSSI por distância).
const STORAGE_PREFIX = 'sondas_reception_v2'

export interface RecentFlight {
  serial: string
  lastReportMs: number
  frequency?: number
  type?: string
  heardByMe?: boolean // o registro diz que o seu callsign participou da recepção
}

export interface RankedStation {
  callsign: string
  flights: number    // sondas do registro em que a estação aparece como receptora
  frames: number     // soma dos quadros atribuídos a ela (mínimo, por causa da deduplicação)
  mine: boolean
}

export interface ReportHistoryPoint {
  serial: string
  endMs: number
  maxDistKm: number
  lastHeardAltKm: number | null
}

function storageKey(serial: string, callsign: string) {
  return `${STORAGE_PREFIX}_${callsign.toUpperCase()}_${serial}`
}

function readStored(serial: string, callsign: string): ReceptionReport | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(storageKey(serial, callsign))
    return raw ? JSON.parse(raw) as ReceptionReport : null
  } catch { return null }
}

function writeStored(serial: string, callsign: string, report: ReceptionReport) {
  try { localStorage.setItem(storageKey(serial, callsign), JSON.stringify(report)) } catch { /* cheio: só memória */ }
}

/** Relatórios já calculados deste callsign (guardados em localStorage), do mais antigo ao mais novo. */
function readHistory(callsign: string): ReportHistoryPoint[] {
  if (typeof window === 'undefined') return []
  const prefix = `${STORAGE_PREFIX}_${callsign.toUpperCase()}_`
  const out: ReportHistoryPoint[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k || !k.startsWith(prefix)) continue
      const r = JSON.parse(localStorage.getItem(k) ?? 'null') as ReceptionReport | null
      if (r?.extras?.maxDistKm != null) {
        out.push({ serial: r.serial, endMs: r.endMs, maxDistKm: r.extras.maxDistKm, lastHeardAltKm: r.extras.lastHeardAltKm })
      }
    }
  } catch { /* storage indisponível */ }
  return out.sort((a, b) => a.endMs - b.endMs)
}

export function useReceptionQuality(
  callsign: string, rxLat: number | null, rxLon: number | null, rxAltM: number,
) {
  const [flights, setFlights] = useState<RecentFlight[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [serial, setSerial] = useState<string | null>(null)
  const [report, setReport] = useState<ReceptionReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestRef = useRef(0)
  // Quadros do voo aberto, só em memória (passam de 1 MB): permitem refazer a
  // análise do ponto de vista de outra estação sem baixar de novo.
  const framesRef = useRef<{ serial: string; frames: RawSondeFrame[] } | null>(null)
  const [viewCallsign, setViewCallsign] = useState<string | null>(null)
  const [viewReport, setViewReport] = useState<ReceptionReport | null>(null)
  const [viewLoading, setViewLoading] = useState(false)
  const [viewError, setViewError] = useState<string | null>(null)
  const [ranking, setRanking] = useState<RankedStation[]>([])
  const [history, setHistory] = useState<ReportHistoryPoint[]>([])
  const stations = useReceiverStations()

  const enabled = !!callsign.trim() && rxLat != null && rxLon != null

  const loadList = useCallback(async () => {
    if (!enabled || rxLat == null || rxLon == null) return
    setListLoading(true)
    setListError(null)
    try {
      const me = callsign.trim().toUpperCase()
      const year = new Date().getUTCFullYear()
      const [nearby, reg, regPrev] = await Promise.all([
        fetchNearbySondes(rxLat, rxLon, SEARCH_RADIUS_KM, LIST_SECONDS).catch(() => [] as NearbySonde[]),
        fetchRegistryYear(year),
        fetchRegistryYear(year - 1),
      ])
      const tally = new Map<string, RankedStation>()
      for (const r of [...reg, ...regPrev]) {
        for (const x of r.receivers ?? []) {
          const key = x.callsign.trim().toUpperCase()
          if (!key) continue
          const cur = tally.get(key) ?? { callsign: x.callsign.trim(), flights: 0, frames: 0, mine: key === me }
          cur.flights++
          cur.frames += x.frames ?? 0
          tally.set(key, cur)
        }
      }
      setRanking([...tally.values()].sort((a, b) => b.flights - a.flights || b.frames - a.frames).slice(0, 15))
      const bySerial = new Map<string, RecentFlight>()
      for (const s of nearby) {
        const t = new Date(s.datetime).getTime()
        if (Number.isFinite(t)) bySerial.set(s.serial, { serial: s.serial, lastReportMs: t, frequency: s.frequency, type: s.type })
      }
      for (const r of [...reg, ...regPrev]) {
        const heard = !!r.receivers?.some(x => x.callsign.trim().toUpperCase() === me) || r.lastReceiver?.trim().toUpperCase() === me
        if (!heard) continue
        const t = new Date(r.lastFrameUtc ?? r.lastPos?.at ?? r.firstFrameUtc ?? '').getTime()
        if (!Number.isFinite(t)) continue
        const prev = bySerial.get(r.serial)
        bySerial.set(r.serial, {
          serial: r.serial, lastReportMs: Math.max(t, prev?.lastReportMs ?? 0),
          frequency: prev?.frequency ?? r.frequencyMHz, type: prev?.type ?? r.type, heardByMe: true,
        })
      }
      const list = [...bySerial.values()].sort((a, b) => b.lastReportMs - a.lastReportMs)
      setFlights(list)
      setSerial(prev => prev && list.some(f => f.serial === prev) ? prev : list[0]?.serial ?? null)
    } catch (e: any) {
      setListError(e?.message || 'Falha ao listar os voos recentes no sondehub.org')
    } finally {
      setListLoading(false)
    }
  }, [enabled, rxLat, rxLon, callsign])

  useEffect(() => { loadList() }, [loadList])

  const analyze = useCallback(async (target: string, force = false) => {
    if (!enabled || rxLat == null || rxLon == null) return
    const request = ++requestRef.current
    setError(null)
    setViewCallsign(null)
    setViewReport(null)
    const stored = force ? null : readStored(target, callsign)
    if (stored) { setReport(stored); setLoading(false); setHistory(readHistory(callsign)); return }
    framesRef.current = null
    setReport(null)
    setLoading(true)
    try {
      const frames = await fetchSondeHubRawFrames(target)
      if (request !== requestRef.current) return
      const result = analyzeReception(frames, rxLat, rxLon, rxAltM, callsign)
      if (!result) {
        setError('O sondehub.org não devolveu quadros deste voo.')
        return
      }
      framesRef.current = { serial: target, frames }
      setReport(result)
      writeStored(target, callsign, result)
      setHistory(readHistory(callsign))
    } catch (e: any) {
      if (request !== requestRef.current) return
      setError(e?.message || 'Falha ao consultar os quadros do voo no sondehub.org')
    } finally {
      if (request === requestRef.current) setLoading(false)
    }
  }, [enabled, rxLat, rxLon, rxAltM, callsign])

  useEffect(() => {
    if (!serial) { setReport(null); return }
    analyze(serial)
  }, [serial, analyze])

  // Cobertura de OUTRA estação neste voo: a mesma análise, com a posição e o
  // callsign dela no lugar dos seus. Precisa da posição conhecida da estação
  // (receiver-stations) — a altura da antena é desconhecida (usa a altitude
  // registrada, se houver).
  const viewStation = useCallback(async (target: string | null) => {
    setViewCallsign(target)
    setViewError(null)
    setViewReport(null)
    if (!target || !serial) return
    const st = stations.get(stationKey(target))
    if (!st) { setViewError(`A posição de ${target} ainda não é conhecida pelo app.`); return }
    setViewLoading(true)
    try {
      let frames = framesRef.current?.serial === serial ? framesRef.current.frames : null
      if (!frames) {
        frames = await fetchSondeHubRawFrames(serial)
        framesRef.current = { serial, frames }
      }
      const result = analyzeReception(frames, st.lat, st.lon, st.alt ?? 0, target)
      if (!result) setViewError('Sem quadros deste voo.')
      else setViewReport(result)
    } catch (e: any) {
      setViewError(e?.message || 'Falha ao consultar os quadros do voo no sondehub.org')
    } finally {
      setViewLoading(false)
    }
  }, [serial, stations])

  useEffect(() => { setViewCallsign(null); setViewReport(null); setViewError(null) }, [serial])
  useEffect(() => { if (enabled) setHistory(readHistory(callsign)) }, [enabled, callsign])

  const selected = useMemo(() => flights.find(f => f.serial === serial) ?? null, [flights, serial])

  return {
    enabled, flights, listLoading, listError, serial, setSerial, selected,
    report, loading, error,
    ranking, history,
    viewCallsign, viewReport, viewLoading, viewError, viewStation,
    refresh: () => { loadList(); if (serial) analyze(serial, true) },
  }
}
