/**
 * Utilitários de apresentação de lançamentos, compartilhados entre
 * histórico, painel e componentes — e também importável de código server-side
 * (nenhuma dependência de browser aqui), já que app/api/sounding/route.ts,
 * app/lib/radiosondy.ts e app/lib/sondehub.ts reaproveitam o mesmo cálculo de
 * GMT-3/fronteira de mês em vez de reimplementá-lo cada um.
 */
import { GMT3 } from './types'
import type { Launch } from './types'

export const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
export const MONTHS_FULL = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

// Lançamentos de 12Z (~09h local) caem de dia; os de 00Z (~21h local) de noite
export function isDaytimeHour(hour: number): boolean {
  return hour >= 6 && hour < 18
}

export function isDaytime(timeLocal: string): boolean {
  return isDaytimeHour(parseInt(timeLocal.split(':')[0], 10))
}

// Data local (GMT-3) "YYYY-MM-DD" de um instante UTC — usado pra filtrar feeds
// (radiosondy.info, sondehub.org) por "é de hoje".
export function gmt3DateStr(date: Date): string {
  const local = new Date(date.getTime() + GMT3)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`
}

// Converte um instante UTC (ms) pra GMT-3, mas evita cruzar fronteira de
// mês/ano: se o ajuste de -3h empurraria a data pro mês/ano anterior, mantém
// a data em UTC em vez de local. Mesmo cuidado aplicado nos três lugares que
// derivam a data local de um lançamento a partir de um instante aproximado
// (Wyoming, radiosondy.info, sondehub.org) — um lançamento perto da meia-noite
// UTC de virada de mês não pode "vazar" pro mês anterior/seguinte já filtrado.
export function gmt3DateWithMonthGuard(utcMs: number): Date {
  const utcDate = new Date(utcMs)
  const localDate = new Date(utcMs + GMT3)
  if (localDate.getUTCFullYear() !== utcDate.getUTCFullYear() || localDate.getUTCMonth() !== utcDate.getUTCMonth()) {
    return utcDate
  }
  return localDate
}

// Mesmo lançamento clicado de novo: fecha o mapa em vez de reabrir
export function sameLaunch(a: Launch | null, b: Launch): boolean {
  return !!a && a.date === b.date && a.time_local === b.time_local
}

export function launchKey(l: Launch): string {
  return `${l.date}_${l.time_local}`
}

// Formata um timestamp "YYYY-MM-DD HH:mm:ssz" (UTC) do radiosondy.info como
// dd-mm-yyyy hh:mm:ss em GMT-3, 24h.
export function formatGmt3(utcStr: string): string {
  const iso = utcStr.replace(' ', 'T').replace(/z$/i, '') + 'Z'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return utcStr
  const local = new Date(d.getTime() + GMT3)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(local.getUTCDate())}-${pad(local.getUTCMonth() + 1)}-${local.getUTCFullYear()} ` +
    `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}`
}

export function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

// URL da sondagem individual na Wyoming (prova de que o lançamento ocorreu).
export function wyomingSoundingUrl(l: Launch, stationId: string): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const hourUtc = l.time_utc.slice(0, 2).padStart(2, '0')
  const dt = `${l.year}-${pad(l.month)}-${pad(l.day)} ${hourUtc}:00:00`
  return `https://weather.uwyo.edu/wsgi/sounding?src=FM35&datetime=${dt.replace(' ', '%20')}&id=${stationId}&type=TEXT:LIST`
}
