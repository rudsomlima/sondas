'use client'

import type { ReactNode } from 'react'
import type { RdzConfig } from '@/app/lib/rdzConfig'

interface MultiFreqConfigEditorProps {
  config: RdzConfig
  changes: Record<string, string>
  setField: (key: string, value: string) => void
}

type Mode = 'stay' | 'time' | 'frames'

// ~1-2 s pro rádio sincronizar com a sonda depois de trocar de frequência
// (RS41 manda 1 quadro/s) — usado só nas estimativas da tela.
const SYNC_S = 1.5

// Cores das sondas A/B/C na prévia do revezamento.
const SONDE_COLORS = ['#34d399', '#60a5fa', '#f472b6']

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-bg border border-border rounded-md p-3">
      <p className="text-[10px] text-faint uppercase tracking-wide mb-2.5">{title}</p>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 text-xs min-w-0">
      <label className="text-gray-400 sm:w-52 flex-shrink-0">{label}</label>
      <div className="flex items-center gap-1.5 flex-shrink-0">{children}</div>
      {hint && <span className="text-[11px] text-faint sm:flex-1 min-w-0 break-words">{hint}</span>}
    </div>
  )
}

function NumberInput({ value, onChange, suffix, min = 0 }: { value: string; onChange: (v: string) => void; suffix?: string; min?: number }) {
  return (
    <>
      <input
        type="number" min={min} step="1" value={value}
        onChange={e => onChange(e.target.value)}
        className="w-20 bg-bg border border-border rounded-md text-white mono px-2 py-1.5 outline-none focus:border-blue-500"
      />
      {suffix && <span className="text-faint">{suffix}</span>}
    </>
  )
}

const fmtS = (s: number) => s < 10 ? `${s.toFixed(1).replace('.', ',')} s` : `${Math.round(s)} s`

/**
 * Seção "Várias frequências" da Configuração completa: o que o receptor faz
 * quando há mais de uma sonda no ar em QRGs diferentes (o SX1278 só ouve uma
 * por vez) — ficar na primeira, revezar por tempo ou por quadros — e a trava
 * de pouso. Campos rx.* do firmware (alternateHopDue/landingLockActive em
 * Sonde.cpp, docs/MULTI_QRG_GUIDE.md).
 */
export default function MultiFreqConfigEditor({ config, changes, setField }: MultiFreqConfigEditorProps) {
  const val = (key: string) => changes[key] ?? config[key] ?? ''
  const num = (key: string, fallback = 0) => {
    const n = parseInt(val(key), 10)
    return isFinite(n) ? n : fallback
  }

  const altSeconds = num('rx.alternate')
  const altFrames = num('rx.altframes')
  const altScan = num('rx.altscan', 4) || 4
  const landLock = num('rx.landlock')
  const mode: Mode = altFrames > 0 ? 'frames' : altSeconds > 0 ? 'time' : 'stay'

  const setMode = (m: Mode) => {
    if (m === 'stay') { setField('rx.alternate', '0'); setField('rx.altframes', '0') }
    if (m === 'time') { setField('rx.altframes', '0'); setField('rx.alternate', String(altSeconds > 0 ? altSeconds : 20)) }
    if (m === 'frames') { setField('rx.alternate', '0'); setField('rx.altframes', String(altFrames > 0 ? altFrames : 1)) }
  }

  // Tempo por sonda em cada volta do revezamento (quanto o rádio fica nela).
  const perSondeS = mode === 'time' ? altSeconds + SYNC_S : mode === 'frames' ? altFrames + SYNC_S : 0
  const cycleFor = (n: number) => n * perSondeS

  const MODES: { id: Mode; title: string; hint: string }[] = [
    { id: 'stay', title: 'Ficar na primeira', hint: 'Acompanha uma sonda do começo ao fim. As outras só são ouvidas depois que ela some. Melhor pro dia a dia.' },
    { id: 'time', title: 'Revezar por tempo', hint: 'Fica alguns segundos em cada sonda e passa pra próxima. Trechos contínuos de cada uma.' },
    { id: 'frames', title: 'Um pouco de cada', hint: 'Recebe poucos quadros de cada sonda e passa pra próxima. Todas atualizadas por igual.' },
  ]

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-faint">
        O rádio do receptor só ouve <b>uma frequência por vez</b>. Isto só faz diferença com duas ou mais
        frequências ativas na lista de QRGs e várias sondas no ar ao mesmo tempo (ex.: campanha).
      </p>

      <Card title="Com várias sondas no ar">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {MODES.map(m => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={`text-left p-2.5 rounded-md border transition-all ${
                mode === m.id ? 'border-blue-500/70 bg-blue-500/10' : 'border-border hover:border-border-strong'
              }`}
            >
              <span className="text-xs text-white font-medium">{m.title}</span>
              <p className="text-[11px] text-faint mt-0.5">{m.hint}</p>
            </button>
          ))}
        </div>

        {mode === 'time' && (
          <Row label="Tempo em cada sonda" hint="Mais tempo = trajetória mais contínua de cada uma, mas as outras esperam mais">
            <NumberInput value={val('rx.alternate')} onChange={v => setField('rx.alternate', v)} suffix="s" min={1} />
          </Row>
        )}
        {mode === 'frames' && (
          <Row label="Quadros de cada sonda" hint="1 = um quadro de cada e passa pra próxima. Quadro com erro não conta; com sinal ruim desiste após 6 s">
            <NumberInput value={val('rx.altframes')} onChange={v => setField('rx.altframes', v)} suffix="quadros" min={1} />
          </Row>
        )}
        {mode !== 'stay' && (
          <>
            <Row label="Frequência sem sinal" hint="Durante o revezamento, desiste de uma frequência vazia depois disso e segue">
              <NumberInput value={val('rx.altscan')} onChange={v => setField('rx.altscan', v)} suffix="s" min={1} />
            </Row>

            {/* Prévia do revezamento com 3 sondas, 60 s */}
            <div>
              <p className="text-[10px] text-faint mb-1">Prévia com 3 sondas no ar (primeiro minuto)</p>
              <div className="relative h-4 rounded overflow-hidden flex">
                {(() => {
                  const segs: { color: string; s: number; sync: boolean }[] = []
                  let t = 0, i = 0
                  while (t < 60 && perSondeS > 0) {
                    const color = SONDE_COLORS[i % 3]
                    const sync = Math.min(SYNC_S, 60 - t)
                    segs.push({ color, s: sync, sync: true })
                    t += sync
                    const hear = Math.min(perSondeS - SYNC_S, 60 - t)
                    if (hear > 0) { segs.push({ color, s: hear, sync: false }); t += hear }
                    i++
                  }
                  return segs.map((sg, k) => (
                    <div key={k} style={{ width: `${(sg.s / 60) * 100}%`, background: sg.color, opacity: sg.sync ? 0.3 : 1 }} />
                  ))
                })()}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-[10px] text-gray-300">
                {['A', 'B', 'C'].map((n, k) => (
                  <span key={n} className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: SONDE_COLORS[k] }} /> sonda {n}
                  </span>
                ))}
                <span className="text-faint">cor clara = sincronizando após trocar</span>
              </div>
              <p className="text-[11px] text-faint mt-1.5">
                Cada sonda é ouvida de novo a cada ~{fmtS(cycleFor(2))} com 2 no ar, ~{fmtS(cycleFor(3))} com 3.
                Os quadros do tempo em que o rádio está nas outras são perdidos.
              </p>
            </div>

            <p className="text-[11px] text-faint">
              Display: mostra uma sonda com dados e só troca pra outra a cada ~8 s (nunca mostra frequência vazia).
              O número do canal na tela é o da sonda mostrada, não necessariamente onde o rádio está naquele instante.
            </p>
          </>
        )}
      </Card>

      <Card title="Trava de pouso">
        <label className="flex items-center gap-2.5 cursor-pointer select-none">
          <span
            onClick={e => { e.preventDefault(); setField('rx.landlock', landLock > 0 ? '0' : '500') }}
            className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
              landLock > 0 ? 'bg-blue-600' : 'bg-bg border border-border-strong'
            }`}
          >
            <span className="inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform" style={{ transform: `translateX(${landLock > 0 ? '18px' : '2px'})` }} />
          </span>
          <span className="text-xs text-gray-200">Fixar a frequência numa sonda perto do pouso</span>
        </label>
        {landLock > 0 && (
          <>
            <Row label="Abaixo de" hint="Altura acima do receptor. Só trava com a sonda descendo — no chão antes do lançamento não conta">
              <NumberInput value={val('rx.landlock')} onChange={v => setField('rx.landlock', v)} suffix="m" min={1} />
            </Row>
            <p className="text-[11px] text-faint">
              Travado, nem o revezamento nem a falta de sinal tiram o rádio dessa sonda — perto do chão o sinal
              falha justamente no momento mais importante. Solta quando ela pousa (parada por 3 min), some
              (2 min sem sinal) ou você troca de canal pelo botão. Com duas descendo juntas, fica com a primeira.
            </p>
          </>
        )}
      </Card>
    </div>
  )
}
