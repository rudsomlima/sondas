'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, Upload, CloudDownload, CloudUpload, Loader2, CheckCircle2, XCircle, Trash2, Undo2, Redo2 } from 'lucide-react'
import { parseScreensFile, type OledEntry } from '@/app/lib/oledScreenParser'
import { replaceLayoutEntries } from '@/app/lib/oledScreenSerializer'
import { SCREENS1_TXT } from '@/app/lib/oledTemplates'
import { drawOledEntry, OLED_COLS, OLED_ROWS, CELL_PX } from '@/app/lib/oledRenderer'
import { useScreensConfig } from '../hooks/useScreensConfig'

const SCALE = 4
const WIDTH = OLED_COLS * CELL_PX
const HEIGHT = OLED_ROWS * CELL_PX

interface PaletteItem {
  code: string
  label: string
  extra: string
}

const PALETTE: PaletteItem[] = [
  { code: 'x', label: 'Texto livre', extra: 'Texto' },
  { code: 'f', label: 'Frequência', extra: ' MHz' },
  { code: 'l', label: 'Latitude', extra: '' },
  { code: 'o', label: 'Longitude', extra: '' },
  { code: 'a', label: 'Altitude', extra: '' },
  { code: 'h', label: 'Vel. horizontal', extra: 'm' },
  { code: 'v', label: 'Vel. vertical', extra: '' },
  { code: 'i', label: 'ID da sonde', extra: '' },
  { code: 't', label: 'Tipo da sonde', extra: '' },
  { code: 'r', label: 'RSSI', extra: '' },
  { code: 'q', label: 'Barra de qualidade', extra: '' },
  { code: 'b', label: 'Bateria', extra: 'V' },
  { code: 'm', label: 'Telemetria meteo', extra: 't°C' },
  { code: 'g', label: 'GPS relativo', extra: 'D' },
  { code: 'n', label: 'Endereço IP', extra: '' },
  { code: 's', label: 'Site de lançamento', extra: '' },
]

const CODE_LABEL: Record<string, string> = Object.fromEntries(PALETTE.map(p => [p.code, p.label]))

const HISTORY_LIMIT = 10

// Editor visual (arrastar-e-soltar) de uma tela de screens1.txt por vez —
// permite adicionar/mover/remover itens no grid 16x8 e sincronizar o arquivo
// completo com o receptor via useScreensConfig (fila em R2, ver plano).
export default function OledScreenEditor() {
  const screensHook = useScreensConfig()
  const [fullText, setFullText] = useState(SCREENS1_TXT)
  const [zoom, setZoom] = useState<3 | 5>(3)
  const [layoutIdx, setLayoutIdx] = useState(0)
  const [entries, setEntries] = useState<OledEntry[]>([])
  const [history, setHistory] = useState<OledEntry[][]>([])
  const [future, setFuture] = useState<OledEntry[][]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [dragOverCell, setDragOverCell] = useState<number | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const uploadRef = useRef<HTMLInputElement>(null)

  const layouts = useMemo(() => parseScreensFile(fullText), [fullText])
  const layout = layouts[layoutIdx]

  // Sincroniza com o snapshot real do receptor assim que ele chega
  useEffect(() => {
    if (screensHook.text !== null) setFullText(screensHook.text)
  }, [screensHook.text])

  // Reseta os itens em edição (e o histórico de desfazer/refazer) sempre que
  // troca de tela ou carrega texto novo
  useEffect(() => {
    setEntries(layout ? [...layout.entries] : [])
    setSelected(null)
    setHistory([])
    setFuture([])
  }, [layoutIdx, fullText]) // eslint-disable-line react-hooks/exhaustive-deps

  // Aplica uma nova lista de itens registrando o estado anterior no
  // histórico de desfazer (até 10 passos) e limpando o de refazer.
  function mutateEntries(next: OledEntry[]) {
    setHistory(h => [...h, entries].slice(-HISTORY_LIMIT))
    setFuture([])
    setEntries(next)
  }

  function undo() {
    if (history.length === 0) return
    const prev = history[history.length - 1]
    setFuture(f => [...f, entries].slice(-HISTORY_LIMIT))
    setHistory(h => h.slice(0, -1))
    setEntries(prev)
    setSelected(null)
  }

  function redo() {
    if (future.length === 0) return
    const next = future[future.length - 1]
    setHistory(h => [...h, entries].slice(-HISTORY_LIMIT))
    setFuture(f => f.slice(0, -1))
    setEntries(next)
    setSelected(null)
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingEnabled = false
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0)
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, WIDTH, HEIGHT)
    for (const entry of entries) drawOledEntry(ctx, entry)
  }, [entries])

  function buildFullText(): string {
    if (!layout) return fullText
    return replaceLayoutEntries(fullText, layout.label, entries, layout.directives)
  }

  function handleDropCell(e: React.DragEvent, line: number, col: number) {
    e.preventDefault()
    setDragOverCell(null)
    let data: { source: 'palette' | 'existing'; code?: string; extra?: string; index?: number }
    try { data = JSON.parse(e.dataTransfer.getData('application/json')) } catch { return }
    if (data.source === 'palette' && data.code !== undefined) {
      mutateEntries([...entries, { line, col, large: false, code: data.code, extra: data.extra ?? '' }])
    } else if (data.source === 'existing' && data.index !== undefined) {
      mutateEntries(entries.map((en, i) => (i === data.index ? { ...en, line, col } : en)))
    }
  }

  function updateSelected(patch: Partial<OledEntry>) {
    if (selected === null) return
    mutateEntries(entries.map((en, i) => (i === selected ? { ...en, ...patch } : en)))
  }

  function removeSelected() {
    if (selected === null) return
    mutateEntries(entries.filter((_, i) => i !== selected))
    setSelected(null)
  }

  function handleDownload() {
    const blob = new Blob([buildFullText()], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'screens1.txt'
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const text = ev.target?.result
      if (typeof text === 'string') { setFullText(text); setLayoutIdx(0) }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const cellSize = CELL_PX * zoom
  const selectedEntry = selected !== null ? entries[selected] : null

  return (
    <div className="mt-3 bg-bg border border-border rounded-md p-3">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <p className="text-[10px] text-faint uppercase tracking-wide">Editor visual de telas</p>
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" onClick={handleDownload} className="flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-border text-gray-400 hover:text-white hover:border-border-strong">
            <Download size={11} /> screens1.txt
          </button>
          <button type="button" onClick={() => uploadRef.current?.click()} className="flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-border text-gray-400 hover:text-white hover:border-border-strong">
            <Upload size={11} /> Carregar
          </button>
          <input ref={uploadRef} type="file" accept=".txt,text/plain" className="hidden" onChange={handleUpload} />
          <button type="button" onClick={() => screensHook.load()} disabled={screensHook.loading} className="flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-border text-gray-400 hover:text-white hover:border-border-strong disabled:opacity-50">
            {screensHook.loading ? <Loader2 size={11} className="animate-spin" /> : <CloudDownload size={11} />} Carregar do receptor
          </button>
          <button type="button" onClick={() => screensHook.apply(buildFullText())} disabled={screensHook.applying} className="flex items-center gap-1 px-2 py-1 text-[11px] rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
            {screensHook.applying ? <Loader2 size={11} className="animate-spin" /> : <CloudUpload size={11} />} Enviar pro receptor
          </button>
        </div>
      </div>

      {screensHook.error && <p className="text-[11px] text-amber-400 mb-2">{screensHook.error}</p>}
      {screensHook.applyError && (
        <p className="text-[11px] text-red-400 mb-2 flex items-center gap-1"><XCircle size={11} /> {screensHook.applyError}</p>
      )}
      {screensHook.applyResult?.ok && (
        <p className="text-[11px] text-emerald-400 mb-2 flex items-center gap-1">
          <CheckCircle2 size={11} /> {screensHook.applyResult.pending ? 'Enfileirado — aplica quando o receptor buscar.' : 'Aplicado no receptor.'}
        </p>
      )}

      <div className="flex items-center gap-2 mb-2 text-xs flex-wrap">
        <label className="text-gray-400">Tela:</label>
        <select
          value={layoutIdx}
          onChange={e => setLayoutIdx(Number(e.target.value))}
          className="bg-surface border border-border rounded px-2 py-1 text-white"
        >
          {layouts.map((l, i) => <option key={l.label} value={i}>{l.label}</option>)}
        </select>

        <div className="flex items-center gap-1">
          <button type="button" onClick={undo} disabled={history.length === 0} title="Desfazer (até 10 passos)" className="p-1 rounded border border-border text-gray-400 hover:text-white hover:border-border-strong disabled:opacity-30 disabled:hover:text-gray-400">
            <Undo2 size={13} />
          </button>
          <button type="button" onClick={redo} disabled={future.length === 0} title="Refazer" className="p-1 rounded border border-border text-gray-400 hover:text-white hover:border-border-strong disabled:opacity-30 disabled:hover:text-gray-400">
            <Redo2 size={13} />
          </button>
        </div>

        <div className="flex items-center gap-1 ml-auto">
          {([3, 5] as const).map(z => (
            <button key={z} type="button" onClick={() => setZoom(z)} className={`px-2 py-0.5 rounded border ${zoom === z ? 'border-blue-500 text-blue-400' : 'border-border text-gray-400 hover:text-white'}`}>
              {z}x
            </button>
          ))}
        </div>
      </div>

      {/* Paleta */}
      <div className="flex flex-wrap gap-1 mb-3">
        {PALETTE.map(p => (
          <div
            key={p.code}
            draggable
            onDragStart={e => e.dataTransfer.setData('application/json', JSON.stringify({ source: 'palette', code: p.code, extra: p.extra }))}
            className="px-2 py-1 text-[11px] rounded border border-border bg-surface text-gray-300 cursor-grab hover:border-border-strong hover:text-white select-none"
            title="Arraste pra uma célula do display"
          >
            {p.label}
          </div>
        ))}
      </div>

      {/* Grid interativo sobre o canvas, centralizado — sem scroll: em 5x o
          display (640x320px) cabe sozinho na largura do painel */}
      <div className="flex justify-center">
        <div className="relative" style={{ width: WIDTH * zoom, height: HEIGHT * zoom }}>
          <canvas
            ref={canvasRef}
            width={WIDTH * SCALE}
            height={HEIGHT * SCALE}
            style={{ width: WIDTH * zoom, height: HEIGHT * zoom, imageRendering: 'pixelated' }}
            className="absolute inset-0 border border-border-strong rounded"
          />
          <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${OLED_COLS}, ${cellSize}px)`, gridTemplateRows: `repeat(${OLED_ROWS}, ${cellSize}px)` }}>
            {Array.from({ length: OLED_ROWS }).map((_, row) =>
              Array.from({ length: OLED_COLS }).map((_, col) => {
                const cellKey = row * OLED_COLS + col
                return (
                  <div
                    key={cellKey}
                    onDragOver={e => { e.preventDefault(); setDragOverCell(cellKey) }}
                    onDragLeave={() => setDragOverCell(prev => (prev === cellKey ? null : prev))}
                    onDrop={e => handleDropCell(e, row, col)}
                    className={dragOverCell === cellKey ? 'bg-blue-500/20' : ''}
                  />
                )
              })
            )}
          </div>
          {entries.map((en, i) => (
            <div
              key={i}
              draggable
              onDragStart={e => e.dataTransfer.setData('application/json', JSON.stringify({ source: 'existing', index: i }))}
              onClick={() => setSelected(i)}
              title={`${CODE_LABEL[en.code] ?? en.code} — arraste pra mover, clique pra editar`}
              className={`absolute cursor-grab border ${selected === i ? 'border-blue-400' : 'border-transparent hover:border-blue-500/60'}`}
              style={{
                left: en.col * cellSize,
                top: en.line * cellSize,
                width: cellSize * Math.max(1, en.width ?? 2),
                height: cellSize * (en.large ? 2 : 1),
              }}
            />
          ))}
        </div>
      </div>

      {/* Dica / painel de propriedades — abaixo do display */}
      <div className="mt-3">
        {!selectedEntry ? (
          <p className="text-xs text-gray-400 text-center">Arraste um item da paleta pro display, ou clique num item já colocado pra editar.</p>
        ) : (
          <div className="space-y-2 text-xs max-w-sm mx-auto">
            <p className="text-white font-medium">{CODE_LABEL[selectedEntry.code] ?? selectedEntry.code}</p>
            <label className="flex items-center gap-2 text-gray-400">
              <input
                type="checkbox"
                checked={selectedEntry.large}
                onChange={e => updateSelected({ large: e.target.checked })}
              />
              Fonte grande
            </label>
            <div>
              <label className="block text-gray-400 mb-1">Sub-código / sufixo (ex.: &quot;m km/h&quot;, &quot;V&quot;, &quot;t°C&quot;)</label>
              <input
                type="text"
                value={selectedEntry.extra}
                onChange={e => updateSelected({ extra: e.target.value })}
                className="w-full bg-surface border border-border rounded px-2 py-1 text-white mono"
              />
            </div>
            <div>
              <label className="block text-gray-400 mb-1">Largura fixa (opcional)</label>
              <input
                type="number"
                value={selectedEntry.width ?? ''}
                onChange={e => updateSelected({ width: e.target.value === '' ? undefined : Number(e.target.value) })}
                className="w-full bg-surface border border-border rounded px-2 py-1 text-white mono"
              />
            </div>
            <button type="button" onClick={removeSelected} className="flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-red-900 text-red-400 hover:bg-red-950">
              <Trash2 size={11} /> Remover item
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
