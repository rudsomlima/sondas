'use client'

import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, RotateCw, SignalHigh } from 'lucide-react'
import { GMT3 } from '@/app/lib/types'
import { formatDistance } from '@/app/lib/geo'
import { LOW_HIGH_SPLIT_DEG, VERDICT_TEXT, type ReceptionReport, type StationReception } from '@/app/lib/receptionAnalysis'
import { useReceptionQuality } from '../hooks/useReceptionQuality'
import { PanelTitle } from './Collapsible'

interface ReceptionQualityPanelProps {
  callsign: string
  rxLat: number | null
  rxLon: number | null
  rxAltM: number
}

// Voos mostrados como botão; os mais antigos vão pra uma lista.
const CHIP_LIMIT = 10

function pad(n: number) { return String(n).padStart(2, '0') }

// Instante UTC → "dd/mm HH:MM" em GMT-3 (o fuso usado em todo o app).
function fmtLocal(ms: number): string {
  const d = new Date(ms + GMT3)
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`
}

function barColor(fraction: number): string {
  if (fraction >= 0.7) return 'bg-emerald-500'
  if (fraction >= 0.35) return 'bg-amber-500'
  return 'bg-red-500'
}

function StationRow({ s, mine }: { s: StationReception; mine?: boolean }) {
  return (
    <tr className={mine ? 'text-white' : 'text-gray-400'}>
      <td className="py-1.5 pr-3 mono whitespace-nowrap">
        {s.callsign}{mine && <span className="ml-1.5 badge badge-info text-[9px] px-1.5 py-0">você</span>}
      </td>
      <td className="py-1.5 pr-3 mono text-right">{s.frames.toLocaleString('pt-BR')}</td>
      <td className="py-1.5 pr-3 mono text-right">{s.medianRssi != null ? `${s.medianRssi.toFixed(1)} dBm` : '—'}</td>
      <td className="py-1.5 pr-3 mono text-right">{(s.maxAltM / 1000).toFixed(1)} km</td>
      <td className="py-1.5 mono text-right whitespace-nowrap">{formatDistance(s.maxDistKm)}</td>
    </tr>
  )
}

// Cobertura agregada das faixas abaixo/acima de um ângulo (o teto detectado),
// ponderada por minuto — é o resumo que acompanha o veredito.
function coverageSplit(report: ReceptionReport, deg: number): { below: number | null; above: number | null } {
  const agg = (bands: typeof report.bands) => {
    const total = bands.reduce((sum, b) => sum + b.minutesTotal, 0)
    return total > 0 ? bands.reduce((sum, b) => sum + b.minutesMine, 0) / total : null
  }
  return {
    below: agg(report.bands.filter(b => b.hiDeg <= deg)),
    above: agg(report.bands.filter(b => b.loDeg >= deg)),
  }
}

function Report({ report }: { report: ReceptionReport }) {
  const verdict = VERDICT_TEXT[report.verdict]
  const good = report.verdict === 'good'
  const splitDeg = report.ceilingDeg ?? report.floorDeg ?? LOW_HIGH_SPLIT_DEG
  const split = coverageSplit(report, splitDeg)
  const antennas = [report.mine, ...report.others]
    .filter((s): s is StationReception => !!s && !!s.antenna)
  return (
    <>
      <div className={`rounded border p-3 mb-4 ${good ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-amber-500/40 bg-amber-500/5'}`}>
        <p className={`text-sm font-medium flex items-center gap-2 ${good ? 'text-emerald-400' : 'text-amber-400'}`}>
          {good ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
          {verdict.title}
        </p>
        <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">{verdict.detail}</p>
        {report.ceilingDeg != null && (
          <p className="text-xs text-gray-300 mt-2">
            Teto de recepção: você acompanha a sonda até cerca de{' '}
            <span className="mono text-white">{report.ceilingDeg}°</span> de elevação e perde acima disso.
          </p>
        )}
        {split.below != null && split.above != null && (
          <p className="text-xs text-gray-300 mt-1 mono">
            até {splitDeg}°: {pct(split.below)} dos minutos · acima de {splitDeg}°: {pct(split.above)}
          </p>
        )}
      </div>

      <p className="label-xs mb-2">Cobertura por ângulo de elevação</p>
      <div className="space-y-2 mb-4">
        {report.bands.map(b => {
          const fraction = b.minutesTotal > 0 ? b.minutesMine / b.minutesTotal : 0
          return (
            <div key={`${b.loDeg}-${b.hiDeg}`} className="flex items-center gap-2">
              <span className="mono text-xs text-gray-400 w-16 shrink-0">{b.loDeg}–{b.hiDeg}°</span>
              <div className="flex-1 h-4 bg-surface-2 rounded overflow-hidden min-w-0">
                <div className={`h-full ${barColor(fraction)}`} style={{ width: `${Math.max(fraction * 100, fraction > 0 ? 2 : 0)}%` }} />
              </div>
              <span className="mono text-xs text-white w-11 text-right shrink-0">{pct(fraction)}</span>
              <span
                className="mono text-[10px] text-faint w-28 text-right shrink-0 hidden sm:block"
                title={`Você ouviu ${b.minutesMine} dos ${b.minutesTotal} minutos em que a sonda esteve nesta faixa`}
              >
                {b.minutesMine}/{b.minutesTotal} min · {b.medianAltKm.toFixed(1)} km
              </span>
            </div>
          )
        })}
      </div>

      <p className="label-xs mb-2">Quem ouviu esta sonda</p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-faint border-b border-border">
              <th className="text-left font-normal pb-1.5 pr-3">estação</th>
              <th className="text-right font-normal pb-1.5 pr-3">quadros</th>
              <th className="text-right font-normal pb-1.5 pr-3">RSSI med.</th>
              <th className="text-right font-normal pb-1.5 pr-3">alt. máx.</th>
              <th className="text-right font-normal pb-1.5">dist. máx.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {report.mine && <StationRow s={report.mine} mine />}
            {report.others.map(s => <StationRow key={s.callsign} s={s} />)}
          </tbody>
        </table>
      </div>

      {antennas.length > 1 && (
        <p className="text-[11px] text-faint mt-2">
          Antenas declaradas no SondeHub: {antennas.map(s => `${s.callsign} (${s.antenna})`).join(' · ')}
        </p>
      )}

      <p className="text-[11px] text-faint mt-3 leading-relaxed">
        O SondeHub guarda cada quadro uma vez só, atribuído a quem o subiu primeiro — a coluna
        &quot;quadros&quot; é um mínimo, não a contagem real de recepção. Por isso a cobertura é medida
        por minuto: o minuto conta como seu se ao menos um dos ~60 quadros dele veio do seu callsign.
        Voo de {fmtLocal(report.startMs)} a {fmtLocal(report.endMs)} (GMT-3), {report.minutesTotal} min
        com telemetria de alguma estação.
      </p>
    </>
  )
}

/**
 * Diagnóstico de recepção por ângulo de elevação — ver app/lib/receptionAnalysis.ts
 * pro porquê do ângulo (é a antena que decide) e pra ressalva da deduplicação
 * do SondeHub.
 */
export default function ReceptionQualityPanel({ callsign, rxLat, rxLon, rxAltM }: ReceptionQualityPanelProps) {
  const q = useReceptionQuality(callsign, rxLat, rxLon, rxAltM)

  return (
    <div className="panel p-5 mb-6">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
        <PanelTitle icon={<SignalHigh size={15} className="text-blue-400" />}>
          Qualidade de recepção
        </PanelTitle>
        <div className="flex items-center gap-2">
          {q.serial && (
            <a
              href={`https://sondehub.org/${encodeURIComponent(q.serial)}`}
              target="_blank" rel="noopener noreferrer"
              className="text-xs text-blue-400 hover:underline flex items-center gap-1"
            >
              ver no sondehub <ExternalLink size={11} />
            </a>
          )}
          <button
            onClick={q.refresh}
            disabled={!q.enabled || q.loading || q.listLoading}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-surface border border-border rounded-md text-xs text-gray-400 hover:text-white hover:border-border-strong transition-all disabled:opacity-40"
          >
            <RotateCw size={12} className={q.loading || q.listLoading ? 'animate-spin' : ''} /> Recalcular
          </button>
        </div>
      </div>
      <p className="text-xs text-gray-400 mb-4">
        Quanto de cada voo o seu receptor ouviu em cada ângulo de elevação, comparado com as outras
        estações que ouviram a mesma sonda. É assim que se separa problema de antena de problema de sinal.
      </p>

      {!q.enabled ? (
        <p className="text-xs text-gray-400">
          Precisa do callsign do SondeHub e da posição do receptor (<span className="mono">sondehub.callsign</span>,
          <span className="mono"> rxlat</span>/<span className="mono">rxlon</span> na configuração do firmware).
        </p>
      ) : (
        <>
          {q.flights.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-4">
              {q.flights.slice(0, CHIP_LIMIT).map(f => {
                const active = f.serial === q.serial
                return (
                  <button
                    key={f.serial}
                    onClick={() => q.setSerial(f.serial)}
                    className={`px-2.5 py-1.5 rounded border text-xs mono transition-all ${
                      active ? 'border-blue-500/60 bg-blue-500/10 text-white' : 'border-border text-gray-400 hover:text-white hover:border-border-strong'
                    }`}
                    title={`Último quadro em ${fmtLocal(f.lastReportMs)} (GMT-3)`}
                  >
                    {f.serial}
                    <span className="text-faint ml-1.5">{fmtLocal(f.lastReportMs).slice(0, 5)}</span>
                    {f.frequency != null && <span className="text-faint ml-1.5">{f.frequency} MHz</span>}
                  </button>
                )
              })}
              {q.flights.length > CHIP_LIMIT && (
                <select
                  value={q.flights.slice(CHIP_LIMIT).some(f => f.serial === q.serial) ? q.serial ?? '' : ''}
                  onChange={e => e.target.value && q.setSerial(e.target.value)}
                  className="px-2 py-1.5 rounded border border-border bg-surface text-xs mono text-gray-300"
                  title="Voos mais antigos que o seu receptor ouviu (registro do app)"
                >
                  <option value="">+{q.flights.length - CHIP_LIMIT} voos anteriores…</option>
                  {q.flights.slice(CHIP_LIMIT).map(f => (
                    <option key={f.serial} value={f.serial}>
                      {fmtLocal(f.lastReportMs)} · {f.serial}{f.frequency != null ? ` · ${f.frequency} MHz` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {q.listLoading && q.flights.length === 0 && (
            <p className="text-xs text-gray-400 flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin" /> Procurando voos recentes…
            </p>
          )}
          {q.listError && <p className="text-xs text-red-400 mb-3">{q.listError}</p>}
          {!q.listLoading && q.flights.length === 0 && !q.listError && (
            <p className="text-xs text-gray-400">
              Nenhuma sonda recente num raio de 300 km nem no registro do app com o seu callsign — a janela ao vivo do sondehub.org
              não vai além disso.
            </p>
          )}

          {q.loading && (
            <p className="text-xs text-gray-400 flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin" /> Baixando os quadros do voo (pode passar de 1 MB)…
            </p>
          )}
          {q.error && <p className="text-xs text-red-400">{q.error}</p>}
          {q.report && !q.loading && <Report report={q.report} />}
        </>
      )}
    </div>
  )
}
