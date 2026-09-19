'use client'

import { Database, MapPin, RefreshCw } from 'lucide-react'
import type { Launch } from '@/app/lib/types'
import type { LiveSourceHealth } from '@/app/historico/hooks/useLiveFlights'
import { sourceCounts } from '@/app/lib/launchData'
import { useWyomingEnabled } from '@/app/lib/appSettings'

interface Props {
  launches: Launch[]
  monthLoading: boolean
  monthError: string | null
  todayError: string | null
  liveError: string | null
  sourceHealth: LiveSourceHealth
  onRefresh: () => void
}

const stateClass = (ok: boolean) => ok ? 'text-emerald-400' : 'text-yellow-400'

export default function DataCoveragePanel({ launches, monthLoading, monthError, todayError, liveError, sourceHealth, onRefresh }: Props) {
  const counts = sourceCounts(launches)
  const wyomingOn = useWyomingEnabled()
  const hasErrors = !!(monthError || todayError || liveError)
  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <p className="panel-title flex items-center gap-1.5"><Database size={12} /> Cobertura dos dados</p>
        <button onClick={onRefresh} disabled={monthLoading} className="text-dim hover:text-white disabled:opacity-50" title="Atualizar todas as fontes">
          <RefreshCw size={13} className={monthLoading ? 'animate-spin' : ''} />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded bg-bg border border-border p-2"><span className="text-faint block">Lançamentos / mês</span><span className="mono text-white text-sm">{launches.length}</span></div>
        <div className="rounded bg-bg border border-border p-2"><span className="text-faint block">Com posição</span><span className="mono text-white text-sm">{counts.positioned}/{launches.length}</span></div>
      </div>
      <div className="mt-3 space-y-1.5 text-[11px]">
        <div className="flex justify-between"><span className="text-dim">Wyoming</span>{wyomingOn
          ? <span className={stateClass(counts.wyoming > 0)}>{counts.wyoming} registros</span>
          : <span className="text-faint" title="Ligue em Configurações">desativada</span>}</div>
        <div className="flex justify-between"><span className="text-dim">radiosondy.info</span><span className={stateClass(sourceHealth.radiosondy === 'ok')}>{sourceHealth.radiosondy === 'not-configured' ? 'sem vínculo' : sourceHealth.radiosondy === 'ok' ? 'respondendo' : 'em fallback'}</span></div>
        <div className="flex justify-between"><span className="text-dim">SondeHub</span><span className={stateClass(sourceHealth.sondehub === 'ok')}>{sourceHealth.sondehub === 'ok' ? 'respondendo' : 'em fallback'}</span></div>
        {counts.approximate > 0 && <div className="flex justify-between"><span className="text-dim">Horários aproximados</span><span className="text-yellow-400">{counts.approximate}</span></div>}
      </div>
      {hasErrors && <div className="mt-3 border border-yellow-500/25 bg-yellow-500/5 rounded p-2 text-[10px] text-yellow-300 flex gap-1.5">
        <MapPin size={11} className="shrink-0 mt-0.5" /><span>Dados parciais. O último resultado foi preservado e as fontes continuarão sendo consultadas.</span>
      </div>}
    </div>
  )
}
