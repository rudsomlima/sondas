'use client'

import SourceBadges from '@/app/components/ui/SourceBadges'
import { computeConfidence } from '@/app/lib/confidence'
import type { Station } from '@/app/lib/stations'
import type { SelectedTarget } from '../selection'

const LEVEL_LABEL = {
  high: { text: 'ALTA', cls: 'text-green-400' },
  medium: { text: 'MÉDIA', cls: 'text-yellow-400' },
  low: { text: 'BAIXA', cls: 'text-red-400' },
} as const

// Painel direito: reconciliação multi-fonte do lançamento selecionado.
export default function ConfidencePanel({ selected, station }: { selected: SelectedTarget | null; station: Station }) {
  const launch = selected?.launch

  return (
    <div className="panel p-4">
      <p className="panel-title mb-3">Confiança multi-fonte</p>
      {!selected ? (
        <p className="text-xs text-dim">Selecione uma sonda ou lançamento.</p>
      ) : !launch ? (
        <p className="text-xs text-dim">
          Sonda detectada ao vivo — confirmação entre fontes disponível após o
          registro do lançamento no histórico.
        </p>
      ) : (() => {
        const conf = computeConfidence(launch, station.wyomingSupported !== false)
        const level = LEVEL_LABEL[conf.level]
        return (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <SourceBadges confidence={conf} size="lg" />
              <span className={`text-xs font-bold mono ${level.cls}`}>{level.text}</span>
            </div>
            {conf.notes.length > 0 && (
              <ul className="text-[11px] text-dim space-y-1 pt-1">
                {conf.notes.map((n, i) => <li key={i}>• {n}</li>)}
              </ul>
            )}
          </div>
        )
      })()}
    </div>
  )
}
