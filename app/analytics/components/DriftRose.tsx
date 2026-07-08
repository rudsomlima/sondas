'use client'

import { Compass } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { CHART } from '@/app/lib/tokens'

const OCTANTS = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO']

// Rosa de direção de deriva: para onde o vento leva as sondas.
export default function DriftRose({ driftByOctant }: { driftByOctant: number[] }) {
  const data = OCTANTS.map((name, i) => ({ name, pousos: driftByOctant[i] ?? 0 }))
  const max = Math.max(...driftByOctant, 1)

  return (
    <div className="panel p-5">
      <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
        <Compass size={15} className="text-blue-400" />
        Direção de deriva
      </h2>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data} barGap={2}>
          <XAxis dataKey="name" tick={{ fill: CHART.tick, fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: CHART.tick, fontSize: 11 }} axisLine={false} tickLine={false} width={24} allowDecimals={false} />
          <Tooltip
            cursor={{ fill: 'rgba(255,255,255,0.03)' }}
            contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }}
          />
          <Bar dataKey="pousos" radius={[3, 3, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.pousos === max && max > 0 ? '#f59e0b' : CHART.bar} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="text-[11px] text-faint mt-2">Setor destacado = direção predominante do vento em altitude.</p>
    </div>
  )
}
