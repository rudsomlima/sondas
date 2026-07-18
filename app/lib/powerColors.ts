/**
 * Paleta de cores dos estados de energia/deep sleep — compartilhada entre o
 * gráfico histórico (PowerTimeline, "Deep Sleep / Power — últimos 7 dias")
 * e a prévia ao vivo no editor de config (SleepConfigEditor), pra manter os
 * mesmos tons em ambos os lugares.
 */
export const POWER_COLORS = {
  sleeping:      '#818cf8', // indigo-400
  eco:           '#ef4444', // red-500
  listening:     '#fbbf24', // amber-400
  listen_wifips: '#a78bfa', // violet-400
  listen_nowifi: '#fb7185', // rose-400
  awake_nowifi:  '#f97316', // orange-500
  awake_wifips:  '#22d3ee', // cyan-400
  awake_cpu80:   '#a3e635', // lime-400
  awake:         '#34d399', // emerald-400
  awakePred:     '#065f46', // emerald-900
  listeningPred: '#78350f', // amber-900 — escuta extra (sleep.extend) prevista, após o fim da janela
  sleepingPred:  '#312e81', // indigo-900
  noData:        '#161b22', // quase a cor do painel (--surface #12161d) — recua visualmente em vez de competir com os dados reais
} as const
