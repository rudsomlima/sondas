/**
 * Texto das mensagens de lançamento/pouso — usado tanto por
 * /api/telegram-notify (evento real) quanto por /api/telegram-test (mensagem
 * fictícia), pra garantir que o teste mostre EXATAMENTE o formato real (a
 * versão anterior duplicava o texto nos dois arquivos e o teste ficou sem o
 * link do Google Maps que o real tinha).
 */
import { escapeHtml } from './telegramClient'
import { haversineKm, bearingDeg, bearingToCardinal, formatDistance } from './geo'
import { formatGmt3 } from './launchUtils'
import { sondeHubUrl } from './radiosondy'

const SOURCE_LABEL: Record<string, string> = {
  radiosondy: 'radiosondy.info (recuperação confirmada)',
  'radiosondy-approx': 'radiosondy.info (aproximado)',
  sondehub: 'SondeHub (RF)',
  'sondehub-site': 'SondeHub',
}

export interface EventMessageParams {
  event: 'launch' | 'landing'
  sondeNumber: string
  lat?: number
  lon?: number
  altitude?: number
  climbing?: number
  frequencyMHz?: number
  source?: string
  lastReceiver?: string
  lastReportUtc?: string
  stationId?: string
  stationName?: string
  stationLat?: number
  stationLon?: number
  areaName?: string // nome da área de interesse já resolvida (geofence match)
}

export function buildEventText(p: EventMessageParams): string {
  const hasPos = typeof p.lat === 'number' && typeof p.lon === 'number'
  const hasStationPos = typeof p.stationLat === 'number' && typeof p.stationLon === 'number'

  const lines: string[] = []
  lines.push(p.event === 'launch'
    ? `🚀 <b>Sonda ${escapeHtml(p.sondeNumber)} lançada</b>`
    : `🪂 <b>Sonda ${escapeHtml(p.sondeNumber)} pousou</b>`)

  if (p.stationName) lines.push(`📡 Estação: ${escapeHtml(String(p.stationName))}${p.stationId ? ` (${escapeHtml(String(p.stationId))})` : ''}`)
  if (p.lastReportUtc) lines.push(`🕒 ${formatGmt3(p.lastReportUtc)} (GMT-3)`)
  if (hasPos) lines.push(`📍 ${p.lat!.toFixed(5)}, ${p.lon!.toFixed(5)}`)
  if (typeof p.altitude === 'number') lines.push(`⬆️ Altitude: ${Math.round(p.altitude)} m`)
  if (typeof p.climbing === 'number') {
    const label = p.event === 'launch' ? 'Subida' : 'Variação vertical'
    lines.push(`${p.climbing >= 0 ? '📈' : '📉'} ${label}: ${p.climbing >= 0 ? '+' : ''}${p.climbing.toFixed(1)} m/s`)
  }
  if (typeof p.frequencyMHz === 'number') lines.push(`📻 Frequência: ${p.frequencyMHz.toFixed(3)} MHz`)
  if (p.source) lines.push(`🔎 Fonte: ${SOURCE_LABEL[p.source] ?? escapeHtml(p.source)}`)
  if (p.lastReceiver) lines.push(`📶 Último receptor: ${escapeHtml(p.lastReceiver)}`)
  if (hasPos && hasStationPos) {
    const distKm = haversineKm(p.stationLat!, p.stationLon!, p.lat!, p.lon!)
    const bearing = bearingDeg(p.stationLat!, p.stationLon!, p.lat!, p.lon!)
    lines.push(`📏 ${formatDistance(distKm)} da estação, rumo ${bearingToCardinal(bearing)} (${Math.round(bearing)}°)`)
  }
  if (p.areaName) lines.push(`⭐ Dentro da área de interesse: <b>${escapeHtml(p.areaName)}</b>`)
  if (hasPos) {
    lines.push(
      `🗺 <a href="https://www.google.com/maps?q=${p.lat},${p.lon}">Abrir no Google Maps</a>` +
      ` · <a href="${sondeHubUrl(p.sondeNumber, p.lat!, p.lon!)}">SondeHub</a>`,
    )
  }
  return lines.join('\n')
}

// Nome amigável indisponível no servidor (knownReceivers só guarda o prefix
// — displayName é escolha do usuário, salva só no localStorage do navegador,
// ver settings.ts) — usa o prefix cru mesmo, é o que o firmware conhece.
export type ReceiverAlertKind = 'offline' | 'online' | 'lowBattery' | 'batteryOk'

export function buildReceiverAlertText(
  kind: ReceiverAlertKind,
  prefix: string,
  extra: { minutesSilent?: number; vBatt?: number } = {},
): string {
  const name = escapeHtml(prefix)
  switch (kind) {
    case 'offline':
      return `📴 <b>Receptor "${name}" parece offline</b>\nSem nenhum report há ${extra.minutesSilent ?? '?'} min.`
    case 'online':
      return `📡 <b>Receptor "${name}" voltou a reportar</b>`
    case 'lowBattery':
      return `🔋 <b>Bateria baixa no receptor "${name}"</b>\nTensão atual: ${extra.vBatt?.toFixed(2) ?? '?'} V`
    case 'batteryOk':
      return `🔋 <b>Bateria do receptor "${name}" normalizou</b>\nTensão atual: ${extra.vBatt?.toFixed(2) ?? '?'} V`
  }
}
