/**
 * Janelas de recepção configuradas no firmware (sleep.w1start/w1dur/
 * w2start/w2dur/sleep.extend) — compartilhado entre o gráfico histórico
 * (PowerTimeline) e a prévia ao vivo no editor de config (SleepConfigEditor),
 * pra não duplicar a mesma lógica de parsing/conversão de horário nos dois.
 */
import type { RdzConfig } from './rdzConfig'

// durMin é só a janela "core" (sleep.w{n}dur) — a escuta extra
// (sleep.extend) vem à parte em extendMin, pra quem for desenhar poder
// mostrá-la como um segmento diferente em vez de escondida dentro da janela.
export interface SleepWindow { startMin: number; durMin: number; extendMin: number }

export function parseSleepWindows(config: RdzConfig): SleepWindow[] | null {
  if (parseInt(String(config['sleep.mode'] ?? '0'), 10) !== 1) return null
  const w1s = parseInt(String(config['sleep.w1start'] ?? '0'), 10)
  const w1d = parseInt(String(config['sleep.w1dur']   ?? '0'), 10)
  const w2s = parseInt(String(config['sleep.w2start'] ?? '0'), 10)
  const w2d = parseInt(String(config['sleep.w2dur']   ?? '0'), 10)
  const ext = parseInt(String(config['sleep.extend']  ?? '0'), 10)
  const ws: SleepWindow[] = []
  if (w1d > 0) ws.push({ startMin: w1s, durMin: w1d, extendMin: ext })
  if (w2d > 0) ws.push({ startMin: w2s, durMin: w2d, extendMin: ext })
  return ws.length > 0 ? ws : null
}

// "510" (minutos desde 00:00) <-> "08:30" (pro <input type="time">). Valores
// fora de 0–1439 são normalizados (mod 24h) — o firmware aceita minutos
// crus, mas o picker de horário só entende um dia.
export function minutesToHHMM(min: number): string {
  const m = ((min % 1440) + 1440) % 1440
  const h = Math.floor(m / 60)
  const mm = m % 60
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  if (!isFinite(h) || !isFinite(m)) return 0
  return h * 60 + m
}
