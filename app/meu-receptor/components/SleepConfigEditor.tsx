'use client'

import type { ReactNode } from 'react'
import type { RdzConfig } from '@/app/lib/rdzConfig'
import { parseSleepWindows, minutesToHHMM, hhmmToMinutes, type SleepWindow } from '@/app/lib/sleepWindows'
import { nowGMT3 } from '@/app/lib/types'

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
// Prévia visual simples (2 estados) de como as janelas caem no dia de hoje
// ──────────────────────────────────────────────────────────────
function buildPreviewSegments(windows: SleepWindow[]): { startPct: number; widthPct: number; awake: boolean }[] {
  const awakeIvs: [number, number][] = []
  for (const w of windows) {
    const s = ((w.startMin % 1440) + 1440) % 1440
    const e = s + w.durMin
    if (e <= 1440) awakeIvs.push([s, e])
    else { awakeIvs.push([s, 1440]); awakeIvs.push([0, e - 1440]) }
  }
  awakeIvs.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const iv of awakeIvs) {
    const last = merged[merged.length - 1]
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1])
    else merged.push([...iv])
  }
  const segs: { startPct: number; widthPct: number; awake: boolean }[] = []
  let cursor = 0
  for (const [s, e] of merged) {
    if (s > cursor) segs.push({ startPct: (cursor / 1440) * 100, widthPct: ((s - cursor) / 1440) * 100, awake: false })
    segs.push({ startPct: (s / 1440) * 100, widthPct: ((e - s) / 1440) * 100, awake: true })
    cursor = e
  }
  if (cursor < 1440) segs.push({ startPct: (cursor / 1440) * 100, widthPct: ((1440 - cursor) / 1440) * 100, awake: false })
  return segs
}

const EXTEND_MODE_LABELS = ['WiFi economizado (ao vivo)', 'WiFi desligado', 'Checagem periódica (dorme entre checagens)']

export default function SleepConfigEditor({ config, changes, setField }: SleepConfigEditorProps) {
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

  const draft: RdzConfig = { ...config, ...changes }
  const windows = sleepOn ? parseSleepWindows(draft) : null
  const nowMin = (() => { const d = nowGMT3(); return d.getUTCHours() * 60 + d.getUTCMinutes() })()

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
            <div className="flex items-center gap-3 text-xs">
              <label className="text-gray-400 w-52 flex-shrink-0">Duração (minutos)</label>
              <input
                type="number"
                min={0}
                value={dur}
                onChange={e => setField(durKey, e.target.value)}
                className="w-24 bg-bg border border-border rounded-md text-white mono px-2 py-1.5 outline-none focus:border-blue-500"
              />
              <span className="text-faint">→ termina às {minutesToHHMM(endMin)}</span>
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
        <p className="text-[10px] text-faint uppercase tracking-wide mb-2">Prévia — hoje, conforme os campos abaixo</p>
        {!sleepOn ? (
          <p className="text-xs text-gray-300">Deep sleep desativado — o receptor fica sempre acordado.</p>
        ) : !windows ? (
          <p className="text-xs text-amber-400">Nenhuma janela ativa — o receptor vai dormir o dia inteiro. Ative a Janela 1 ou 2 abaixo.</p>
        ) : (
          <>
            <div className="relative rounded overflow-hidden" style={{ height: 18 }}>
              {buildPreviewSegments(windows).map((s, i) => (
                <div
                  key={i}
                  style={{
                    position: 'absolute', left: `${s.startPct}%`, width: `${Math.max(s.widthPct, 0.1)}%`,
                    height: '100%', background: s.awake ? '#34d399' : '#818cf8',
                  }}
                />
              ))}
              {[6, 12, 18].map(h => (
                <div key={h} style={{ position: 'absolute', left: `${(h / 24) * 100}%`, top: 0, bottom: 0, width: 1, background: 'rgba(0,0,0,0.25)' }} />
              ))}
              <div
                title="Agora"
                style={{ position: 'absolute', left: `${(nowMin / 1440) * 100}%`, top: 0, bottom: 0, width: 2, background: '#fff' }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-faint mt-1">
              <span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>24h</span>
            </div>
            <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-300">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: '#34d399' }} /> Acordado</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: '#818cf8' }} /> Dormindo</span>
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
