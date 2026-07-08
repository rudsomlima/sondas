import { ReactNode } from 'react'

interface StatProps {
  label: ReactNode
  value: ReactNode
  icon?: ReactNode
  hint?: string
}

// Tile numérico padrão do mission control: label pequeno + valor grande mono.
export default function Stat({ label, value, icon, hint }: StatProps) {
  return (
    <div className="panel p-5" title={hint}>
      <div className="text-xs text-dim mb-1 flex items-center gap-1.5">{icon}{label}</div>
      <div className="text-3xl font-bold text-white mono">{value}</div>
    </div>
  )
}
