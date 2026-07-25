/**
 * Parser do formato de tela do rdzTTGOsonde (screens1.txt), portado de
 * Display::initFromFile / Display::parseDispElement em RX_FSK/src/Display.cpp.
 * Só entende o suficiente para simular visualmente um display OLED SSD1306
 * (grade 8 linhas x 16 colunas de células) — larguras negativas (justificado
 * à direita) e `scale=`/`color=` (só existem em telas TFT) não são tratados.
 */

export interface OledEntry {
  line: number
  col: number
  width?: number
  /** true = fonte grande (16px), false = fonte pequena (8px) — vem do 1º char maiúsculo/minúsculo */
  large: boolean
  /** código do item, já normalizado para minúsculo (ex.: 'l', 'f', 'b', 'x') */
  code: string
  /** resto do texto após o código — sub-seleção + sufixo literal, dependendo do código */
  extra: string
}

export interface OledLayout {
  label: string
  entries: OledEntry[]
  /** linhas cruas ignoradas na simulação (timer=/key*action=/fonts=/etc), na ordem original — preservadas na serialização */
  directives: string[]
}

const IGNORED_PREFIXES = ['timer=', 'key1action=', 'key2action=', 'timeaction=', 'fonts=', 'scale=', 'color=']

export function parseScreensFile(text: string): OledLayout[] {
  const layouts: OledLayout[] = []
  let current: OledLayout | null = null

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    if (line.startsWith('@')) {
      current = { label: line.slice(1).trim(), entries: [], directives: [] }
      layouts.push(current)
      continue
    }
    if (!current) continue
    if (IGNORED_PREFIXES.some(p => line.startsWith(p))) {
      current.directives.push(line)
      continue
    }

    const eq = line.indexOf('=')
    if (eq < 0) continue
    const pos = line.slice(0, eq).split(',')
    const content = line.slice(eq + 1)
    if (pos.length < 2 || !content) continue

    // sscanf(s, "%f,%f,%f", &y, &x, &w) no firmware — linha (y) vem antes da coluna (x)
    const lineNum = parseFloat(pos[0])
    const col = parseFloat(pos[1])
    const width = pos.length > 2 ? parseFloat(pos[2]) : undefined
    if (Number.isNaN(lineNum) || Number.isNaN(col)) continue

    const first = content[0]
    const large = first >= 'A' && first <= 'Z'
    const code = first.toLowerCase()
    const extra = content.slice(1)

    current.entries.push({ line: lineNum, col, width, large, code, extra })
  }

  return layouts
}
