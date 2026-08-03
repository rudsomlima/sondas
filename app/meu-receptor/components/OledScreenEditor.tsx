'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, Upload, CloudDownload, CloudUpload, Loader2, CheckCircle2, XCircle, Trash2, Undo2, Redo2, Copy } from 'lucide-react'
import { parseScreensFile, type OledEntry } from '@/app/lib/oledScreenParser'
import { replaceLayoutEntries } from '@/app/lib/oledScreenSerializer'
import { SCREENS1_TXT } from '@/app/lib/oledTemplates'
import { drawOledEntry, maxWidthChars, OLED_COLS, OLED_ROWS, CELL_PX } from '@/app/lib/oledRenderer'
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
  { code: 'k', label: 'Tempo até dormir (deep sleep)', extra: 'sm' },
]

const CODE_LABEL: Record<string, string> = Object.fromEntries(PALETTE.map(p => [p.code, p.label]))

const HISTORY_LIMIT = 10

// Sub-códigos do item "k" (Killtimer — código de paleta 'k', extra padrão
// "sm"), espelhando Display::drawKilltimer em RX_FSK/src/Display.cpp e o
// mesmo formato em oledRenderer.ts (`case 'k'`):
//   extra[0] = origem do contador — s=segundos até o próximo deep sleep
//              (sleepCountdownS, ver RX_FSK/src/sleep.cpp), l=launchKT,
//              b=burstKT, c=countKT;
//   extra[1] = formato de exibição — m=min:seg (sem limite de 60min), 4=h:mm,
//              6=h:mm:ss, 0=segundos crus (qualquer valor fora de 4/6/m cai
//              nesse default — "0" é só a convenção usada aqui pra não
//              colidir com o sufixo abaixo);
//   extra[2:] = sufixo literal opcional, igual aos outros campos (ex.: " km/h").
// Exemplo: extra "sm" = "s" (segundos até dormir) + "m" (formato min:seg) → "12:34".
const KILLTIMER_SOURCES: { value: string; label: string }[] = [
  { value: 's', label: 'Tempo até dormir (deep sleep)' },
  { value: 'l', label: 'Timer de lançamento (launchKT)' },
  { value: 'b', label: 'Timer de estouro (burstKT)' },
  { value: 'c', label: 'Timer de contagem (countKT)' },
]
const KILLTIMER_FORMATS: { value: string; label: string }[] = [
  { value: 'm', label: 'min:seg — ex.: 12:34' },
  { value: '4', label: 'h:mm — ex.: 1:23' },
  { value: '6', label: 'h:mm:ss — ex.: 1:23:45' },
  { value: '0', label: 'segundos crus — ex.: 754' },
]

function parseKilltimerExtra(extra: string): { source: string; format: string; suffix: string } {
  return { source: extra[0] ?? 's', format: extra[1] ?? 'm', suffix: extra.slice(2) }
}
function buildKilltimerExtra(source: string, format: string, suffix: string): string {
  return `${source}${format}${suffix}`
}

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
  // Item sendo arrastado no momento (da paleta ou já colocado) — usado pra
  // desenhar o "fantasma" com a largura máxima que ele pode ocupar (ver grid abaixo).
  const [dragPreview, setDragPreview] = useState<{ code: string; extra: string; large: boolean } | null>(null)
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
    setDragPreview(null)
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

  // Primeira célula livre (sem nenhum item começando nela), varrendo
  // linha a linha — usada tanto pra clique-pra-adicionar (fallback do
  // arraste, que depende do HTML5 drag-and-drop e nem sempre funciona em
  // todo navegador/touch) quanto pra duplicar um item.
  function findFreeCell(): { line: number; col: number } {
    const occupied = new Set(entries.map(en => `${en.line},${en.col}`))
    for (let line = 0; line < OLED_ROWS; line++) {
      for (let col = 0; col < OLED_COLS; col++) {
        if (!occupied.has(`${line},${col}`)) return { line, col }
      }
    }
    return { line: 0, col: 0 }
  }

  function addFromPalette(p: PaletteItem) {
    const { line, col } = findFreeCell()
    mutateEntries([...entries, { line, col, large: false, code: p.code, extra: p.extra }])
    setSelected(entries.length)
  }

  function duplicateSelected() {
    if (selected === null) return
    const en = entries[selected]
    const { line, col } = findFreeCell()
    mutateEntries([...entries, { ...en, line, col }])
    setSelected(entries.length)
  }

  // Tecla Delete apaga o item selecionado, setas movem 1 célula por vez
  // (alternativa por teclado ao arraste, útil quando o drag-and-drop do
  // navegador falha ou em telas touch) — ambos ignorados com o foco num
  // campo de texto/select do painel de propriedades.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (selected === null) return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return

      if (e.key === 'Delete') {
        e.preventDefault()
        removeSelected()
        return
      }

      const delta: Record<string, [number, number]> = {
        ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0],
      }
      const d = delta[e.key]
      if (!d) return
      e.preventDefault()
      const en = entries[selected]
      if (!en) return
      const nextLine = Math.max(0, Math.min(OLED_ROWS - 1, en.line + d[0]))
      const nextCol = Math.max(0, Math.min(OLED_COLS - 1, en.col + d[1]))
      if (nextLine === en.line && nextCol === en.col) return
      updateSelected({ line: nextLine, col: nextCol })
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selected, entries]) // eslint-disable-line react-hooks/exhaustive-deps

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

      {screensHook.error && (
        <p className="text-[11px] text-amber-400 mb-2">
          {screensHook.error} Se você acabou de configurar o endereço do app (mqtt.siteurl), o receptor só
          reenvia o arquivo de telas automaticamente no próximo boot, ou em até 10 min sem precisar reiniciar
          — pode reiniciar o receptor pra forçar agora.
        </p>
      )}
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
            onDragStart={e => {
              e.dataTransfer.setData('application/json', JSON.stringify({ source: 'palette', code: p.code, extra: p.extra }))
              setDragPreview({ code: p.code, extra: p.extra, large: false })
            }}
            onDragEnd={() => { setDragPreview(null); setDragOverCell(null) }}
            onClick={() => addFromPalette(p)}
            className="px-2 py-1 text-[11px] rounded border border-border bg-surface text-gray-300 cursor-pointer hover:border-border-strong hover:text-white select-none"
            title={p.code === 'k'
              ? 'Clique pra adicionar (cai na primeira célula livre) ou arraste pra escolher onde. Depois de colocado, clique nele pra escolher a origem (deep sleep / timers) e o formato (min:seg, h:mm, h:mm:ss ou segundos crus). Setas do teclado movem, Delete remove.'
              : 'Clique pra adicionar (cai na primeira célula livre) ou arraste pra escolher onde. Setas do teclado movem, Delete remove.'}
          >
            {p.label}
          </div>
        ))}
      </div>

      {/* Grid interativo sobre o canvas, centralizado — sem scroll: em 5x o
          display (640x320px) cabe sozinho na largura do painel */}
      <div className="flex justify-center">
        <div
          className="relative"
          style={{ width: WIDTH * zoom, height: HEIGHT * zoom }}
          onClick={() => setSelected(null)}
        >
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
          {dragPreview && dragOverCell !== null && (() => {
            const col = dragOverCell % OLED_COLS
            const row = Math.floor(dragOverCell / OLED_COLS)
            const chars = maxWidthChars({ line: row, col, large: dragPreview.large, code: dragPreview.code, extra: dragPreview.extra })
            const widthCells = Math.min(OLED_COLS - col, chars)
            return (
              <div
                className="absolute border-2 border-dashed border-amber-400/80 bg-amber-400/10 pointer-events-none flex items-center justify-center overflow-hidden"
                style={{
                  left: col * cellSize,
                  top: row * cellSize,
                  width: cellSize * widthCells,
                  height: cellSize * (dragPreview.large ? 2 : 1),
                }}
                title="Espaço máximo que este item pode ocupar (todos os caracteres possíveis)"
              >
                <span className="text-[9px] text-amber-300 whitespace-nowrap px-0.5">{chars} car.</span>
              </div>
            )
          })()}
          {/* Ao clicar/selecionar um item já colocado (sem estar arrastando),
              mostra de cara a área máxima que ele pode ocupar — mesmo
              "fantasma" do arraste, mas parado na posição atual do item, pra
              não precisar arrastar só pra ver o espaço que ele ocupa. Azul
              (não âmbar) pra não misturar com a borda azul de seleção do
              próprio item — âmbar fica só pro arraste ativo. */}
          {selected !== null && !dragPreview && entries[selected] && (() => {
            const en = entries[selected]
            const chars = maxWidthChars(en)
            const widthCells = Math.min(OLED_COLS - en.col, chars)
            return (
              <div
                className="absolute border-2 border-dashed border-blue-400/80 bg-blue-400/10 pointer-events-none flex items-center justify-center overflow-hidden"
                style={{
                  left: en.col * cellSize,
                  top: en.line * cellSize,
                  width: cellSize * widthCells,
                  height: cellSize * (en.large ? 2 : 1),
                }}
                title="Espaço máximo que este item pode ocupar (todos os caracteres possíveis)"
              >
                <span className="text-[9px] text-blue-300 whitespace-nowrap px-0.5">{chars} car.</span>
              </div>
            )
          })()}
          {entries.map((en, i) => (
            <div
              key={i}
              draggable
              onDragStart={e => {
                e.dataTransfer.setData('application/json', JSON.stringify({ source: 'existing', index: i }))
                setDragPreview({ code: en.code, extra: en.extra, large: en.large })
                setSelected(i) // já entra no modo de edição assim que o arraste começa
              }}
              onDragEnd={() => { setDragPreview(null); setDragOverCell(null) }}
              onClick={e => { e.stopPropagation(); setSelected(i) }}
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
          <p className="text-xs text-gray-400 text-center">Clique ou arraste um item da paleta pro display, ou clique num item já colocado pra editar (setas movem, Delete remove).</p>
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
            {selectedEntry.code === 'k' ? (
              <>
                <div>
                  <label className="block text-gray-400 mb-1">Origem do contador</label>
                  <select
                    value={parseKilltimerExtra(selectedEntry.extra).source}
                    onChange={e => {
                      const { format, suffix } = parseKilltimerExtra(selectedEntry.extra)
                      updateSelected({ extra: buildKilltimerExtra(e.target.value, format, suffix) })
                    }}
                    className="w-full bg-surface border border-border rounded px-2 py-1 text-white"
                  >
                    {KILLTIMER_SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-gray-400 mb-1">Formato</label>
                  <select
                    value={parseKilltimerExtra(selectedEntry.extra).format}
                    onChange={e => {
                      const { source, suffix } = parseKilltimerExtra(selectedEntry.extra)
                      updateSelected({ extra: buildKilltimerExtra(source, e.target.value, suffix) })
                    }}
                    className="w-full bg-surface border border-border rounded px-2 py-1 text-white"
                  >
                    {KILLTIMER_FORMATS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-gray-400 mb-1">Sufixo literal (opcional, ex.: &quot; min&quot;)</label>
                  <input
                    type="text"
                    value={parseKilltimerExtra(selectedEntry.extra).suffix}
                    onChange={e => {
                      const { source, format } = parseKilltimerExtra(selectedEntry.extra)
                      updateSelected({ extra: buildKilltimerExtra(source, format, e.target.value) })
                    }}
                    className="w-full bg-surface border border-border rounded px-2 py-1 text-white mono"
                  />
                </div>
                <p className="text-[10px] text-faint">
                  Código gravado no arquivo: <span className="mono text-gray-300">{selectedEntry.large ? 'K' : 'k'}{selectedEntry.extra}</span> — 1º
                  caractere = origem (s/l/b/c), 2º = formato (4/6/m/0=segundos crus), resto = sufixo literal.
                </p>
              </>
            ) : (
              <div>
                <label className="block text-gray-400 mb-1">Sub-código / sufixo (ex.: &quot;m km/h&quot;, &quot;V&quot;, &quot;t°C&quot;)</label>
                <input
                  type="text"
                  value={selectedEntry.extra}
                  onChange={e => updateSelected({ extra: e.target.value })}
                  className="w-full bg-surface border border-border rounded px-2 py-1 text-white mono"
                />
              </div>
            )}
            <div>
              <label className="block text-gray-400 mb-1">Largura fixa (opcional)</label>
              <input
                type="number"
                value={selectedEntry.width ?? ''}
                onChange={e => updateSelected({ width: e.target.value === '' ? undefined : Number(e.target.value) })}
                className="w-full bg-surface border border-border rounded px-2 py-1 text-white mono"
              />
            </div>
            <p className="text-[10px] text-faint">
              Posição: linha {selectedEntry.line}, coluna {selectedEntry.col}. Setas do teclado movem célula a célula, Delete remove.
            </p>
            <div className="flex items-center gap-2">
              <button type="button" onClick={duplicateSelected} className="flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-border text-gray-400 hover:text-white hover:border-border-strong">
                <Copy size={11} /> Duplicar
              </button>
              <button type="button" onClick={removeSelected} className="flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-red-900 text-red-400 hover:bg-red-950">
                <Trash2 size={11} /> Remover item
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
