/**
 * Design tokens em TS — para código que não usa classes Tailwind
 * (divIcons do Leaflet, fills do Recharts). Espelham os CSS vars de
 * globals.css; manter os dois em sincronia.
 */

export const STATUS_COLORS = {
  live: '#38bdf8',
  found: '#3b82f6',
  lost: '#ef4444',
  unknown: '#eab308',
} as const

export const SOURCE_COLORS = {
  wyoming: '#38bdf8',
  radiosondy: '#34d399',
  sondehub: '#a78bfa',
} as const

export const DAY_NIGHT = {
  day: '#f59e0b',
  night: '#818cf8',
} as const

export const CHART = {
  bar: '#3b82f6',
  barEmpty: '#232a35',
  grid: '#232a35',
  tick: '#9aa4b2',
} as const

export const TRAJECTORY = {
  ascent: '#38bdf8',   // subida — ciano
  descent: '#f59e0b',  // descida — âmbar
  burst: '#ef4444',    // estouro
} as const

// Linha do tempo de Deep Sleep / power management (app/meu-receptor).
export const POWER_STATE = {
  awake: '#34d399',     // acordado, potência plena
  listening: '#f59e0b', // escuta estendida (aguardando lançamento atrasado)
  sleeping: '#818cf8',  // deep sleep
  eco: '#ef4444',       // economia agressiva por bateria crítica (sleep.vcrit)
} as const
