'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchNearbySondes, fetchSondeHubRawFrames, type NearbySonde } from '@/app/lib/sondehub'
import { analyzeReception, type ReceptionReport } from '@/app/lib/receptionAnalysis'

/**
 * Voos recentes perto do receptor + diagnóstico de recepção do voo escolhido
 * (ver app/lib/receptionAnalysis.ts).
 *
 * Os quadros crus de um voo são ~2 MB, então o relatório já calculado fica em
 * `localStorage` por voo: abrir a página de novo não rebaixa a mesma trilha.
 * A janela ao vivo do SondeHub é de ~3 dias — passado isso o voo desaparece da
 * lista e o relatório salvo é o único registro que sobra.
 */

// A API aceita até 7 dias, mas os quadros por uploader só existem na janela ao
// vivo (~3 dias); pedir mais só encheria a lista de voos sem análise possível.
const LIST_SECONDS = 3 * 24 * 3600
const SEARCH_RADIUS_KM = 300
const STORAGE_PREFIX = 'sondas_reception_v1'

export interface RecentFlight {
  serial: string
  lastReportMs: number
  frequency?: number
  type?: string
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
      const sondes: NearbySonde[] = await fetchNearbySondes(rxLat, rxLon, SEARCH_RADIUS_KM, LIST_SECONDS)
      const list = sondes
        .map(s => ({
          serial: s.serial,
          lastReportMs: new Date(s.datetime).getTime(),
          frequency: s.frequency,
          type: s.type,
        }))
        .filter(f => Number.isFinite(f.lastReportMs))
        .sort((a, b) => b.lastReportMs - a.lastReportMs)
      setFlights(list)
      setSerial(prev => prev && list.some(f => f.serial === prev) ? prev : list[0]?.serial ?? null)
    } catch (e: any) {
      setListError(e?.message || 'Falha ao listar os voos recentes no sondehub.org')
    } finally {
      setListLoading(false)
    }
  }, [enabled, rxLat, rxLon])

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
        setError('O sondehub.org não tem mais os quadros deste voo (a janela ao vivo é de ~3 dias).')
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
