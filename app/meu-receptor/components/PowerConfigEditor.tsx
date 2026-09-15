'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { RdzConfig } from '@/app/lib/rdzConfig'
import {
  parsePowerPlan, planDaySegments, estimateConsumption, matchPreset, POWER_PRESETS,
  LEVEL_LABEL, LEVEL_HINT, LVL_FULL, LVL_ECO, LVL_SILENT, LVL_PULSE, LVL_DEEP,
  minutesToHHMM, hhmmToMinutes, type PlanSegment,
} from '@/app/lib/powerPlan'
import { getSettings, setSettings, DEFAULT_POWER_ESTIMATE, type PowerEstimateSettings } from '@/app/lib/settings'
import { nowGMT3 } from '@/app/lib/types'
import { POWER_COLORS } from '@/app/lib/powerColors'

interface PowerConfigEditorProps {
  config: RdzConfig
  changes: Record<string, string>
  setField: (key: string, value: string) => void
}

// Cor de cada nível — as mesmas do histórico observado (PowerTimeline).
export const LEVEL_COLOR: Record<number, string> = {
  [LVL_FULL]: POWER_COLORS.awake,
  [LVL_ECO]: POWER_COLORS.awake_wifips,
  [LVL_SILENT]: POWER_COLORS.awake_nowifi,
  [LVL_PULSE]: POWER_COLORS.awake_pulse,
  [LVL_DEEP]: POWER_COLORS.sleeping,
}

const PERIOD_LABEL: Record<PlanSegment['period'], string> = {
  window: 'Janela de lançamento',
  wait: 'Espera por atraso',
  idle: 'Resto do dia',
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-bg border border-border rounded-md p-3">
      <p className="text-[10px] text-faint uppercase tracking-wide mb-2.5">{title}</p>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer select-none">
      <span
        onClick={e => { e.preventDefault(); onChange(!checked) }}
        className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
          checked ? 'bg-blue-600' : 'bg-bg border border-border-strong'
        }`}
      >
        <span
          className="inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform"
          style={{ transform: `translateX(${checked ? '18px' : '2px'})` }}
        />
      </span>
      <span className="text-xs text-gray-200">{label}</span>
    </label>
  )
}

// stacked: rótulo, campo e dica um embaixo do outro — pra cartões estreitos
// (ex.: os dois lançamentos lado a lado), onde a linha única vazava a borda.
function Row({ label, hint, children, stacked }: { label: string; hint?: string; children: ReactNode; stacked?: boolean }) {
  if (stacked) {
    return (
      <div className="flex flex-col gap-1 text-xs min-w-0">
        <label className="text-gray-400">{label}</label>
        <div className="flex items-center gap-1.5 min-w-0">{children}</div>
        {hint && <span className="text-[11px] text-faint break-words">{hint}</span>}
      </div>
    )
  }
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 text-xs min-w-0">
      <label className="text-gray-400 sm:w-52 flex-shrink-0">{label}</label>
      <div className="flex items-center gap-1.5 min-w-0 flex-shrink-0">{children}</div>
      {hint && <span className="text-[11px] text-faint sm:flex-1 min-w-0 break-words">{hint}</span>}
    </div>
  )
}

const inputCls = 'bg-bg border border-border rounded-md text-white mono px-2 py-1.5 outline-none focus:border-blue-500'

function NumberInput({ value, onChange, step, suffix, width = 'w-24' }: {
  value: string; onChange: (v: string) => void; step?: string; suffix?: string; width?: string
}) {
  return (
    <>
      <input type="number" step={step ?? '1'} value={value} onChange={e => onChange(e.target.value)} className={`${width} ${inputCls}`} />
      {suffix && <span className="text-faint flex-shrink-0">{suffix}</span>}
    </>
  )
}

function LevelSelect({ value, options, onChange }: { value: number; options: number[]; onChange: (v: number) => void }) {
  return (
    <select value={value} onChange={e => onChange(Number(e.target.value))} className={`${inputCls} font-sans`}>
      {options.map(l => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}
    </select>
  )
}

const fmtDays = (d: number) => !isFinite(d) ? '—' : d >= 10 ? `${Math.round(d)} dias` : `${d.toFixed(1).replace('.', ',')} dias`

// Marcas "redondas" do eixo, visando ~6 na faixa visível.
const TICK_CANDIDATES_MIN = [5, 10, 15, 30, 60, 120, 180, 360, 720, 1440]
function computeAxisTicks(domainStart: number, domainEnd: number): number[] {
  const span = domainEnd - domainStart
  const step = TICK_CANDIDATES_MIN.find(c => span / c <= 6) ?? 1440
  const ticks: number[] = []
  for (let m = Math.ceil(domainStart / step) * step; m <= domainEnd + 1e-9; m += step) ticks.push(m)
  return ticks
}

const MIN_ZOOM_SPAN_MIN = 5

export default function PowerConfigEditor({ config, changes, setField }: PowerConfigEditorProps) {
  const [estimate, setEstimate] = useState<PowerEstimateSettings>(DEFAULT_POWER_ESTIMATE)
  const [calibOpen, setCalibOpen] = useState(false)
  const [zoomRange, setZoomRange] = useState<[number, number] | null>(null)
  const [dragPx, setDragPx] = useState<{ start: number; cur: number } | null>(null)
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setEstimate(getSettings().powerEstimate) }, [])

  const updateEstimate = (key: keyof PowerEstimateSettings, raw: string) => {
    let n = Number(raw)
    if (!isFinite(n) || n < 0) return
    if (key === 'channels') n = Math.max(1, Math.round(n))
    setEstimate(prev => {
      const next = { ...prev, [key]: n }
      setSettings({ ...getSettings(), powerEstimate: next })
      return next
    })
  }

  const val = (key: string): string => changes[key] ?? config[key] ?? ''
  const valInt = (key: string, fallback = 0): number => {
    const n = parseInt(val(key), 10)
    return isFinite(n) ? n : fallback
  }
  // Campos double vazios/0 chegam do firmware como "nan" (Sonde::setConfig
  // grava 0 como NAN) — pro usuário isso é "desligado".
  const valVolt = (key: string): string => {
    const v = val(key)
    return /nan/i.test(v) ? '0' : v
  }

  const plan = parsePowerPlan({ ...config, ...changes })
  if (!plan) {
    return <p className="text-xs text-amber-400">Este firmware ainda não tem os níveis de energia (campos power.*). Atualize o firmware do receptor.</p>
  }

  const segments = planDaySegments(plan)
  const est = estimateConsumption(plan, estimate)
  const preset = matchPreset(plan)
  const usesPulse = plan.lvlIdle === LVL_PULSE || (plan.waitMin > 0 && plan.lvlWait === LVL_PULSE)
  const nowMin = (() => { const d = nowGMT3(); return d.getUTCHours() * 60 + d.getUTCMinutes() })()

  const applyPreset = (lvlWait: number, lvlIdle: number) => {
    setField('power.lvl_wait', String(lvlWait))
    setField('power.lvl_idle', String(lvlIdle))
  }

  // ── Barra de prévia com zoom por arraste ──
  const domainStart = zoomRange ? zoomRange[0] : 0
  const domainEnd = zoomRange ? zoomRange[1] : 1440
  const domainLen = domainEnd - domainStart
  const toPct = (min: number) => ((min - domainStart) / domainLen) * 100
  const visibleSegs = segments
    .map(s => ({ ...s, clipStart: Math.max(s.startMin, domainStart), clipEnd: Math.min(s.endMin, domainEnd) }))
    .filter(s => s.clipEnd > s.clipStart)
  const labels = segments.filter(s => s.startMin > 0 && s.startMin >= domainStart && s.startMin <= domainEnd)
  const axisTicks = computeAxisTicks(domainStart, domainEnd)
  const usedLevels = [...new Set(segments.map(s => s.level))].sort()

  function handleMouseUp() {
    const rect = barRef.current?.getBoundingClientRect()
    if (!dragPx || !rect || rect.width === 0) { setDragPx(null); return }
    const x0 = Math.max(0, Math.min(dragPx.start, dragPx.cur))
    const x1 = Math.min(rect.width, Math.max(dragPx.start, dragPx.cur))
    setDragPx(null)
    if (x1 - x0 < 4) return
    const min0 = domainStart + (x0 / rect.width) * domainLen
    const min1 = domainStart + (x1 / rect.width) * domainLen
    if (min1 - min0 < MIN_ZOOM_SPAN_MIN) return
    setZoomRange([Math.round(min0), Math.round(min1)])
  }

  const windowCard = (n: 1 | 2) => {
    const startKey = `power.w${n}start`
    const durKey = `power.w${n}dur`
    const start = valInt(startKey)
    const dur = valInt(durKey)
    const enabled = dur > 0
    return (
      <div className="border border-border rounded-md p-2.5 space-y-2.5">
        <Toggle
          checked={enabled}
          onChange={v => setField(durKey, String(v ? 90 : 0))}
          label={`Lançamento ${n}${enabled ? '' : ' (desabilitado)'}`}
        />
        {enabled && (
          <>
            <Row stacked label="Início da janela">
              <input type="time" value={minutesToHHMM(start)} onChange={e => setField(startKey, String(hhmmToMinutes(e.target.value)))} className={inputCls} />
            </Row>
            <Row stacked label="Minutos em Pleno" hint={`Pleno até ${minutesToHHMM(start + dur)}${plan.waitMin > 0 ? ` · espera até ${minutesToHHMM(start + dur + plan.waitMin)}` : ''}`}>
              <NumberInput value={String(dur)} onChange={v => setField(durKey, v)} suffix="min" />
            </Row>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* ── Modo (presets) ── */}
      <Card title="Modo de energia">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {POWER_PRESETS.map(p => {
            const active = preset?.id === p.id
            const pEst = estimateConsumption({ ...plan, lvlWait: p.lvlWait, lvlIdle: p.lvlIdle }, estimate)
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p.lvlWait, p.lvlIdle)}
                className={`text-left p-2.5 rounded-md border transition-all ${
                  active ? 'border-blue-500/70 bg-blue-500/10' : 'border-border hover:border-border-strong'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-white font-medium">{p.label}</span>
                  <span className="text-[10px] mono text-faint whitespace-nowrap">~{fmtDays(pEst.days)}</span>
                </div>
                <p className="text-[11px] text-faint mt-0.5">{p.hint}</p>
              </button>
            )
          })}
        </div>
        {!preset && <p className="text-[11px] text-amber-400">Combinação personalizada de níveis (ajustada abaixo).</p>}
      </Card>

      {/* ── Prévia do dia + estimativa ── */}
      <div className="bg-bg border border-border rounded-md p-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <p className="text-[10px] text-faint uppercase tracking-wide">Prévia do dia (sem voo)</p>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-faint hidden sm:inline">Arraste na barra pra dar zoom</span>
            {zoomRange && (
              <button type="button" onClick={() => setZoomRange(null)} className="px-1.5 py-0.5 text-[10px] rounded border border-border text-gray-400 hover:text-white">
                Ver dia inteiro
              </button>
            )}
          </div>
        </div>
        <div className="relative" style={{ height: 24 }}>
          {labels.map((s, i) => (
            <span key={i} className="absolute text-[9px] text-faint mono whitespace-nowrap" style={{ left: `${toPct(s.startMin)}%`, top: i % 2 === 0 ? 0 : 11 }}>
              {minutesToHHMM(s.startMin)}
            </span>
          ))}
        </div>
        <div
          ref={barRef}
          className="relative rounded overflow-hidden select-none cursor-crosshair"
          style={{ height: 18 }}
          onMouseDown={e => { const r = barRef.current?.getBoundingClientRect(); if (r) setDragPx({ start: e.clientX - r.left, cur: e.clientX - r.left }) }}
          onMouseMove={e => { const r = barRef.current?.getBoundingClientRect(); if (dragPx && r) setDragPx(d => d ? { ...d, cur: e.clientX - r.left } : d) }}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => dragPx && handleMouseUp()}
        >
          {visibleSegs.map((s, i) => (
            <div
              key={i}
              title={`${PERIOD_LABEL[s.period]}: ${LEVEL_LABEL[s.level]} (${minutesToHHMM(s.startMin)}–${minutesToHHMM(s.endMin)})`}
              style={{
                position: 'absolute', left: `${toPct(s.clipStart)}%`, width: `${Math.max(toPct(s.clipEnd) - toPct(s.clipStart), 0.1)}%`,
                height: '100%', background: LEVEL_COLOR[s.level], opacity: s.period === 'wait' ? 0.7 : 1,
              }}
            />
          ))}
          {axisTicks.map(t => (
            <div key={t} style={{ position: 'absolute', left: `${toPct(t)}%`, top: 0, bottom: 0, width: 1, background: 'rgba(0,0,0,0.25)' }} />
          ))}
          {nowMin >= domainStart && nowMin <= domainEnd && (
            <div title="Agora" style={{ position: 'absolute', left: `${toPct(nowMin)}%`, top: 0, bottom: 0, width: 2, background: '#fff' }} />
          )}
          {dragPx && (
            <div style={{
              position: 'absolute', top: 0, bottom: 0, left: Math.min(dragPx.start, dragPx.cur), width: Math.abs(dragPx.cur - dragPx.start),
              background: 'rgba(255,255,255,0.25)', border: '1px solid rgba(255,255,255,0.6)',
            }} />
          )}
        </div>
        <div className="relative text-[10px] text-faint" style={{ height: 14 }}>
          {axisTicks.map((t, i) => (
            <span key={t} className="absolute mono" style={{ left: `${toPct(t)}%`, transform: i === 0 ? 'none' : i === axisTicks.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)' }}>
              {minutesToHHMM(t)}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[11px] text-gray-300">
          {usedLevels.map(l => (
            <span key={l} className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: LEVEL_COLOR[l] }} />
              {LEVEL_LABEL[l]} · {Math.round((est.minutesByLevel[l] ?? 0) / 6) / 10}h
            </span>
          ))}
          <span className="flex items-center gap-1"><span className="w-0.5 h-2.5 inline-block bg-white" /> Agora</span>
        </div>

        <div className="mt-3 pt-3 border-t border-border flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
          <span className="text-white">~<span className="mono">{Math.round(est.mahPerDay)}</span> mAh/dia</span>
          <span className="text-emerald-400">~{fmtDays(est.days)} com {estimate.capacityMah} mAh</span>
          <span className="text-faint">cada voo acompanhado: +~{Math.round(est.flightExtraMah)} mAh</span>
          <button type="button" onClick={() => setCalibOpen(o => !o)} className="text-[11px] text-blue-400 hover:underline ml-auto">
            {calibOpen ? 'Fechar calibração' : 'Calibrar consumo'}
          </button>
        </div>
        {calibOpen && (
          <div className="mt-3 space-y-2">
            <p className="text-[11px] text-faint">
              Salvo só neste navegador. Meça com o medidor USB <b>sem a bateria</b> (senão entra a corrente de carga)
              e anote o consumo com o receptor parado em cada nível. Estimativa de dia sem voo; o
              Silencioso já inclui as religadas do WiFi.
            </p>
            <Row label="Capacidade da bateria"><NumberInput value={String(estimate.capacityMah)} onChange={v => updateEstimate('capacityMah', v)} suffix="mAh" /></Row>
            <Row label="Pleno"><NumberInput value={String(estimate.fullMa)} onChange={v => updateEstimate('fullMa', v)} step="0.1" suffix="mA" /></Row>
            <Row label="Econômico"><NumberInput value={String(estimate.ecoMa)} onChange={v => updateEstimate('ecoMa', v)} step="0.1" suffix="mA" /></Row>
            <Row label="Silencioso" hint="Também é o consumo do Pulsado enquanto escuta"><NumberInput value={String(estimate.silentMa)} onChange={v => updateEstimate('silentMa', v)} step="0.1" suffix="mA" /></Row>
            <Row label="Pulsado cochilando" hint="Sono leve entre as escutas — pegue o menor valor que o medidor mostrar"><NumberInput value={String(estimate.lightSleepMa)} onChange={v => updateEstimate('lightSleepMa', v)} step="0.1" suffix="mA" /></Row>
            <Row label="Sono profundo"><NumberInput value={String(estimate.deepMa)} onChange={v => updateEstimate('deepMa', v)} step="0.1" suffix="mA" /></Row>
            <Row label="Frequências ativas" hint="Quantas QRGs o receptor varre — o Pulsado escuta cada uma por ciclo"><NumberInput value={String(estimate.channels)} onChange={v => updateEstimate('channels', v)} /></Row>
          </div>
        )}
      </div>

      {/* ── Lançamentos ── */}
      <Card title="Lançamentos (sempre em Pleno)">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {windowCard(1)}
          {windowCard(2)}
        </div>
        <Row label="Espera por atraso" hint="Depois de cada janela, continua ouvindo um lançamento atrasado">
          <NumberInput value={val('power.wait')} onChange={v => setField('power.wait', v)} suffix="min" />
        </Row>
        {plan.waitMin > 0 && (
          <Row label="Nível durante a espera" hint={LEVEL_HINT[plan.lvlWait]}>
            <LevelSelect value={plan.lvlWait} options={[LVL_FULL, LVL_ECO, LVL_SILENT, LVL_PULSE]} onChange={v => setField('power.lvl_wait', String(v))} />
          </Row>
        )}
        <Row label="Fuso horário" hint="Minutos em relação ao UTC (Brasília = -180)">
          <NumberInput value={val('power.tz')} onChange={v => setField('power.tz', v)} suffix="min" />
          <button
            type="button"
            onClick={() => setField('power.tz', String(-new Date().getTimezoneOffset()))}
            className="px-2 py-1 text-[11px] rounded border border-border text-gray-400 hover:text-white whitespace-nowrap"
          >
            Usar o deste aparelho
          </button>
        </Row>
      </Card>

      {/* ── Resto do dia ── */}
      <Card title="Resto do dia">
        <Row label="Nível" hint={LEVEL_HINT[plan.lvlIdle]}>
          <LevelSelect value={plan.lvlIdle} options={[LVL_FULL, LVL_ECO, LVL_SILENT, LVL_PULSE, LVL_DEEP]} onChange={v => setField('power.lvl_idle', String(v))} />
        </Row>
        {(usesPulse || plan.lvlIdle === LVL_SILENT || plan.lvlWait === LVL_SILENT) && (
          <Row label="Religar o WiFi a cada" hint="Silencioso/Pulsado: reporta bateria e busca config pendente. Com sonda no ar o WiFi volta na hora.">
            <NumberInput value={val('power.report_min')} onChange={v => setField('power.report_min', v)} suffix="min" />
          </Row>
        )}
        {usesPulse && (
          <>
            <Row label="Pulsado: um ciclo a cada" hint={`Nota a sonda em até ~${plan.pulseEverySec} s depois que ela começa a transmitir (o voo dura horas — o atraso não perde nada)`}>
              <NumberInput value={val('power.pulse_every')} onChange={v => setField('power.pulse_every', v)} suffix="s" />
            </Row>
            <Row label="Escutando cada frequência" hint={`Com ${estimate.channels} frequência(s) ativa(s): rádio ligado ~${Math.round(est.pulseDutyPct)}% do ciclo. A RS41 transmite 1x/s — 5 s costuma bastar`}>
              <NumberInput value={val('power.pulse_listen')} onChange={v => setField('power.pulse_listen', v)} suffix="s" />
            </Row>
            {est.pulseDutyPct >= 100 && (
              <p className="text-[11px] text-amber-400">A escuta de todas as frequências ocupa o ciclo inteiro — o Pulsado nunca cochila. Aumente o ciclo ou diminua a escuta.</p>
            )}
          </>
        )}
        {plan.lvlIdle === LVL_DEEP && (
          <>
            <Row label="Acordar antes da janela" hint="Folga fixa; o atraso do relógio interno é compensado sozinho">
              <NumberInput value={val('power.wakemargin')} onChange={v => setField('power.wakemargin', v)} suffix="min" />
            </Row>
            {plan.windows.length === 0 && (
              <p className="text-[11px] text-amber-400">Sem nenhum lançamento habilitado não há até quando dormir — o receptor fica em Econômico.</p>
            )}
          </>
        )}
      </Card>

      {/* ── Voo ── */}
      <Card title="Voo e pouso">
        <Row label="Esperar o sinal voltar" hint="Sem sinal por esse tempo, o voo é dado como encerrado. Perto do chão o sinal falha — mais tempo = menos risco de perder o pouso.">
          <NumberInput value={val('power.landing_wait')} onChange={v => setField('power.landing_wait', v)} suffix="min" />
        </Row>
      </Card>

      {/* ── Turbo ── */}
      <Card title="Turbo (Pleno sob demanda)">
        <p className="text-[11px] text-faint">
          O turbo manual fica no painel "Turbo" da página. Aqui: o automático e o limite de duração, que vale pros dois.
        </p>
        <Toggle
          checked={valInt('power.boost_auto') === 1}
          onChange={v => setField('power.boost_auto', v ? '1' : '0')}
          label="Turbo automático quando houver sonda no ar por perto"
        />
        {valInt('power.boost_auto') === 1 && (
          <Row label="Raio" hint="Distância da posição fixa do receptor (rxlat/rxlon), pelo SondeHub">
            <NumberInput value={val('power.boost_km')} onChange={v => setField('power.boost_km', v)} suffix="km" />
          </Row>
        )}
        <Row label="Duração máxima" hint="O receptor nunca aceita turbo mais longo que isso">
          <NumberInput value={val('power.boost_min')} onChange={v => setField('power.boost_min', v)} suffix="min" />
        </Row>
        {valInt('power.boost_auto') === 1 && plan.lvlIdle === LVL_DEEP && (
          <p className="text-[11px] text-amber-400">No Sono profundo o receptor não consulta o app — o turbo automático só age nas janelas e na espera.</p>
        )}
      </Card>

      {/* ── Bateria ── */}
      <Card title="Bateria">
        <p className="text-[11px] text-faint">Cada limite só age abaixo da tensão indicada. Voo em andamento nunca é abandonado (exceto a proteção da célula). 0 = desligado.</p>
        <Row label="Bateria baixa" hint="Fora de voo, desce 1 nível (ex.: Pleno → Econômico)">
          <NumberInput value={valVolt('power.vlow')} onChange={v => setField('power.vlow', v)} step="0.05" suffix="V" />
        </Row>
        <Row label="Bateria crítica" hint="Desce mais 1 nível; em voo reduz CPU, apaga o display e espaça os envios">
          <NumberInput value={valVolt('power.vcrit')} onChange={v => setField('power.vcrit', v)} step="0.05" suffix="V" />
        </Row>
        <Row label="Carregando" hint="Acima disso considera que está carregando e fica em Pleno (ex.: 4.15)">
          <NumberInput value={valVolt('power.vcharge')} onChange={v => setField('power.vcharge', v)} step="0.05" suffix="V" />
        </Row>
        <Row label="Proteção da célula" hint="Abaixo disso dorme de verdade mesmo em voo. Só pra célula sem proteção própria (ex.: 2.8)">
          <NumberInput value={valVolt('power.vpanic')} onChange={v => setField('power.vpanic', v)} step="0.05" suffix="V" />
        </Row>
      </Card>
    </div>
  )
}
