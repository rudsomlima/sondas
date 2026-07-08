'use client'

import { BarChart3, Calendar, TrendingUp } from 'lucide-react'
import Stat from '@/app/components/ui/Stat'
import type { YearData } from '@/app/lib/types'

export default function SummaryCards({ data }: { data: YearData }) {
  const monthsWithData = new Set(data.launches.map(l => l.month)).size
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
      <Stat icon={<BarChart3 size={12} />} label="Total de sondagens" value={data.count} />
      <Stat icon={<Calendar size={12} />} label="Dias com lançamento" value={new Set(data.launches.map(l => l.date)).size} />
      <Stat icon={<TrendingUp size={12} />} label="Média por mês" value={data.count > 0 ? (data.count / monthsWithData).toFixed(1) : '0'} />
    </div>
  )
}
