/**
 * Utilitários de apresentação de lançamentos, compartilhados entre
 * histórico, painel e componentes.
 */
import type { Launch } from './types'

export const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
export const MONTHS_FULL = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

// Lançamentos de 12Z (~09h local) caem de dia; os de 00Z (~21h local) de noite
export function isDaytime(timeLocal: string): boolean {
  const hour = parseInt(timeLocal.split(':')[0], 10)
  return hour >= 6 && hour < 18
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
  const local = new Date(d.getTime() - 3 * 60 * 60 * 1000)
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
