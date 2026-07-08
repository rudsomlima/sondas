'use client'

import { BarChart3 } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { CHART } from '@/app/lib/tokens'
import type { Launch } from '@/app/lib/types'

const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

interface MonthlyChartProps {
  year: number
  byMonth: Record<number, Launch[]>
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload?.length) {
    return (
      <div className="bg-surface border border-border rounded-md p-3 text-xs">
        <p className="text-white font-medium mb-1">{label}</p>
        {payload.map((p: any, i: number) => (
          <p key={i} style={{ color: p.color }}>
            {p.name}: <span className="font-mono font-bold">{p.value}</span>
          </p>
        ))}
      </div>
    )
  }
  return null
}

export default function MonthlyChart({ year, byMonth }: MonthlyChartProps) {
  const chartData = MONTHS.map((name, idx) => {
    const launches = byMonth[idx + 1] ?? []
    return { name, lançamentos: launches.length, dias: new Set(launches.map(l => l.date)).size }
  })

  return (
    <div className="panel p-5 mb-6">
      <h2 className="text-sm font-semibold text-white mb-5 flex items-center gap-2">
        <BarChart3 size={15} className="text-blue-400" />
        Lançamentos por mês — {year}
      </h2>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={chartData} barGap={4}>
          <XAxis dataKey="name" tick={{ fill: CHART.tick, fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: CHART.tick, fontSize: 11 }} axisLine={false} tickLine={false} width={28} />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
          <Bar dataKey="lançamentos" radius={[3, 3, 0, 0]}>
            {chartData.map((d, i) => (
              <Cell key={i} fill={d.lançamentos > 0 ? CHART.bar : CHART.barEmpty} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
