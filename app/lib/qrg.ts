/**
 * Lista de canais (frequências) do receptor rdzTTGOsonde — o qrg.txt do firmware.
 *
 * O firmware manda a lista dentro do snapshot de configuração como um campo só,
 * `qrg.list` (ver cfgBuildConfigJson em cfgchannel.cpp), no formato:
 *   "403.000 4 + CLBI_NATAL;404.000 4 + CLBI_NATAL;402.000 4 -;@W3820513/12"
 * ou seja `frequência tipo ativo rótulo`, separados por `;`. O mesmo formato
 * volta do app como mudança de `qrg.list`, e o firmware regrava o qrg.txt.
 *
 * Rótulo começando com `@` é canal IMPORTADO do SondeHub (sondehub.fiactive):
 * temporário, o firmware o recria sozinho — nunca é gravado no qrg.txt.
 */

export interface QrgChannel {
  freq: number      // MHz
  type: string      // letra do firmware: 4 RS41, R RS92, D DFM, M M10/M20, 3 MP3H
  active: boolean
  label: string
  imported: boolean // veio do SondeHub, não do qrg.txt
}

export const TYPE_NAME: Record<string, string> = {
  '4': 'RS41', 'R': 'RS92', 'D': 'DFM', 'M': 'M10/M20', '2': 'M20', '3': 'MP3H',
}

/** Tipos que o app deixa escolher ao editar (a letra '2' do firmware é tratada como M). */
export const EDITABLE_TYPES: { value: string; label: string }[] = [
  { value: '4', label: 'RS41' },
  { value: 'R', label: 'RS92' },
  { value: 'D', label: 'DFM' },
  { value: 'M', label: 'M10/M20' },
  { value: '3', label: 'MP3H' },
]

export const QRG_MIN_MHZ = 400
export const QRG_MAX_MHZ = 406
const LABEL_RE = /^[A-Za-z0-9_.-]{1,16}$/

export function parseQrgList(list: string | undefined | null): QrgChannel[] {
  if (!list) return []
  const out: QrgChannel[] = []
  for (const raw of list.split(';')) {
    const m = raw.trim().match(/^(\d+(?:\.\d+)?)\s+(\S)\s+([+-])\s*(.*)$/)
    if (!m) continue
    const label = m[4].trim()
    out.push({ freq: parseFloat(m[1]), type: m[2], active: m[3] === '+', label, imported: label.startsWith('@') })
  }
  return out
}

/** Só os canais fixos (as importadas são do firmware), na ordem em que estão. */
export function serializeQrg(channels: QrgChannel[]): string {
  return channels
    .filter(c => !c.imported)
    // Frequência ainda inválida (campo vazio) vira 0.000 em vez de sumir: a validação a pega e o aplicar fica bloqueado.
    .map(c => `${(Number.isFinite(c.freq) ? c.freq : 0).toFixed(3)} ${c.type} ${c.active ? '+' : '-'} ${c.label || 'QRG'}`)
    .join(';')
}

/** Problemas que impedem de gravar (lista vazia = mensagens vazias = pode gravar). */
export function validateQrg(channels: QrgChannel[], maxSlots: number): string[] {
  const fixed = channels.filter(c => !c.imported)
  const errs: string[] = []
  if (fixed.length === 0) errs.push('A lista precisa ter pelo menos uma frequência.')
  if (!fixed.some(c => c.active)) errs.push('Deixe pelo menos uma frequência ativa, senão o receptor não escuta nada.')
  fixed.forEach((c, i) => {
    const n = i + 1
    if (!Number.isFinite(c.freq) || c.freq < QRG_MIN_MHZ || c.freq > QRG_MAX_MHZ)
      errs.push(`Linha ${n}: a frequência deve estar entre ${QRG_MIN_MHZ} e ${QRG_MAX_MHZ} MHz.`)
    if (c.label && !LABEL_RE.test(c.label))
      errs.push(`Linha ${n}: o nome só pode ter letras, números, _ . - (até 16 caracteres, sem espaço).`)
  })
  for (let i = 0; i < fixed.length; i++) {
    for (let j = i + 1; j < fixed.length; j++) {
      if (Math.abs(fixed[i].freq - fixed[j].freq) < 0.003)
        errs.push(`Linhas ${i + 1} e ${j + 1}: a mesma frequência (${fixed[i].freq.toFixed(3)} MHz).`)
    }
  }
  if (maxSlots > 0 && fixed.length > maxSlots)
    errs.push(`O receptor tem ${maxSlots} vagas (maxsonde); a lista tem ${fixed.length}. Aumente maxsonde ou tire canais.`)
  return errs
}
