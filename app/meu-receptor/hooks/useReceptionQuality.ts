'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchNearbySondes, fetchSondeHubRawFrames, type NearbySonde } from '@/app/lib/sondehub'
import { analyzeReception, type ReceptionReport } from '@/app/lib/receptionAnalysis'
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
const STORAGE_PREFIX = 'sondas_reception_v1'

export interface RecentFlight {
  serial: string
  lastReportMs: number
  frequency?: number
  type?: string
  heardByMe?: boolean // o registro diz que o seu callsign participou da recepção
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
    const stored = force ? null : readStored(target, callsign)
    if (stored) { setReport(stored); setLoading(false); return }
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
      setReport(result)
      writeStored(target, callsign, result)
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

  const selected = useMemo(() => flights.find(f => f.serial === serial) ?? null, [flights, serial])

  return {
    enabled, flights, listLoading, listError, serial, setSerial, selected,
    report, loading, error,
    refresh: () => { loadList(); if (serial) analyze(serial, true) },
  }
}
