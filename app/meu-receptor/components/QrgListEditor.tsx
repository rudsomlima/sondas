'use client'

import { useEffect, useState } from 'react'
import { Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react'
import type { RdzConfig } from '@/app/lib/rdzConfig'
import {
  parseQrgList, serializeQrg, validateQrg, EDITABLE_TYPES, TYPE_NAME,
  type QrgChannel,
} from '@/app/lib/qrg'

interface Props {
  config: RdzConfig
  changes: Record<string, string>
  setField: (key: string, value: string) => void
}

// Linha em edição: a frequência fica como texto enquanto se digita ("403." não pode virar 403 na hora).
interface Row { freq: string; type: string; active: boolean; label: string }

// Frequências usadas nos lançamentos de Natal em 2026 (403 MHz em ~88% deles) — atalhos de um clique.
const NATAL_QUICK = [403.0, 404.0, 402.0, 401.0]

const toRow = (c: QrgChannel): Row => ({ freq: c.freq.toFixed(3), type: c.type === '2' ? 'M' : c.type, active: c.active, label: c.label })
const toChannel = (r: Row): QrgChannel => ({ freq: parseFloat(r.freq), type: r.type, active: r.active, label: r.label.trim(), imported: false })

/**
 * Lista de canais do receptor (qrg.txt) editável pelo app. O receptor percorre os
 * canais ATIVOS na ordem da lista; a primeira frequência é a mais importante. Ao
 * aplicar, o firmware regrava o qrg.txt e recarrega a lista na hora, sem reiniciar (gravar exige o firmware <span className="mono">dev20261110.2</span> ou mais novo).
 */
export default function QrgListEditor({ config, changes, setField }: Props) {
  const baseline = config['qrg.list'] ?? ''
  const baselineChannels = parseQrgList(baseline)
  const imported = baselineChannels.filter(c => c.imported)
  const maxSlots = parseInt(config['maxsonde'] ?? '', 10) || 0

  const [rows, setRows] = useState<Row[]>(() => parseQrgList(changes['qrg.list'] ?? baseline).filter(c => !c.imported).map(toRow))
  // Config recarregada do aparelho (ou aplicada com sucesso): volta a mostrar o que ele tem.
  useEffect(() => { setRows(parseQrgList(baseline).filter(c => !c.imported).map(toRow)) }, [baseline])

  const commit = (next: Row[]) => {
    setRows(next)
    setField('qrg.list', serializeQrg(next.map(toChannel)))
  }
  const patch = (i: number, p: Partial<Row>) => commit(rows.map((r, k) => (k === i ? { ...r, ...p } : r)))
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= rows.length) return
    const next = [...rows]; [next[i], next[j]] = [next[j], next[i]]
    commit(next)
  }
  const add = (freq: number) => commit([...rows, { freq: freq.toFixed(3), type: '4', active: true, label: 'CLBI_NATAL' }])

  const channels = rows.map(toChannel)
  const errors = validateQrg(channels, maxSlots)
  const changed = serializeQrg(channels) !== serializeQrg(baselineChannels)
  const fixedCount = rows.length
  const spare = maxSlots > 0 ? Math.max(0, maxSlots - fixedCount) : null
  const missing = NATAL_QUICK.filter(f => !rows.some(r => Math.abs(parseFloat(r.freq) - f) < 0.003))

  if (!baseline) {
    return (
      <p className="text-[11px] text-amber-400">
        O aparelho ainda não enviou a lista de canais — ela chega com o firmware <span className="mono">dev20261110.1</span> ou mais novo.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-faint leading-relaxed">
        O receptor escuta os canais <span className="text-gray-300">ativos</span> na ordem da lista (a primeira é a principal).
        Com sonda no ar ele fica nela; sem sinal por <span className="mono">norx_timeout</span> segundos, passa para a próxima.
        Ao aplicar, o aparelho regrava o <span className="mono">qrg.txt</span> e recarrega a lista na hora, sem reiniciar.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-faint border-b border-border">
              <th className="text-left font-normal pb-1 pr-2 w-6">#</th>
              <th className="text-left font-normal pb-1 pr-2">frequência (MHz)</th>
              <th className="text-left font-normal pb-1 pr-2">tipo</th>
              <th className="text-left font-normal pb-1 pr-2">nome</th>
              <th className="text-center font-normal pb-1 pr-2">ativa</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r, i) => {
              const f = parseFloat(r.freq)
              const bad = !Number.isFinite(f) || f < 400 || f > 406
              return (
                <tr key={i} className={r.active ? '' : 'opacity-60'}>
                  <td className="py-1 pr-2 mono text-faint">{i + 1}</td>
                  <td className="py-1 pr-2">
                    <input type="number" step="0.001" min={400} max={406} value={r.freq}
                      onChange={e => patch(i, { freq: e.target.value })}
                      className={`w-28 bg-bg border rounded-md text-white mono px-2 py-1 outline-none focus:border-blue-500 ${bad ? 'border-red-500' : 'border-border'}`} />
                  </td>
                  <td className="py-1 pr-2">
                    <select value={r.type} onChange={e => patch(i, { type: e.target.value })}
                      className="bg-bg border border-border rounded-md text-white px-1.5 py-1 outline-none focus:border-blue-500">
                      {EDITABLE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </td>
                  <td className="py-1 pr-2">
                    <input value={r.label} maxLength={16} onChange={e => patch(i, { label: e.target.value.replace(/\s/g, '_') })}
                      className="w-32 bg-bg border border-border rounded-md text-white mono px-2 py-1 outline-none focus:border-blue-500" />
                  </td>
                  <td className="py-1 pr-2 text-center">
                    <input type="checkbox" checked={r.active} onChange={e => patch(i, { active: e.target.checked })} />
                  </td>
                  <td className="py-1 whitespace-nowrap text-right">
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} title="Subir (escutar antes)"
                      className="p-1 text-gray-500 hover:text-white disabled:opacity-30"><ArrowUp size={12} /></button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1} title="Descer"
                      className="p-1 text-gray-500 hover:text-white disabled:opacity-30"><ArrowDown size={12} /></button>
                    <button type="button" onClick={() => commit(rows.filter((_, k) => k !== i))} title="Remover"
                      className="p-1 text-gray-500 hover:text-red-400"><Trash2 size={12} /></button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" onClick={() => add(403.0)}
          className="flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-border text-gray-300 hover:text-white hover:border-border-strong">
          <Plus size={11} /> Adicionar frequência
        </button>
        {missing.length > 0 && (
          <span className="text-[11px] text-faint flex items-center gap-1.5 flex-wrap">
            Natal usa também:
            {missing.map(f => (
              <button key={f} type="button" onClick={() => add(f)}
                className="px-1.5 py-0.5 rounded border border-border mono text-gray-400 hover:text-white hover:border-border-strong">
                + {f.toFixed(3)}
              </button>
            ))}
          </span>
        )}
        {changed && <span className="text-[11px] text-amber-400">lista alterada — falta aplicar</span>}
      </div>

      {spare !== null && (
        <p className="text-[11px] text-faint">
          {fixedCount} canal(is) fixo(s) de {maxSlots} vagas · {spare} vaga(s) livre(s) para frequências importadas do SondeHub
          {spare === 0 && <span className="text-amber-400"> — sem vaga livre, a importação não consegue adicionar nada</span>}.
        </p>
      )}

      {imported.length > 0 && (
        <div className="text-[11px] text-faint">
          Importadas do SondeHub agora (temporárias, não editáveis):{' '}
          {imported.map((c, i) => (
            <span key={i} className="mono text-gray-300 mr-2">{c.freq.toFixed(3)} {TYPE_NAME[c.type] ?? c.type} {c.label}</span>
          ))}
        </div>
      )}

      {errors.length > 0 && (
        <ul className="text-[11px] text-red-400 list-disc pl-4 space-y-0.5">
          {errors.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      )}
    </div>
  )
}
