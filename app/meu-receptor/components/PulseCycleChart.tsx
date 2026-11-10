'use client'

import type { PowerPlan, PowerEstimate } from '@/app/lib/powerPlan'
import { LVL_PULSE, LEVEL_LABEL } from '@/app/lib/powerPlan'
import type { PowerEstimateSettings } from '@/app/lib/settings'
import { POWER_COLORS } from '@/app/lib/powerColors'
import { parseQrgList, TYPE_NAME, type QrgChannel } from '@/app/lib/qrg'

// Segundos que o firmware gasta para religar o rádio em cada canal (sleepRadioResume).
// Mesmo valor que o app já usa na estimativa de consumo (PULSE_RESUME_S em powerPlan.ts).
const RESUME_S = 1
// A RS41 manda 1 quadro por segundo; depois de trocar de canal o rádio leva ~2 s para sincronizar.
const SYNC_S = 2

// Uma cor por canal — distinguíveis entre si e do cinza do sono leve.
const CHANNEL_COLORS = ['#34d399', '#22d3ee', '#fbbf24', '#a78bfa', '#fb7185', '#f97316']

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))
const hm = (min: number) => `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, '0')} min`

interface Props {
  plan: PowerPlan
  est: PowerEstimate
  estimate: PowerEstimateSettings
  qrgList: string | undefined       // config['qrg.list'] — canais que o rádio percorre agora
  pending: boolean                  // há alteração de power.pulse_* / nível ainda não aplicada no aparelho
}

/** Ciclo do Pulsado desenhado em escala: quanto o rádio escuta em cada frequência, quanto dorme,
 *  onde o Pulsado entra no dia e o que isso custa. */
export default function PulseCycleChart({ plan, est, estimate, qrgList, pending }: Props) {
  const parsed = parseQrgList(qrgList)
  const known = parsed.length > 0
  const channels: QrgChannel[] = known ? parsed.filter(c => c.active) : []
  const n = known ? Math.max(1, channels.length) : Math.max(1, estimate.channels)

  const every = Math.max(10, plan.pulseEverySec)
  const listen = Math.max(2, plan.pulseListenSec)
  const slot = listen + RESUME_S
  const awake = Math.min(every, n * slot)
  const sleep = Math.max(0, every - awake)
  const overflow = n * slot >= every   // escutar todos os canais ocupa o ciclo inteiro: nunca cochila
  const dutyPct = (awake / every) * 100
  const usefulFrames = Math.max(0, listen - SYNC_S)

  const inIdle = plan.lvlIdle === LVL_PULSE
  const inWait = plan.waitMin > 0 && plan.lvlWait === LVL_PULSE
  const used = inIdle || inWait
  const pulseMin = est.minutesByLevel[LVL_PULSE] ?? 0
  const dayPct = (pulseMin / 1440) * 100
  const where = [inIdle && 'resto do dia', inWait && 'espera por atraso'].filter(Boolean).join(' e ')

  // Segmentos do ciclo, em % da largura.
  const segs: { key: string; pct: number; color: string; label: string; title: string }[] = []
  for (let i = 0; i < n; i++) {
    const ch = channels[i]
    segs.push({
      key: `c${i}`,
      pct: (slot / every) * 100,
      color: CHANNEL_COLORS[i % CHANNEL_COLORS.length],
      label: ch ? ch.freq.toFixed(3) : `canal ${i + 1}`,
      title: `${ch ? `${ch.freq.toFixed(3)} MHz` : `canal ${i + 1}`}: escuta ${fmt(listen)} s (+${RESUME_S} s para religar o rádio)`,
    })
  }
  if (sleep > 0) {
    segs.push({ key: 'sleep', pct: (sleep / every) * 100, color: 'transparent', label: `sono leve ${fmt(sleep)} s`, title: `Cochila ${fmt(sleep)} s: processador e rádio em repouso` })
  }
  // Se estourar o ciclo, normaliza para caber (a barra nunca passa de 100%).
  const total = segs.reduce((a, s) => a + s.pct, 0)
  const scale = total > 100 ? 100 / total : 1

  const badge = used
    ? { text: 'Em uso', cls: 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10' }
    : { text: 'Configurado, mas não usado', cls: 'border-amber-500/40 text-amber-300 bg-amber-500/10' }

  return (
    <div className="bg-bg border border-border rounded-md p-3 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-[10px] text-faint uppercase tracking-wide">Ciclo do Pulsado</p>
        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${badge.cls}`}>{badge.text}</span>
        {used && <span className="text-[10px] text-faint">{where}</span>}
        {pending && <span className="text-[10px] px-1.5 py-0.5 rounded border border-blue-500/40 text-blue-300">alteração ainda não aplicada</span>}
      </div>

      {!used && (
        <p className="text-[11px] text-faint">
          O plano atual não usa o nível {LEVEL_LABEL[LVL_PULSE]} (resto do dia: {LEVEL_LABEL[plan.lvlIdle]}; espera: {LEVEL_LABEL[plan.lvlWait]}).
          O desenho abaixo mostra como o ciclo ficaria com os valores configurados.
        </p>
      )}

      {/* Um ciclo, em escala */}
      <div>
        <div className="flex justify-between text-[10px] text-faint mb-1 mono">
          <span>0 s</span><span>um ciclo = {fmt(every)} s</span><span>{fmt(every)} s</span>
        </div>
        <div className="flex h-9 rounded overflow-hidden border border-border" role="img"
          aria-label={`Ciclo de ${every} s: ${n} canal(is) escutando ${listen} s cada, depois ${fmt(sleep)} s de sono leve`}>
          {segs.map(s => (
            <div key={s.key} title={s.title}
              style={{ width: `${s.pct * scale}%`, background: s.color === 'transparent' ? 'repeating-linear-gradient(135deg,#1f2937 0 6px,#111827 6px 12px)' : s.color }}
              className="h-full flex items-center justify-center overflow-hidden">
              <span className={`text-[10px] mono whitespace-nowrap px-1 ${s.color === 'transparent' ? 'text-gray-400' : 'text-black/80 font-medium'}`}>{s.pct * scale > 7 ? s.label : ''}</span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 flex-wrap mt-1.5 text-[10px] text-faint">
          <span className="flex items-center gap-1"><i className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: POWER_COLORS.awake_pulse }} /> rádio escutando</span>
          <span className="flex items-center gap-1"><i className="inline-block w-2.5 h-2.5 rounded-sm bg-gray-700" /> sono leve (CPU e rádio em repouso)</span>
        </div>
      </div>

      {overflow && (
        <p className="text-[11px] text-amber-400">
          Escutar {n} frequência(s) × {fmt(slot)} s ocupa o ciclo inteiro: o Pulsado nunca cochila e gasta como o Silencioso.
          Aumente o ciclo ou diminua a escuta.
        </p>
      )}

      {/* Números */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Rádio ligado" value={`${fmt(awake)} s`} sub={`${Math.round(dutyPct)}% do ciclo`} color={POWER_COLORS.awake_pulse} />
        <Stat label="Sono leve" value={`${fmt(sleep)} s`} sub={`${Math.round(100 - dutyPct)}% do ciclo`} />
        <Stat label="Nota sonda nova em" value={`≤ ${fmt(every)} s`} sub="depois que ela começa a transmitir" />
        <Stat label="Quadros por escuta" value={`~${usefulFrames}`} sub={`${fmt(listen)} s − ${SYNC_S} s de sincronia`} />
      </div>

      {/* Canais */}
      <div>
        <p className="text-[10px] text-faint uppercase tracking-wide mb-1.5">
          Canais no ciclo {known ? <span className="normal-case">(do aparelho)</span> : <span className="normal-case text-amber-400">(lista do aparelho indisponível — usando {n} da estimativa)</span>}
        </p>
        {known ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-faint border-b border-border">
                  <th className="text-left font-normal pb-1 pr-3">frequência</th>
                  <th className="text-left font-normal pb-1 pr-3">tipo</th>
                  <th className="text-left font-normal pb-1 pr-3">origem</th>
                  <th className="text-left font-normal pb-1 pr-3">estado</th>
                  <th className="text-right font-normal pb-1">escuta por hora</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {parsed.map((c, i) => {
                  const idx = c.active ? channels.indexOf(c) : -1
                  return (
                    <tr key={`${c.freq}-${i}`} className={c.active ? 'text-gray-200' : 'text-gray-500'}>
                      <td className="py-1 pr-3 mono whitespace-nowrap">
                        {idx >= 0 && <i className="inline-block w-2 h-2 rounded-sm mr-1.5" style={{ background: CHANNEL_COLORS[idx % CHANNEL_COLORS.length] }} />}
                        {c.freq.toFixed(3)} MHz
                      </td>
                      <td className="py-1 pr-3">{TYPE_NAME[c.type] ?? c.type}</td>
                      <td className="py-1 pr-3 text-faint">{c.imported ? `importada do SondeHub (${c.label})` : c.label || 'lista fixa (qrg.txt)'}</td>
                      <td className="py-1 pr-3">{c.active ? 'ativa' : 'desligada'}</td>
                      <td className="py-1 mono text-right">{c.active ? `${Math.round((3600 / every) * listen)} s` : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-[11px] text-faint">O aparelho ainda não enviou a lista de canais (firmware dev20261110.1 ou mais novo).</p>
        )}
      </div>

      {/* No dia */}
      <div className="text-[11px] text-faint space-y-0.5">
        {used ? (
          <p>
            No dia: <span className="text-gray-200">{hm(pulseMin)}</span> em Pulsado ({dayPct.toFixed(0)}% das 24 h).
            Com sonda no ar o receptor vai para Pleno e este ciclo para.
          </p>
        ) : (
          <p>No dia: 0 min em Pulsado.</p>
        )}
        <p>
          Plano inteiro: ~{Math.round(est.mahPerDay)} mAh/dia
          {Number.isFinite(est.days) ? <> · bateria dura ~{est.days.toFixed(1)} dias sem carga</> : null}.
        </p>
      </div>
    </div>
  )
}

function Stat({ label, value, sub, color }: { label: string; value: string; sub: string; color?: string }) {
  return (
    <div className="rounded border border-border px-2 py-1.5">
      <p className="text-[10px] text-faint">{label}</p>
      <p className="text-sm mono text-white flex items-center gap-1.5">
        {color && <i className="inline-block w-2 h-2 rounded-sm" style={{ background: color }} />}{value}
      </p>
      <p className="text-[10px] text-faint">{sub}</p>
    </div>
  )
}
