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
import type { TelegramMessageTemplateKey, TelegramMessageTemplates } from './telegramTypes'

export const DEFAULT_MESSAGE_TEMPLATES: Record<TelegramMessageTemplateKey, string> = {
  launch: '{header}\n{stationLine}\n{timeLine}\n{positionLine}\n{altitudeLine}\n{firstSignalLine}\n{climbingLine}\n{frequencyLine}\n{sourceLine}\n{receiverLine}\n{distanceLine}\n{linksLine}',
  landing: '{header}\n{stationLine}\n{timeLine}\n{positionLine}\n{landingCityLine}\n{altitudeLine}\n{climbingLine}\n{frequencyLine}\n{sourceLine}\n{receiverLine}\n{distanceLine}\n{areaLine}\n{linksLine}',
  receiverOffline: '{offlineHeader}\n{offlineBody}',
  receiverOnline: '{onlineHeader}',
  lowBattery: '{lowBatteryHeader}\n{lowBatteryBody}',
  batteryOk: '{batteryOkHeader}\n{batteryOkBody}',
}

export const LEGACY_DEFAULT_LANDING_TEMPLATE = '{header}\n{stationLine}\n{timeLine}\n{positionLine}\n{altitudeLine}\n{climbingLine}\n{frequencyLine}\n{sourceLine}\n{receiverLine}\n{distanceLine}\n{areaLine}\n{linksLine}'

function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{([a-zA-Z]+)\}/g, (token, key: string) => values[key] ?? token)
    .split('\n').filter(line => line.trim().length > 0).join('\n')
}

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
  city?: string // cidade ou localidade aproximada do pouso
  // Primeiro quadro do voo no SondeHub (só lançamento) — mostra quanto o aviso
  // demorou em relação ao 1º sinal. Omitido quando igual ao quadro atual.
  firstAltitude?: number
  firstFrameUtc?: string // "YYYY-MM-DD HH:mm:ssz"
  firstReceiver?: string
}

export function buildEventText(p: EventMessageParams, templates?: TelegramMessageTemplates): string {
  const hasPos = typeof p.lat === 'number' && typeof p.lon === 'number'
  const hasStationPos = typeof p.stationLat === 'number' && typeof p.stationLon === 'number'

  const header = p.event === 'launch'
    ? `🚀 <b>Sonda ${escapeHtml(p.sondeNumber)} lançada</b>`
    : `🪂 <b>Sonda ${escapeHtml(p.sondeNumber)} pousou</b>`
  const values: Record<string, string> = {
    header,
    stationLine: p.stationName ? `📡 Estação: ${escapeHtml(String(p.stationName))}${p.stationId ? ` (${escapeHtml(String(p.stationId))})` : ''}` : '',
    timeLine: p.lastReportUtc ? `🕒 ${formatGmt3(p.lastReportUtc)} (GMT-3)` : '',
    positionLine: hasPos ? `📍 ${p.lat!.toFixed(5)}, ${p.lon!.toFixed(5)}` : '',
    altitudeLine: typeof p.altitude === 'number' ? `⬆️ Altitude: ${Math.round(p.altitude)} m` : '',
    firstSignalLine: '', climbingLine: '', frequencyLine: '', sourceLine: '', receiverLine: '', distanceLine: '', areaLine: '', linksLine: '', landingCityLine: '',
  }
  if (p.event === 'launch' && p.firstFrameUtc && typeof p.firstAltitude === 'number') {
    values.firstSignalLine = `🥇 Primeiro sinal: ${Math.round(p.firstAltitude)} m às ${formatGmt3(p.firstFrameUtc).slice(11)}` +
      (p.firstReceiver ? ` (${escapeHtml(p.firstReceiver)})` : '')
  }
  if (typeof p.climbing === 'number') {
    const label = p.event === 'launch' ? 'Subida' : 'Variação vertical'
    values.climbingLine = `${p.climbing >= 0 ? '📈' : '📉'} ${label}: ${p.climbing >= 0 ? '+' : ''}${p.climbing.toFixed(1)} m/s`
  }
  if (typeof p.frequencyMHz === 'number') values.frequencyLine = `📻 Frequência: ${p.frequencyMHz.toFixed(3)} MHz`
  if (p.source) values.sourceLine = `🔎 Fonte: ${SOURCE_LABEL[p.source] ?? escapeHtml(p.source)}`
  if (p.lastReceiver) values.receiverLine = `📶 Último receptor: ${escapeHtml(p.lastReceiver)}`
  if (hasPos && hasStationPos) {
    const distKm = haversineKm(p.stationLat!, p.stationLon!, p.lat!, p.lon!)
    const bearing = bearingDeg(p.stationLat!, p.stationLon!, p.lat!, p.lon!)
    values.distanceLine = `📏 ${formatDistance(distKm)} da estação, rumo ${bearingToCardinal(bearing)} (${Math.round(bearing)}°)`
  }
  if (p.areaName) values.areaLine = `⭐ Dentro da área de interesse: <b>${escapeHtml(p.areaName)}</b>`
  if (p.city) values.landingCityLine = `🏙️ Localidade: ${escapeHtml(p.city)}`
  if (hasPos) {
    values.linksLine =
      `🗺 <a href="https://www.google.com/maps?q=${p.lat},${p.lon}">Abrir no Google Maps</a>` +
      ` · <a href="${sondeHubUrl(p.sondeNumber, p.lat!, p.lon!)}">SondeHub</a>`
  }
  const savedTemplate = templates?.[p.event]
  const isOldUneditedLandingDefault = p.event === 'landing' && savedTemplate === LEGACY_DEFAULT_LANDING_TEMPLATE
  const template = (isOldUneditedLandingDefault ? '' : savedTemplate) || DEFAULT_MESSAGE_TEMPLATES[p.event]
  const rendered = renderTemplate(template, values)
  // Modelos de pouso salvos antes da inclusão deste bloco ainda precisam
  // mostrar o município na legenda da foto quando ele estiver disponível.
  if (p.event === 'landing' && values.landingCityLine && !template.includes('{landingCityLine}')) {
    return `${rendered}\n${values.landingCityLine}`
  }
  return rendered
}

// Nome amigável indisponível no servidor (knownReceivers só guarda o prefix
// — displayName é escolha do usuário, salva só no localStorage do navegador,
// ver settings.ts) — usa o prefix cru mesmo, é o que o firmware conhece.
export type ReceiverAlertKind = 'offline' | 'online' | 'lowBattery' | 'batteryOk'

export function buildReceiverAlertText(
  kind: ReceiverAlertKind,
  prefix: string,
  extra: { minutesSilent?: number; vBatt?: number } = {},
  templates?: TelegramMessageTemplates,
): string {
  const name = escapeHtml(prefix)
  const key: TelegramMessageTemplateKey = kind === 'offline' ? 'receiverOffline' : kind === 'online' ? 'receiverOnline' : kind
  const minutesSilent = String(extra.minutesSilent ?? '?')
  const voltage = extra.vBatt?.toFixed(2) ?? '?'
  const values = {
    name,
    minutesSilent,
    voltage,
    offlineHeader: `📴 <b>Receptor "${name}" parece offline</b>`,
    offlineBody: `Sem nenhum report há ${minutesSilent} min.`,
    onlineHeader: `📡 <b>Receptor "${name}" voltou a reportar</b>`,
    lowBatteryHeader: `🔋 <b>Bateria baixa no receptor "${name}"</b>`,
    lowBatteryBody: `Tensão atual: ${voltage} V`,
    batteryOkHeader: `🔋 <b>Bateria do receptor "${name}" normalizou</b>`,
    batteryOkBody: `Tensão atual: ${voltage} V`,
  }
  return renderTemplate(templates?.[key] || DEFAULT_MESSAGE_TEMPLATES[key], {
    ...values,
  })
}
