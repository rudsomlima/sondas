'use client'

import { Circle, Pause } from 'lucide-react'

// Liga/desliga do registro de um histórico (bateria ou energia) no servidor —
// usado no cabeçalho de BatteryChart e PowerTimeline.
export default function HistoryRecordingToggle({ recording, onChange }: { recording: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!recording)}
      title={recording
        ? 'Gravando no servidor a cada mudança — clique pra pausar e economizar dados no R2'
        : 'Registro pausado — nada novo é gravado no servidor. Clique pra voltar a gravar'}
      className={`flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] transition-colors ${
        recording
          ? 'border-emerald-500/40 text-emerald-300 hover:bg-emerald-600/20'
          : 'border-amber-500/50 bg-amber-600/15 text-amber-300 hover:bg-amber-600/25'
      }`}
    >
      {recording ? <Circle size={8} className="fill-current" /> : <Pause size={10} />}
      {recording ? 'Gravando' : 'Pausado'}
    </button>
  )
}

export function RecordingPausedNote() {
  return (
    <p className="text-[11px] text-amber-300/90 mb-3">
      Registro pausado: novas leituras não são gravadas no servidor nem aqui. Os dados já gravados continuam aparecendo.
    </p>
  )
}
