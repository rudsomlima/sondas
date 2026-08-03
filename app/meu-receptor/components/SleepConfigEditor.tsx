'use client'

import { useRef, useState, type ReactNode } from 'react'
import type { RdzConfig } from '@/app/lib/rdzConfig'
import { parseSleepWindows, minutesToHHMM, hhmmToMinutes } from '@/app/lib/sleepWindows'
import { nowGMT3 } from '@/app/lib/types'
import { POWER_COLORS } from '@/app/lib/powerColors'

interface SleepConfigEditorProps {
  config: RdzConfig
  changes: Record<string, string>
  setField: (key: string, value: string) => void
}

// ──────────────────────────────────────────────────────────────
// Toggle liga/desliga (substitui digitar "0"/"1" nos campos booleanos)
// ──────────────────────────────────────────────────────────────
function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex items-start gap-2.5 cursor-pointer select-none">
      <span
        onClick={e => { e.preventDefault(); onChange(!checked) }}
        className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full mt-0.5 transition-colors ${
          checked ? 'bg-blue-600' : 'bg-bg border border-border-strong'
        }`}
      >
        <span
          className="inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform"
          style={{ transform: `translateX(${checked ? '18px' : '2px'})` }}
        />
      </span>
      <span>
        <span className="text-xs text-gray-200">{label}</span>
        {hint && <span className="block text-[11px] text-faint mt-0.5">{hint}</span>}
      </span>
    </label>
  )
}

// ──────────────────────────────────────────────────────────────
// Card container padrão pra agrupar campos relacionados
// ──────────────────────────────────────────────────────────────
function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-bg border border-border rounded-md p-3">
      <p className="text-[10px] text-faint uppercase tracking-wide mb-2.5">{title}</p>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

function NumberField({ label, hint, value, onChange, step, suffix }: {
  label: string; hint?: string; value: string; onChange: (v: string) => void; step?: string; suffix?: string
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 text-xs">
      <label className="text-gray-400 sm:w-52 flex-shrink-0">{label}</label>
      <div className="flex items-center gap-1.5 flex-1 min-w-0 max-w-[160px]">
        <input
          type="number"
          step={step ?? '1'}
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full bg-bg border border-border rounded-md text-white mono px-2 py-1.5 outline-none focus:border-blue-500"
        />
        {suffix && <span className="text-faint flex-shrink-0">{suffix}</span>}
      </div>
      {hint && <span className="text-[11px] text-faint sm:flex-1">{hint}</span>}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Prévia visual de como cada janela se comporta no dia de hoje — inclui a
// folga de "acordar antes" (wakemargin, desloca o início pra trás), a
// escuta extra depois do fim (extend) e a possível extensão por sinal
// (holdoff: só acontece se ainda estiver captando algo perto do fim, por
// isso entra com opacidade reduzida em vez de uma cor sólida).
// ──────────────────────────────────────────────────────────────
type PreviewKind = 'awake' | 'extend' | 'holdoff'
interface PreviewSeg { startMin: number; endMin: number; kind: PreviewKind }

function windowPreviewSegs(start: number, dur: number, extendMin: number, wakemargin: number, holdoff: number): PreviewSeg[] {
  if (dur <= 0) return []
  const awakeStart = start - Math.max(0, wakemargin)
  const awakeEnd = start + dur
  const segs: PreviewSeg[] = [{ startMin: awakeStart, endMin: awakeEnd, kind: 'awake' }]
  let cursor = awakeEnd
  if (extendMin > 0) {
    segs.push({ startMin: cursor, endMin: cursor + extendMin, kind: 'extend' })
    cursor += extendMin
  }
  if (holdoff > 0) {
    segs.push({ startMin: cursor, endMin: cursor + holdoff, kind: 'holdoff' })
  }
  return segs
}

// Recorta um intervalo [s,e) em 1 ou 2 pedaços dentro de 0–1440 (dia local),
// partindo em dois quando cruza a meia-noite.
function splitDay(s: number, e: number): [number, number][] {
  const ns = ((s % 1440) + 1440) % 1440
  const ne = ns + (e - s)
  if (ne <= 1440) return [[ns, ne]]
  return [[ns, 1440], [0, ne - 1440]]
}

// Segmentos em minutos crus (0–1440) — a conversão pra % de tela fica pro
// componente, que decide o domínio visível (dia inteiro ou uma faixa
// selecionada por arraste, ver zoomRange no componente).
interface BuiltSeg { startMin: number; endMin: number; kind: PreviewKind | 'sleeping' }

function buildPreviewSegments(rawSegs: PreviewSeg[]): BuiltSeg[] {
  const pieces: { start: number; end: number; kind: PreviewKind }[] = []
  for (const seg of rawSegs) {
    for (const [s, e] of splitDay(seg.startMin, seg.endMin)) {
      if (e > s) pieces.push({ start: s, end: e, kind: seg.kind })
    }
  }
  pieces.sort((a, b) => a.start - b.start)

  const out: BuiltSeg[] = []
  let cursor = 0
  for (const p of pieces) {
    if (p.start > cursor) out.push({ startMin: cursor, endMin: p.start, kind: 'sleeping' })
    out.push({ startMin: p.start, endMin: p.end, kind: p.kind })
    cursor = Math.max(cursor, p.end)
  }
  if (cursor < 1440) out.push({ startMin: cursor, endMin: 1440, kind: 'sleeping' })
  return out
}

// Escolhe um intervalo "redondo" (minutos) pras marcas do eixo, visando ~6
// marcas na faixa visível — mesma técnica do PowerTimeline.tsx (computeTicks).
const TICK_CANDIDATES_MIN = [1, 2, 5, 10, 15, 30, 60, 120, 180, 360, 720, 1440]
function computeAxisTicks(domainStart: number, domainEnd: number): { min: number; label: string }[] {
  const span = domainEnd - domainStart
  let step = TICK_CANDIDATES_MIN[TICK_CANDIDATES_MIN.length - 1]
  for (const c of TICK_CANDIDATES_MIN) {
    if (span / c <= 6) { step = c; break }
  }
  const first = Math.ceil(domainStart / step) * step
  const ticks: { min: number; label: string }[] = []
  for (let m = first; m <= domainEnd + 1e-9; m += step) {
    ticks.push({ min: m, label: minutesToHHMM(wrapMinutes(Math.round(m))) })
  }
  return ticks
}

// Normaliza minutos pra dentro de um dia (0–1439) — usado pra formatar
// horários que passaram da meia-noite ou vieram negativos (folga de acordar).
function wrapMinutes(m: number): number {
  return ((m % 1440) + 1440) % 1440
}

const PREVIEW_COLOR: Record<PreviewKind | 'sleeping', string> = {
  awake:   POWER_COLORS.awake,
  extend:  POWER_COLORS.listening,
  holdoff: POWER_COLORS.listening,
  sleeping: POWER_COLORS.sleeping,
}
const PREVIEW_OPACITY: Record<PreviewKind | 'sleeping', number> = {
  awake: 1, extend: 1, holdoff: 0.45, sleeping: 1,
}

const EXTEND_MODE_LABELS = ['WiFi economizado (ao vivo)', 'WiFi desligado', 'Checagem periódica (dorme entre checagens)']

const MIN_ZOOM_SPAN_MIN = 5 // menor faixa selecionável por arraste

export default function SleepConfigEditor({ config, changes, setField }: SleepConfigEditorProps) {
  // Zoom por seleção de área: arrasta sobre a barra pra restringir o
  // domínio visível a [zoomRange[0], zoomRange[1]] minutos; null = dia
  // inteiro (0–1440). dragPx guarda a posição em pixels durante o arraste,
  // só pra desenhar o retângulo de seleção (a conversão pra minutos só
  // acontece ao soltar o botão, com base na largura real do contêiner).
  const [zoomRange, setZoomRange] = useState<[number, number] | null>(null)
  const [dragPx, setDragPx] = useState<{ start: number; cur: number } | null>(null)
  const barRef = useRef<HTMLDivElement>(null)

  const val = (key: string): string => changes[key] ?? config[key] ?? ''
  const valInt = (key: string, fallback = 0): number => {
    const n = parseInt(val(key), 10)
    return isFinite(n) ? n : fallback
  }

  const sleepOn = valInt('sleep.mode', 0) === 1
  const w1start = valInt('sleep.w1start', 0)
  const w1dur   = valInt('sleep.w1dur', 0)
  const w2start = valInt('sleep.w2start', 0)
  const w2dur   = valInt('sleep.w2dur', 0)
  const extendMin  = valInt('sleep.extend', 0)
  const extendOn   = extendMin > 0
  const extendMode = valInt('sleep.extendmode', 0)
  const cpu80on   = valInt('sleep.cpu80', 0) === 1
  const wifipsOn  = valInt('sleep.wifips', 0) === 1
  const wakemargin = valInt('sleep.wakemargin', 0)
  const holdoff    = valInt('sleep.holdoff', 0)

  // Pra cada janela ativa, até que horas o receptor fica de pé no total
  // (janela + escuta extra) — sem contar o holdoff, que só acontece *se*
  // captar sinal perto do fim (não é "tempo garantido ligado").
  const activeWindows = [
    w1dur > 0 ? { n: 1 as const, start: w1start, dur: w1dur } : null,
    w2dur > 0 ? { n: 2 as const, start: w2start, dur: w2dur } : null,
  ].filter((w): w is { n: 1 | 2; start: number; dur: number } => w !== null)
  const extendUntilHint = activeWindows.length
    ? activeWindows
        .map(w => `Janela ${w.n}: fica ligado até ${minutesToHHMM(wrapMinutes(w.start + w.dur + extendMin))}`)
        .join(' · ')
    : undefined

  const draft: RdzConfig = { ...config, ...changes }
  const windows = sleepOn ? parseSleepWindows(draft) : null
  const previewSegs = windows
    ? buildPreviewSegments([
        ...windowPreviewSegs(w1start, w1dur, extendMin, wakemargin, holdoff),
        ...windowPreviewSegs(w2start, w2dur, extendMin, wakemargin, holdoff),
      ])
    : []
  const nowMin = (() => { const d = nowGMT3(); return d.getUTCHours() * 60 + d.getUTCMinutes() })()

  // Domínio visível da barra: dia inteiro, ou a faixa selecionada por
  // arraste (zoomRange). toPct converte um minuto absoluto pra posição (%)
  // dentro da faixa visível atual.
  const domainStart = zoomRange ? zoomRange[0] : 0
  const domainEnd = zoomRange ? zoomRange[1] : 1440
  const domainLen = domainEnd - domainStart
  const toPct = (min: number) => ((min - domainStart) / domainLen) * 100

  // Só a parte de cada segmento que cai dentro do domínio visível (recorta
  // nas bordas ao dar zoom numa faixa parcial).
  const visibleSegs = previewSegs
    .map(s => ({ ...s, clipStart: Math.max(s.startMin, domainStart), clipEnd: Math.min(s.endMin, domainEnd) }))
    .filter(s => s.clipEnd > s.clipStart)

  // Rótulo de horário só quando o INÍCIO real do evento está visível (não
  // quando é só a continuação de um segmento cortado na borda do zoom).
  const visibleLabels = previewSegs.filter(s => s.startMin >= domainStart && s.startMin <= domainEnd)
  const axisTicks = computeAxisTicks(domainStart, domainEnd)
  const showNow = nowMin >= domainStart && nowMin <= domainEnd

  function handleBarMouseDown(e: React.MouseEvent) {
    const rect = barRef.current?.getBoundingClientRect()
    if (!rect) return
    setDragPx({ start: e.clientX - rect.left, cur: e.clientX - rect.left })
  }
  function handleBarMouseMove(e: React.MouseEvent) {
    if (!dragPx) return
    const rect = barRef.current?.getBoundingClientRect()
    if (!rect) return
    setDragPx(d => (d ? { ...d, cur: e.clientX - rect.left } : d))
  }
  function handleBarMouseUp() {
    const rect = barRef.current?.getBoundingClientRect()
    if (!dragPx || !rect || rect.width === 0) { setDragPx(null); return }
    const x0 = Math.max(0, Math.min(dragPx.start, dragPx.cur))
    const x1 = Math.min(rect.width, Math.max(dragPx.start, dragPx.cur))
    setDragPx(null)
    if (x1 - x0 < 4) return // clique simples, sem arraste de verdade
    const min0 = domainStart + (x0 / rect.width) * domainLen
    const min1 = domainStart + (x1 / rect.width) * domainLen
    if (min1 - min0 < MIN_ZOOM_SPAN_MIN) return
    setZoomRange([Math.round(min0), Math.round(min1)])
  }

  const windowCard = (n: 1 | 2, start: number, dur: number) => {
    const startKey = `sleep.w${n}start`
    const durKey = `sleep.w${n}dur`
    const enabled = dur > 0
    const endMin = start + dur
    return (
      <Card title={`Janela de recepção ${n}`}>
        <Toggle
          checked={enabled}
          onChange={v => setField(durKey, String(v ? (dur > 0 ? dur : 120) : 0))}
          label={enabled ? 'Ativa' : 'Desabilitada'}
        />
        {enabled && (
          <>
            <div className="flex items-center gap-3 text-xs">
              <label className="text-gray-400 w-52 flex-shrink-0">Início</label>
              <input
                type="time"
                value={minutesToHHMM(start)}
                onChange={e => setField(startKey, String(hhmmToMinutes(e.target.value)))}
                className="bg-bg border border-border rounded-md text-white mono px-2 py-1.5 outline-none focus:border-blue-500"
              />
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <label className="text-gray-400 w-52 flex-shrink-0">Duração (minutos)</label>
              <input
                type="number"
                min={0}
                value={dur}
                onChange={e => setField(durKey, e.target.value)}
                className="w-24 bg-bg border border-border rounded-md text-white mono px-2 py-1.5 outline-none focus:border-blue-500"
              />
              <span className="text-faint whitespace-nowrap">→ termina às {minutesToHHMM(endMin)}</span>
            </div>
          </>
        )}
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      {/* Prévia visual do dia de hoje */}
      <div className="bg-bg border border-border rounded-md p-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <p className="text-[10px] text-faint uppercase tracking-wide">Prévia — hoje, conforme os campos abaixo</p>
          {sleepOn && windows && (
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-[10px] text-faint hidden sm:inline">Arraste na barra pra dar zoom</span>
              {zoomRange && (
                <button
                  type="button"
                  onClick={() => setZoomRange(null)}
                  className="px-1.5 py-0.5 text-[10px] rounded border border-border text-gray-400 hover:text-white hover:border-border-strong"
                >
                  Ver dia inteiro
                </button>
              )}
            </div>
          )}
        </div>
        {!sleepOn ? (
          <p className="text-xs text-gray-300">Deep sleep desativado — o receptor fica sempre acordado.</p>
        ) : !windows ? (
          <p className="text-xs text-amber-400">Nenhuma janela ativa — o receptor vai dormir o dia inteiro. Ative a Janela 1 ou 2 abaixo.</p>
        ) : (
          <>
            {/* Rótulos de horário de cada evento ficam ACIMA da barra, em duas
                fileiras alternadas (eventos consecutivos raramente caem na
                mesma fileira) — evita sobrepor tanto o gráfico quanto uns aos
                outros quando dois eventos estão próximos (ex.: folga de
                acordar bem pequena). Pra casos ainda mais apertados, arraste
                sobre a barra pra selecionar e ampliar só aquele trecho. */}
            <div className="relative" style={{ height: 24 }}>
              {visibleLabels.map((s, i) => (
                <span
                  key={i}
                  className="absolute text-[9px] text-faint mono whitespace-nowrap"
                  style={{ left: `${toPct(s.startMin)}%`, top: i % 2 === 0 ? 0 : 11 }}
                >
                  {minutesToHHMM(wrapMinutes(s.startMin))}
                </span>
              ))}
            </div>
            <div
              ref={barRef}
              className="relative rounded overflow-hidden select-none cursor-crosshair"
              style={{ height: 18 }}
              onMouseDown={handleBarMouseDown}
              onMouseMove={handleBarMouseMove}
              onMouseUp={handleBarMouseUp}
              onMouseLeave={() => dragPx && handleBarMouseUp()}
            >
              {visibleSegs.map((s, i) => (
                <div
                  key={i}
                  style={{
                    position: 'absolute', left: `${toPct(s.clipStart)}%`, width: `${Math.max(toPct(s.clipEnd) - toPct(s.clipStart), 0.1)}%`,
                    height: '100%', background: PREVIEW_COLOR[s.kind], opacity: PREVIEW_OPACITY[s.kind],
                  }}
                />
              ))}
              {axisTicks.map((t, i) => (
                <div key={i} style={{ position: 'absolute', left: `${toPct(t.min)}%`, top: 0, bottom: 0, width: 1, background: 'rgba(0,0,0,0.25)' }} />
              ))}
              {showNow && (
                <div
                  title="Agora"
                  style={{ position: 'absolute', left: `${toPct(nowMin)}%`, top: 0, bottom: 0, width: 2, background: '#fff' }}
                />
              )}
              {dragPx && (
                <div
                  style={{
                    position: 'absolute', top: 0, bottom: 0,
                    left: Math.min(dragPx.start, dragPx.cur), width: Math.abs(dragPx.cur - dragPx.start),
                    background: 'rgba(255,255,255,0.25)', border: '1px solid rgba(255,255,255,0.6)',
                  }}
                />
              )}
            </div>
            <div className="relative text-[10px] text-faint" style={{ height: 14 }}>
              {axisTicks.map((t, i) => (
                <span key={i} className="absolute mono" style={{ left: `${toPct(t.min)}%`, transform: i === 0 ? 'none' : i === axisTicks.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)' }}>
                  {t.label}
                </span>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[11px] text-gray-300">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: PREVIEW_COLOR.awake }} /> Acordado (com folga)</span>
              {extendOn && (
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: PREVIEW_COLOR.extend }} /> Escuta extra</span>
              )}
              {holdoff > 0 && (
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: PREVIEW_COLOR.holdoff, opacity: PREVIEW_OPACITY.holdoff }} /> Possível extensão (se houver sinal)</span>
              )}
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: PREVIEW_COLOR.sleeping }} /> Dormindo</span>
              <span className="flex items-center gap-1"><span className="w-0.5 h-2.5 inline-block bg-white" /> Agora</span>
            </div>
          </>
        )}
      </div>

      <Card title="Liga/desliga">
        <Toggle
          checked={sleepOn}
          onChange={v => setField('sleep.mode', v ? '1' : '0')}
          label="Deep sleep ativo"
          hint="Quando ligado, o receptor dorme fora das janelas de recepção abaixo pra economizar bateria."
        />
        <NumberField
          label="Fuso horário (minutos)"
          hint="Natal/BRT = -180"
          value={val('sleep.gmtoff')}
          onChange={v => setField('sleep.gmtoff', v)}
        />
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {windowCard(1, w1start, w1dur)}
        {windowCard(2, w2start, w2dur)}
      </div>

      <Card title="Escuta extra (após o fim da janela)">
        <Toggle
          checked={extendOn}
          onChange={v => setField('sleep.extend', String(v ? (extendMin > 0 ? extendMin : 30) : 0))}
          label={extendOn ? 'Ativa' : 'Desabilitada'}
          hint="Continua ouvindo um pouco além do fim da janela — útil pra pegar um lançamento atrasado sem estender a janela toda."
        />
        {extendOn && (
          <>
            <NumberField
              label="Duração extra (minutos)"
              value={String(extendMin)}
              onChange={v => setField('sleep.extend', v)}
              hint={extendUntilHint}
            />
            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 text-xs">
              <label className="text-gray-400 sm:w-52 flex-shrink-0">Modo</label>
              <select
                value={extendMode}
                onChange={e => setField('sleep.extendmode', e.target.value)}
                className="bg-bg border border-border rounded-md text-white px-2 py-1.5 outline-none focus:border-blue-500 max-w-xs"
              >
                {EXTEND_MODE_LABELS.map((l, i) => <option key={i} value={i}>{l}</option>)}
              </select>
            </div>
            {extendMode === 2 && (
              <>
                <NumberField
                  label="Dormindo por ciclo (minutos)"
                  hint="Quanto tempo dorme entre cada checagem"
                  value={val('sleep.extendsleep')}
                  onChange={v => setField('sleep.extendsleep', v)}
                />
                <NumberField
                  label="Acordado por ciclo (minutos)"
                  hint="Quanto tempo escuta em cada checagem"
                  value={val('sleep.extendsniff')}
                  onChange={v => setField('sleep.extendsniff', v)}
                />
              </>
            )}
          </>
        )}
      </Card>

      <Card title="Margens de acordar / dormir">
        <NumberField
          label="Espera sem sinal (minutos)"
          hint="Depois de decodificar uma sonda, espera esse tempo sem sinal antes de dormir"
          value={val('sleep.holdoff')}
          onChange={v => setField('sleep.holdoff', v)}
        />
        <NumberField
          label="Folga pra acordar (minutos)"
          hint="Acorda esse tanto antes do início da janela, de folga"
          value={val('sleep.wakemargin')}
          onChange={v => setField('sleep.wakemargin', v)}
        />
        <NumberField
          label="Desconto por deriva do relógio (%)"
          hint="Reduz o tempo de sono nessa porcentagem pra compensar o relógio interno atrasar/adiantar"
          value={val('sleep.driftpct')}
          onChange={v => setField('sleep.driftpct', v)}
        />
      </Card>

      <Card title="Economia de energia">
        <Toggle
          checked={cpu80on}
          onChange={v => setField('sleep.cpu80', v ? '1' : '0')}
          label="CPU a 80MHz"
          hint="Economiza ~20-30mA rodando o processador mais devagar"
        />
        <Toggle
          checked={wifipsOn}
          onChange={v => setField('sleep.wifips', v ? '1' : '0')}
          label="WiFi em modo economia"
          hint="Grande economia de energia, com um pouco mais de latência nas mensagens"
        />
        <div className="pt-1 border-t border-border space-y-3">
          <p className="text-[11px] text-faint">Limiares de bateria, do menos ao mais severo — cada um só entra em ação se a tensão cair abaixo dele:</p>
          <NumberField
            label="Bateria baixa (V)"
            hint="Reduz janela/espera pela metade"
            step="0.1" suffix="V"
            value={val('sleep.vlow')}
            onChange={v => setField('sleep.vlow', v)}
          />
          <NumberField
            label="Bateria crítica (V)"
            hint="Modo economia agressivo — nunca dorme só por isso, mesmo em voo"
            step="0.1" suffix="V"
            value={val('sleep.vcrit')}
            onChange={v => setField('sleep.vcrit', v)}
          />
          <NumberField
            label="Proteção da célula (V)"
            hint="0 = desligado. Abaixo disso força dormir de verdade, mesmo em voo — só ative se souber o que está fazendo"
            step="0.1" suffix="V"
            value={val('sleep.vpanic')}
            onChange={v => setField('sleep.vpanic', v)}
          />
          <NumberField
            label="Multiplicador de upload em economia"
            hint="Ex.: 5 = manda dados 5x mais raro durante o modo de bateria crítica"
            value={val('sleep.crituploadmult')}
            onChange={v => setField('sleep.crituploadmult', v)}
          />
        </div>
      </Card>
    </div>
  )
}
