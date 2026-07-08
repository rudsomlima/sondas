import { NextResponse } from 'next/server'
import { readYearStore, writeYearStore, writeSyncStatus } from '@/app/lib/blobStore'
import {
  fetchRadiosondyFeatures, fetchLiveFlights, findRecoveredMatch, findLiveMatch,
  isWithinMatchWindow, launchUtcInstant, LiveSondePosition, parsePopupTelemetry,
} from '@/app/lib/radiosondy'
import { fetchSondeHubArchiveFramesForDay } from '@/app/lib/sondehub'
import { SOUTH_AMERICA_STATIONS } from '@/app/lib/stations'
import { nowGMT3 } from '@/app/lib/types'
import { analyzeTrajectory, pointsFromFrames } from '@/app/lib/trajectory'

export const maxDuration = 60

/**
 * Checagem em segundo plano de correspondência no radiosondy.info, pra não
 * depender do navegador descobrir isso reativamente (e pagar o fetch pesado
 * do feed ao vivo) a cada clique no calendário. Disposado por um Vercel Cron
 * (ver vercel.json) — sem autenticação por enquanto (só lê/escreve dados
 * públicos de lançamentos, sem nada sensível).
 *
 * Desenhado pra ser leve e retomável:
 * - só processa o ano corrente;
 * - só estações com "startplace" conhecido (app/lib/stations.ts);
 * - nunca rechecha lançamentos que já têm `radiosondyMatch` definido;
 * - busca o radiosondy.info uma vez por (estação, mês) com lançamentos
 *   pendentes, não uma vez por lançamento;
 * - o feed ao vivo (~1MB) só é buscado uma única vez por execução inteira, e
 *   só se algum lançamento pendente ainda estiver dentro da janela de voo.
 * - se uma execução não terminar tudo (timeout, falha pontual), a próxima
 *   retoma de onde ficou, já que só o que falta fica sem `radiosondyMatch`.
 */
export async function GET() {
  const startedAt = Date.now()
  const local = nowGMT3()
  const currentYear = local.getUTCFullYear()
  const currentMonth = local.getUTCMonth() + 1

  // Estações sem cobertura na Wyoming (wyomingSupported === false) já têm o
  // histórico inteiro derivado do radiosondy.info (ver fetchRadiosondyLaunches
  // em app/lib/radiosondy.ts) — não existe um lançamento "separado" da
  // Wyoming pra cruzar aqui, então não faz sentido aplicar o match.
  const stations = SOUTH_AMERICA_STATIONS.filter(s => s.radiosondyStartplace && s.wyomingSupported !== false)

  let liveFlightsCache: LiveSondePosition[] | null = null
  async function liveFlightsOnce(): Promise<LiveSondePosition[]> {
    if (liveFlightsCache === null) {
      liveFlightsCache = await fetchLiveFlights().catch(() => [])
    }
    return liveFlightsCache
  }

  const summary: Record<string, { checked: number; yes: number; no: number; pending: number }> = {}

  for (const station of stations) {
    const startplace = station.radiosondyStartplace!
    const store = await readYearStore(station.id, currentYear)
    if (!store || store.launches.length === 0) continue

    // Reprocessa por posição OU `sources` ausentes — não só por posição. Isso
    // também revisita lançamentos gravados por uma versão anterior do código
    // que já tinham `position` mas não tinham `sources` explicitado por
    // completo (ex.: sondehub nunca marcado como `false` quando o
    // radiosondy.info já havia resolvido) — sem isso, o badge de confiança
    // dessa fonte ficava "pendente" (piscando) pra sempre.
    const isFullyResolved = (l: (typeof store.launches)[number]) =>
      !!l.position && l.sources?.wyoming !== undefined && l.sources?.radiosondy !== undefined && l.sources?.sondehub !== undefined

    const byMonth = new Map<number, typeof store.launches>()
    for (const l of store.launches) {
      if (isFullyResolved(l) || l.month > currentMonth) continue
      const list = byMonth.get(l.month) ?? []
      list.push(l)
      byMonth.set(l.month, list)
    }
    if (byMonth.size === 0) continue

    let changed = false
    let checked = 0, yes = 0, no = 0, pending = 0

    for (const [month, pendingLaunches] of byMonth) {
      let features
      try {
        features = await fetchRadiosondyFeatures(currentYear, month, startplace)
      } catch {
        pending += pendingLaunches.length
        continue // falha pontual do radiosondy.info: tenta de novo na próxima execução
      }

      for (const l of pendingLaunches) {
        const instant = launchUtcInstant(l.year, l.month, l.day, l.time_utc, l.time_local)
        const recovered = findRecoveredMatch(features, instant)
        if (recovered) {
          l.radiosondyMatch = 'yes'
          const { altitude, course } = parsePopupTelemetry(recovered.feature.popupContent)
          l.position = {
            lat: recovered.feature.lat, lon: recovered.feature.lon,
            sondeNumber: recovered.feature.sondeNumber, status: recovered.feature.status,
            altitude: altitude || undefined,
            course: course || undefined,
          }
          // sondehub explicitamente false (não undefined): o radiosondy.info já
          // resolveu, então o sondehub.org nunca chega a ser consultado — sem
          // isso, computeConfidence() tratava "nunca checado" como "pendente"
          // (badge piscando pra sempre, mesmo já tudo resolvido).
          l.sources = { wyoming: !l.source, radiosondy: true, sondehub: false }
          changed = true
          checked++
          yes++
          continue
        }

        if (isWithinMatchWindow(instant)) {
          const live = findLiveMatch(await liveFlightsOnce(), startplace)
          if (live) {
            l.radiosondyMatch = 'yes'
            l.position = { lat: live.lat, lon: live.lon, sondeNumber: live.sondeNumber, status: 'UNKNOWN',
              altitude: live.altitude || undefined, course: live.course || undefined }
            l.sources = { wyoming: !l.source, radiosondy: true, sondehub: false }
            changed = true
            checked++
            yes++
          } else {
            // Ainda dentro da janela de voo e sem nada: pode ainda ganhar
            // correspondência depois (pouso publicado com atraso, ou a sonda
            // ainda nem decolou de fato) — não marca 'no' ainda, recheca no
            // próximo run.
            pending++
          }
          continue
        }

        // Fora da janela e sem nada no radiosondy.info: tenta o sondehub.org
        // (arquivo S3) como segunda fonte antes de desistir — cobre voos só
        // rastreados por RF, sem recuperação física registrada (caso real:
        // Fernando de Noronha, 12/03/2026, V2931576).
        let sonde: { serial: string; lat: number; lon: number } | null = null
        try {
          const archive = await fetchSondeHubArchiveFramesForDay(station.id, l.year, l.month, l.day)
          if (archive) {
            const points = pointsFromFrames(archive.frames)
            const last = points[points.length - 1]
            if (last) {
              sonde = { serial: archive.serial, lat: last.lat, lon: last.lon }
              // Frames já baixados: estatísticas de voo a custo ~zero.
              const a = analyzeTrajectory(points)
              if (a.pointCount >= 5) {
                l.flightStats = {
                  burstAltM: Math.round(a.maxAltM),
                  durationMin: a.durationMin ?? undefined,
                  distanceKm: a.distanceKm ? Math.round(a.distanceKm * 10) / 10 : undefined,
                  bearingDeg: a.bearingDeg ? Math.round(a.bearingDeg) : undefined,
                }
              }
            }
          }
        } catch {
          // Falha pontual: trata como sem posição, tenta de novo no próximo run.
        }
        if (sonde) {
          l.radiosondyMatch = 'yes'
          l.position = { lat: sonde.lat, lon: sonde.lon, sondeNumber: sonde.serial, status: 'UNKNOWN' }
          l.sources = { wyoming: !l.source, radiosondy: false, sondehub: true }
        } else {
          // Só marca 'no' definitivamente se o lançamento tem mais de 7 dias —
          // recuperações tardias (usuário registra no radiosondy.info dias depois)
          // ou dados atrasados do sondehub S3 ainda podem aparecer antes disso.
          const ageMs = Date.now() - instant.getTime()
          if (ageMs > 7 * 24 * 60 * 60 * 1000) {
            l.radiosondyMatch = 'no'
            // Ambas as fontes já foram checadas nesta execução (radiosondy.info
            // acima, sondehub.org agora) e nenhuma achou nada — marca as duas
            // como explicitamente ausentes, não "pendente" (evita piscar pra sempre).
            l.sources = { wyoming: !l.source, radiosondy: false, sondehub: false }
          }
          // else: deixa tudo undefined → cron re-checa no próximo run
        }
        changed = true
        checked++
        sonde ? yes++ : no++
      }
    }

    if (changed) {
      store.updatedAt = Date.now()
      await writeYearStore(station.id, store)
    }
    if (checked > 0 || pending > 0) {
      summary[station.id] = { checked, yes, no, pending }
    }
  }

  await writeSyncStatus({
    lastRunAt: startedAt,
    durationMs: Date.now() - startedAt,
    year: currentYear,
    stations: summary,
  })

  return NextResponse.json({ ok: true, year: currentYear, stations: summary })
}
