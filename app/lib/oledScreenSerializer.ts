import type { OledEntry, OledLayout } from './oledScreenParser'

/** Inverso de parseScreensFile: reconstrói a linha "line,col[,width]=content" de um item. */
export function entryToLine(entry: OledEntry): string {
  const first = entry.large ? entry.code.toUpperCase() : entry.code
  const content = `${first}${entry.extra}`
  const pos = entry.width !== undefined
    ? `${entry.line},${entry.col},${entry.width}`
    : `${entry.line},${entry.col}`
  return `${pos}=${content}`
}

function layoutToBlock(layout: OledLayout): string {
  const lines = [`@${layout.label}`, ...layout.directives, ...layout.entries.map(entryToLine)]
  return lines.join('\n')
}

/**
 * Substitui, dentro do texto completo de um screens*.txt, só o bloco
 * "@label" (diretivas + itens) por uma nova lista de entries — preserva
 * todos os outros blocos exatamente como estavam no texto original.
 */
export function replaceLayoutEntries(fullText: string, label: string, newEntries: OledEntry[], directives: string[]): string {
  const lines = fullText.split('\n')
  const startIdx = lines.findIndex(l => l.trim() === `@${label}`)
  if (startIdx < 0) {
    // bloco não existia — acrescenta no fim
    const block = layoutToBlock({ label, entries: newEntries, directives })
    return `${fullText.replace(/\s+$/, '')}\n\n${block}\n`
  }

  let endIdx = lines.length
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i].trim().startsWith('@')) { endIdx = i; break }
  }

  const block = layoutToBlock({ label, entries: newEntries, directives })
  const before = lines.slice(0, startIdx)
  const after = lines.slice(endIdx)
  return [...before, block, ...after].join('\n')
}
