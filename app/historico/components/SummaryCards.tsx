'use client'

import { BarChart3, Calendar, TrendingUp, MapPin, Layers3 } from 'lucide-react'
import Stat from '@/app/components/ui/Stat'
import type { YearData } from '@/app/lib/types'
import { sourceCounts } from '@/app/lib/launchData'

export default function SummaryCards({ data }: { data: YearData }) {
  const monthsWithData = new Set(data.launches.map(l => l.month)).size
  const counts = sourceCounts(data.launches)
  const multiSource = data.launches.filter(l =>
    [l.sources?.wyoming, l.sources?.radiosondy, l.sources?.sondehub].filter(Boolean).length >= 2
  ).length
  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
      <Stat icon={<BarChart3 size={12} />} label="Total de sondagens" value={data.count} />
      <Stat icon={<Calendar size={12} />} label="Dias com lançamento" value={new Set(data.launches.map(l => l.date)).size} />
      <Stat icon={<TrendingUp size={12} />} label="Média por mês ativo" value={data.count > 0 ? (data.count / monthsWithData).toFixed(1) : '0'} />
      <Stat icon={<MapPin size={12} />} label="Com posição" value={`${counts.positioned}/${data.count}`} />
      <Stat icon={<Layers3 size={12} />} label="Multi-fonte" value={multiSource} />
    </div>
  )
}
