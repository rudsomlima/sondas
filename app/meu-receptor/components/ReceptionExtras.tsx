'use client'

import { formatDistance } from '@/app/lib/geo'
import { GMT3 } from '@/app/lib/types'
import type { StationExtras } from '@/app/lib/receptionAnalysis'
import type { RankedStation, ReportHistoryPoint } from '../hooks/useReceptionQuality'

function pad(n: number) { return String(n).padStart(2, '0') }
function dayMonth(ms: number): string {
  const d = new Date(ms + GMT3)
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}`
}

function coverageColor(fraction: number): string {
  if (fraction >= 0.7) return '#10b981'
  if (fraction >= 0.35) return '#f59e0b'
  return '#ef4444'
}

/**
 * Rosa de alcance: um setor de 45° por direção. O comprimento é a maior
 * distância em que a estação ouviu a sonda naquela direção; a cor é a fração
 * dos minutos em que a sonda estava ali e a estação a ouviu. Setor sem a
 * sonda fica vazio (cinza tracejado): não houve o que ouvir.
 */
function AzimuthRose({ extras }: { extras: StationExtras }) {
  const size = 200
  const c = size / 2
  const rMax = c - 22
  const maxKm = Math.max(...extras.azimuth.map(s => s.maxDistKm), 1)
  const wedge = (centerDeg: number, r: number) => {
    const rad = (d: number) => (d - 90) * Math.PI / 180
    const a0 = rad(centerDeg - 22), a1 = rad(centerDeg + 22)
    const p = (a: number) => `${(c + r * Math.cos(a)).toFixed(1)},${(c + r * Math.sin(a)).toFixed(1)}`
    return `M${c},${c} L${p(a0)} A${r},${r} 0 0 1 ${p(a1)} Z`
  }
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[220px]" role="img"
      aria-label="Alcance da estação por direção">
      {[0.5, 1].map(f => (
        <circle key={f} cx={c} cy={c} r={rMax * f} fill="none" stroke="currentColor" className="text-border" strokeDasharray="2 3" />
      ))}
      {extras.azimuth.map(s => {
        const r = Math.max((s.maxDistKm / maxKm) * rMax, s.maxDistKm > 0 ? 4 : 0)
        const heard = s.minutesTotal > 0 ? s.minutesMine / s.minutesTotal : 0
        const lx = c + (rMax + 12) * Math.cos((s.centerDeg - 90) * Math.PI / 180)
        const ly = c + (rMax + 12) * Math.sin((s.centerDeg - 90) * Math.PI / 180)
        return (
          <g key={s.label}>
            {s.minutesTotal === 0 && <path d={wedge(s.centerDeg, rMax)} fill="none" stroke="currentColor" className="text-border" strokeDasharray="2 3" />}
            {r > 0 && (
              <path d={wedge(s.centerDeg, r)} fill={coverageColor(heard)} fillOpacity={0.75}>
                <title>{`${s.label}: ouviu até ${s.maxDistKm.toFixed(0)} km · ${s.minutesMine}/${s.minutesTotal} min`}</title>
              </path>
            )}
            <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" className="fill-gray-400" fontSize="9">{s.label}</text>
          </g>
        )
      })}
      <text x={c} y={c + rMax + 20} textAnchor="middle" className="fill-gray-500" fontSize="8">
        borda externa = {maxKm.toFixed(0)} km
      </text>
    </svg>
  )
}

/** Alcance por direção, altura em que a sonda sumiu e RSSI por distância da estação analisada. */
export function StationExtrasView({ extras, who }: { extras: StationExtras; who: string }) {
  const bins = extras.rssiByDistance
  return (
    <div className="mb-4">
      <p className="label-xs mb-2">Alcance por direção · {who}</p>
      <div className="flex flex-wrap gap-6 items-start">
        <AzimuthRose extras={extras} />
        <div className="text-xs text-gray-300 space-y-1.5 min-w-0">
          <p>Maior distância ouvida: <span className="mono text-white">{extras.maxDistKm != null ? formatDistance(extras.maxDistKm) : '—'}</span></p>
          <p>
            Último quadro ouvido:{' '}
            <span className="mono text-white">
              {extras.lastHeardAltKm != null ? `${extras.lastHeardAltKm.toFixed(1)} km de altitude` : '—'}
            </span>
            {extras.lastHeardDistKm != null && <> a <span className="mono text-white">{formatDistance(extras.lastHeardDistKm)}</span></>}
          </p>
          <p className="text-[11px] text-faint leading-relaxed max-w-xs">
            Comprimento = maior distância ouvida naquela direção. Cor: verde ouviu quase todos os minutos em que a
            sonda esteve ali, âmbar parte, vermelho pouco. Contorno tracejado = a sonda não passou por lá.
          </p>
        </div>
      </div>

      {bins.length > 0 && (
        <div className="mt-4">
          <p className="label-xs mb-2">Sinal (RSSI) por distância</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-faint border-b border-border">
                  <th className="text-left font-normal pb-1.5 pr-3">distância</th>
                  <th className="text-right font-normal pb-1.5 pr-3">quadros</th>
                  <th className="text-right font-normal pb-1.5 pr-3">RSSI med.</th>
                  <th className="text-right font-normal pb-1.5 pr-3">esperado</th>
                  <th className="text-right font-normal pb-1.5">desvio</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {bins.map(b => {
                  const dev = b.expectedRssi != null ? b.medianRssi - b.expectedRssi : null
                  return (
                    <tr key={b.loKm} className="text-gray-300">
                      <td className="py-1.5 pr-3 mono whitespace-nowrap">{b.hiKm != null ? `${b.loKm}–${b.hiKm} km` : `> ${b.loKm} km`}</td>
                      <td className="py-1.5 pr-3 mono text-right">{b.frames.toLocaleString('pt-BR')}</td>
                      <td className="py-1.5 pr-3 mono text-right">{b.medianRssi.toFixed(1)} dBm</td>
                      <td className="py-1.5 pr-3 mono text-right text-gray-500">{b.expectedRssi != null ? `${b.expectedRssi.toFixed(1)} dBm` : '—'}</td>
                      <td className={`py-1.5 mono text-right ${dev == null || Math.abs(dev) < 3 ? 'text-gray-400' : dev < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                        {dev != null ? `${dev > 0 ? '+' : ''}${dev.toFixed(1)} dB` : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-faint mt-2 leading-relaxed">
            &quot;Esperado&quot; é a queda de espaço livre (20·log10 da distância) ancorada na primeira faixa: o ganho
            absoluto da antena não é conhecido, então só o desvio entre faixas diz algo. Desvio muito negativo
            nas faixas longas = perda além do esperado (horizonte, cabo, ruído).
          </p>
        </div>
      )}
    </div>
  )
}

/** Alcance máximo e altitude do último quadro, voo a voo, dos relatórios já calculados deste callsign. */
export function RangeHistory({ history }: { history: ReportHistoryPoint[] }) {
  if (history.length < 2) return null
  const pts = history.slice(-20)
  const maxKm = Math.max(...pts.map(p => p.maxDistKm), 1)
  return (
    <div className="mb-4">
      <p className="label-xs mb-2">Alcance ao longo dos voos analisados</p>
      <div className="flex items-end gap-1 h-24" role="img" aria-label="Maior distância ouvida por voo">
        {pts.map(p => (
          <div key={p.serial} className="flex-1 min-w-0 flex flex-col items-center justify-end h-full"
            title={`${p.serial} · ${dayMonth(p.endMs)} · ${p.maxDistKm.toFixed(0)} km${p.lastHeardAltKm != null ? ` · último quadro a ${p.lastHeardAltKm.toFixed(1)} km de altitude` : ''}`}>
            <div className="w-full rounded-t bg-blue-500/70" style={{ height: `${Math.max((p.maxDistKm / maxKm) * 100, 3)}%` }} />
            <span className="text-[8px] text-faint mt-1 mono">{dayMonth(p.endMs)}</span>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-faint mt-2 leading-relaxed">
        Maior distância ouvida em cada voo (até {maxKm.toFixed(0)} km). Inclui só os voos que você abriu neste
        navegador; serve para ver se uma mudança de antena ou cabo melhorou o alcance, lembrando que cada voo
        deriva para um lado diferente.
      </p>
    </div>
  )
}

/** Estações que mais aparecem como receptoras no registro de sondas do app. */
export function StationRanking({ ranking }: { ranking: RankedStation[] }) {
  if (ranking.length === 0) return null
  return (
    <div className="mb-4">
      <p className="label-xs mb-2">Ranking das estações no registro do app</p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-faint border-b border-border">
              <th className="text-left font-normal pb-1.5 pr-3 w-8">#</th>
              <th className="text-left font-normal pb-1.5 pr-3">estação</th>
              <th className="text-right font-normal pb-1.5 pr-3">sondas ouvidas</th>
              <th className="text-right font-normal pb-1.5">quadros (mín.)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {ranking.map((r, i) => (
              <tr key={r.callsign} className={r.mine ? 'text-white' : 'text-gray-400'}>
                <td className="py-1.5 pr-3 mono">{i + 1}</td>
                <td className="py-1.5 pr-3 mono whitespace-nowrap">
                  {r.callsign}{r.mine && <span className="ml-1.5 badge badge-info text-[9px] px-1.5 py-0">você</span>}
                </td>
                <td className="py-1.5 pr-3 mono text-right">{r.flights.toLocaleString('pt-BR')}</td>
                <td className="py-1.5 mono text-right">{r.frames.toLocaleString('pt-BR')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-faint mt-2 leading-relaxed">
        Conta em quantas sondas do registro (este ano e o anterior) a estação aparece como receptora. Como o
        SondeHub guarda cada quadro uma vez só, &quot;quadros&quot; é um mínimo e o ranking favorece quem sobe mais rápido.
      </p>
    </div>
  )
}
