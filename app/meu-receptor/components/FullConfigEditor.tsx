'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Save, RotateCw, Loader2, CheckCircle2, XCircle, Download, Upload } from 'lucide-react'
import type { RdzConfig } from '@/app/lib/rdzConfig'
import { isSensitiveKey, parseConfigTxt, configTxtFromChanges } from '@/app/lib/rdzConfig'
import { RDZ_CONFIG_SECTIONS } from '@/app/lib/rdzConfigSections'
import PowerConfigEditor from './PowerConfigEditor'
import MultiFreqConfigEditor from './MultiFreqConfigEditor'
import OledScreenEditor from './OledScreenEditor'
import { PanelTitle } from './Collapsible'

const POWER_SECTION_LABEL = 'Energia'
const MULTIFREQ_SECTION_LABEL = 'Várias frequências'
const DISPLAY_SECTION_LABEL = 'Display (OLED/TFT)'

const POWER_KEYS = new Set(
  RDZ_CONFIG_SECTIONS.find(s => s.label === POWER_SECTION_LABEL)?.fields.map(f => f.key) ?? []
)

interface FullConfigEditorProps {
  config: RdzConfig
  loadedAt: number | null
  applying: boolean
  applyError: string | null
  applyResult: { ok: boolean; rebooting?: boolean; pending?: boolean } | null
  onApply: (changes: Record<string, string>, mode: 'live' | 'reboot') => void
  // Rascunho dos campos power.* (valor atual ou alterado), pra os gráficos da
  // página (PowerTimeline/BatteryChart) refletirem a config antes de aplicar.
  onPowerChanges?: (powerDraft: Record<string, string>) => void
}

const REDACTED = '***'

// Editor da config completa do firmware, agrupada nas mesmas seções da UI
// web do próprio rdzTTGOsonde (RX_FSK/data/cfg.js) — accordion por seção,
// só mostra campos que vieram no dump carregado (features desligadas em
// compile-time simplesmente não aparecem). `changes` é um diff local contra
// o baseline `config`; zera sozinho quando `config` muda de referência (novo
// carregamento, ou depois de aplicar com sucesso).
export default function FullConfigEditor({ config, loadedAt, applying, applyError, applyResult, onApply, onPowerChanges }: FullConfigEditorProps) {
  const [changes, setChanges] = useState<Record<string, string>>({})
  const uploadRef = useRef<HTMLInputElement>(null)

  function handleDownload() {
    const text = configTxtFromChanges(config, changes)
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'config.txt'
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const text = ev.target?.result
      if (typeof text !== 'string') return
      const uploaded = parseConfigTxt(text)
      // Computa diff: apenas campos que diferem do baseline
      const diff: Record<string, string> = {}
      for (const [k, v] of Object.entries(uploaded)) {
        if (config[k] !== v) diff[k] = v
      }
      setChanges(diff)
      if (onPowerChanges) onPowerChanges(powerDraftOf(diff))
    }
    reader.readAsText(file)
    // Limpa o valor para permitir re-upload do mesmo arquivo
    e.target.value = ''
  }

  useEffect(() => { setChanges({}) }, [config])

  function powerDraftOf(pending: Record<string, string>): Record<string, string> {
    const draft: Record<string, string> = {}
    for (const k of POWER_KEYS) {
      const v = pending[k] ?? config[k]
      if (v !== undefined) draft[k] = v
    }
    return draft
  }

  const setField = (key: string, value: string) => {
    setChanges(c => {
      const next = { ...c, [key]: value }
      if (onPowerChanges && POWER_KEYS.has(key)) onPowerChanges(powerDraftOf(next))
      return next
    })
  }

  const hasChanges = Object.keys(changes).length > 0
  const needsRebootChanged = RDZ_CONFIG_SECTIONS
    .flatMap(s => s.fields)
    .some(f => f.needsReboot && f.key in changes)

  return (
    <div className="panel p-5 mb-6">
      {/* input oculto para upload */}
      <input ref={uploadRef} type="file" accept=".txt,text/plain" className="hidden" onChange={handleUpload} />

      <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
        <PanelTitle>Configuração completa do firmware</PanelTitle>
        <div className="flex items-center gap-2 flex-wrap">
          {loadedAt && (
            <span className="text-[11px] text-faint">
              Carregado às {new Date(loadedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button
            onClick={handleDownload}
            className="flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-border text-gray-400 hover:text-white hover:border-border-strong transition-colors"
            title="Baixar config.txt (com alterações pendentes)"
          >
            <Download size={11} /> config.txt
          </button>
          <button
            onClick={() => uploadRef.current?.click()}
            className="flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-border text-gray-400 hover:text-white hover:border-border-strong transition-colors"
            title="Carregar um config.txt — as diferenças aparecem como alterações pendentes"
          >
            <Upload size={11} /> Carregar
          </button>
          {hasChanges && (
            <span className="text-[11px] text-amber-400 flex items-center gap-1">
              <AlertTriangle size={11} /> {Object.keys(changes).length} campo(s) alterado(s)
            </span>
          )}
        </div>
      </div>
      <p className="text-[11px] text-faint mb-4">
        Carregada uma vez ao abrir esta página — os valores aqui não se atualizam sozinhos
        depois disso. Campos marcados <span className="text-amber-400">reinício</span> só têm
        efeito de verdade depois que o receptor reiniciar (é uma estimativa nossa — o firmware
        não expõe essa informação por campo).
      </p>

      {RDZ_CONFIG_SECTIONS.map(section => {
        const present = section.fields.filter(f => f.key in config)
        // Firmware anterior aos níveis de energia (dev20260914.4) só manda os
        // campos sleep.* antigos — sem isto a seção sumia sem explicação.
        if (present.length === 0 && section.label === POWER_SECTION_LABEL && 'sleep.mode' in config) {
          return (
            <div key={section.label} className="mb-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
              <p className="text-xs font-medium text-amber-300 mb-1">Energia — o receptor está com firmware antigo</p>
              <p className="text-[11px] text-gray-300">
                A configuração de energia nova (níveis Pleno/Econômico/Silencioso/Pulsado/Sono profundo,
                estimativa de autonomia, turbo) só aparece depois que o receptor rodar o firmware
                <span className="mono"> dev20260914.4</span> ou mais novo e reportar a config. Grave por USB ou
                publique o <span className="mono">firmware.bin</span> novo no painel de firmware abaixo.
                Ao atualizar, os campos antigos <span className="mono">sleep.*</span> são descartados e a energia
                volta ao padrão (sempre ligado, econômico) — reconfigure aqui depois.
              </p>
            </div>
          )
        }
        if (present.length === 0) return null
        if (section.label === MULTIFREQ_SECTION_LABEL) {
          return (
            <details key={section.label} className="mb-2 group">
              <summary className="cursor-pointer select-none text-xs font-medium text-white py-2 px-1 hover:text-blue-400 transition-colors">
                {section.label}
                <span className="text-faint font-normal"> · revezamento e trava de pouso</span>
              </summary>
              <div className="pl-1 pb-2">
                <MultiFreqConfigEditor config={config} changes={changes} setField={setField} />
              </div>
            </details>
          )
        }
        if (section.label === POWER_SECTION_LABEL) {
          return (
            <details key={section.label} open className="mb-2 group">
              <summary className="cursor-pointer select-none text-xs font-medium text-white py-2 px-1 hover:text-blue-400 transition-colors">
                {section.label}
                <span className="text-faint font-normal"> · {present.length} campo(s)</span>
              </summary>
              <div className="pl-1 pb-2">
                <PowerConfigEditor config={config} changes={changes} setField={setField} />
              </div>
            </details>
          )
        }
        return (
          <details key={section.label} className="mb-2 group">
            <summary className="cursor-pointer select-none text-xs font-medium text-white py-2 px-1 hover:text-blue-400 transition-colors">
              {section.label}
              <span className="text-faint font-normal"> · {present.length} campo(s)</span>
            </summary>
            <div className="pl-1 pb-2 space-y-2">
              {present.map(fieldMeta => {
                const { key, label, kind, needsReboot } = fieldMeta
                const sensitive = isSensitiveKey(key)
                const raw = config[key] ?? ''
                const redacted = sensitive && raw === REDACTED
                const value = changes[key] ?? (redacted ? '' : raw)
                return (
                  <div key={key} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 text-xs">
                    <label className="text-gray-400 sm:w-64 flex-shrink-0" title={key}>
                      {label}
                      {needsReboot && <span className="text-amber-400"> · reinício</span>}
                    </label>
                    <input
                      type={sensitive ? 'password' : kind === 'int' || kind === 'double' ? 'number' : 'text'}
                      step={kind === 'double' ? 'any' : kind === 'int' ? '1' : undefined}
                      value={value}
                      placeholder={redacted ? '(definido, oculto — deixe em branco pra manter)' : undefined}
                      onChange={e => setField(key, e.target.value)}
                      className="flex-1 min-w-0 bg-bg border border-border rounded-md text-white mono px-2 py-1.5 outline-none focus:border-blue-500"
                    />
                  </div>
                )
              })}
              {section.label === DISPLAY_SECTION_LABEL && <OledScreenEditor />}
            </div>
          </details>
        )
      })}

      <div className="mt-4 pt-4 border-t border-border flex flex-wrap items-center gap-2">
        <button
          onClick={() => onApply(changes, 'live')}
          disabled={!hasChanges || applying}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 rounded-md text-sm text-white hover:bg-blue-700 transition-all disabled:opacity-50"
        >
          {applying ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Aplicar agora
        </button>
        <button
          onClick={() => onApply(changes, 'reboot')}
          disabled={!hasChanges || applying}
          className="flex items-center gap-2 px-4 py-2 bg-surface border border-border rounded-md text-sm text-white hover:border-border-strong transition-all disabled:opacity-50"
          title="Grava a mudança e reinicia o receptor em seguida — necessário pros campos marcados 'reinício'"
        >
          <RotateCw size={14} />
          Aplicar e reiniciar
        </button>
        {needsRebootChanged && (
          <span className="text-[11px] text-amber-400">
            Algum campo alterado costuma precisar de reinício pra valer de verdade.
          </span>
        )}
      </div>

      {applyError && (
        <p className="text-[11px] text-red-400 mt-2 flex items-center gap-1">
          <XCircle size={11} /> {applyError}
        </p>
      )}
      {applyResult?.ok && applyResult.pending && !applyError && (
        <p className="text-[11px] text-amber-400 mt-2 flex items-center gap-1">
          <Loader2 size={11} className="animate-spin" /> Enfileirado — será aplicado assim que o receptor buscar (no boot ou em até {'~'}1min se já estiver acordado).
        </p>
      )}
      {applyResult?.ok && !applyResult.pending && !applyError && (
        <p className="text-[11px] text-emerald-400 mt-2 flex items-center gap-1">
          <CheckCircle2 size={11} /> Aplicado{applyResult.rebooting ? ' — o receptor está reiniciando' : ''}.
        </p>
      )}
    </div>
  )
}
