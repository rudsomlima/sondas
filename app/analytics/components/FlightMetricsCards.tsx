'use client'

import { Mountain, Timer, Route, MapPin } from 'lucide-react'
import Stat from '@/app/components/ui/Stat'
import type { YearMetrics } from '@/app/lib/metrics'

export default function FlightMetricsCards({ metrics }: { metrics: YearMetrics }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <Stat
        icon={<Mountain size={12} />}
        label="Altitude média de estouro"
        value={metrics.meanBurstAltM ? `${(metrics.meanBurstAltM / 1000).toFixed(1)} km` : '—'}
        hint="Média das altitudes máximas registradas (via trajetória do sondehub.org)"
      />
      <Stat
        icon={<Timer size={12} />}
        label="Duração média de voo"
        value={metrics.meanDurationMin ? `${Math.round(metrics.meanDurationMin)} min` : '—'}
        hint="Do lançamento ao pouso, quando a trajetória completa é conhecida"
      />
      <Stat
        icon={<Route size={12} />}
        label="Deriva média"
        value={metrics.meanDriftKm ? `${Math.round(metrics.meanDriftKm)} km` : '—'}
        hint="Distância média da estação até o ponto de pouso"
      />
      <Stat
        icon={<MapPin size={12} />}
        label="Com posição conhecida"
        value={metrics.totalLaunches > 0 ? `${Math.round(metrics.withPosition / metrics.totalLaunches * 100)}%` : '—'}
        hint={`${metrics.withPosition} de ${metrics.totalLaunches} lançamentos`}
      />
    </div>
  )
}
