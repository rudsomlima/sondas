'use client'

import type { LaunchConfidence, SourceState } from '@/app/lib/confidence'

const SOURCES: { key: keyof Pick<LaunchConfidence, 'wyoming' | 'radiosondy' | 'sondehub'>; letter: string; name: string; colorClass: string; borderClass: string }[] = [
  { key: 'wyoming', letter: 'W', name: 'University of Wyoming', colorClass: 'text-src-wyoming', borderClass: 'border-sky-500/50' },
  { key: 'radiosondy', letter: 'R', name: 'radiosondy.info', colorClass: 'text-src-radiosondy', borderClass: 'border-emerald-500/50' },
  { key: 'sondehub', letter: 'S', name: 'sondehub.org', colorClass: 'text-src-sondehub', borderClass: 'border-violet-500/50' },
]

function stateLabel(s: SourceState): string {
  return s === 'confirmed' ? 'confirmado'
    : s === 'pending' ? 'aguardando'
    : s === 'error' ? 'listado, mas indisponível'
    : 'sem registro'
}

interface SourceBadgesProps {
  confidence: LaunchConfidence
  size?: 'sm' | 'lg'
}

// Selos W/R/S de confiança multi-fonte:
// confirmed = sólido, pending = outline pulsante, absent = riscado/cinza.
export default function SourceBadges({ confidence, size = 'sm' }: SourceBadgesProps) {
  const base = size === 'lg'
    ? 'text-xs font-bold px-1.5 py-0.5 rounded border'
    : 'text-[9px] font-bold leading-none px-1 py-px rounded border'

  return (
    <span className="inline-flex items-center gap-1">
      {SOURCES.map(({ key, letter, name, colorClass, borderClass }) => {
        const state = confidence[key]
        const cls =
          state === 'confirmed' ? `${colorClass} ${borderClass} bg-white/5`
          : state === 'pending' ? `${colorClass} ${borderClass} opacity-60 pulse-soft`
          : state === 'error' ? 'text-red-400 border-red-500/50 bg-red-500/10'
          : 'text-gray-600 border-gray-700 line-through'
        return (
          <span key={key} className={`${base} ${cls}`} title={`${name}: ${stateLabel(state)}`}>
            {letter}
          </span>
        )
      })}
    </span>
  )
}
