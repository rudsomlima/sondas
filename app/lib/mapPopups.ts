/**
 * Popups de TODOS os mapas do app (painel, mapa do ano, mapa do lançamento):
 * sonda, estação receptora e local de lançamento. Um só visual — cartão
 * escuro com ícones, no padrão do resto da interface (estilos `.mp-*` em
 * globals.css) — e uma só fonte de dados por sonda (SondePoint já completado
 * com o registro do R2), pra nenhum mapa mostrar menos que outro.
 *
 * HTML em string (é o que o Leaflet recebe). Todo texto vindo de fonte
 * externa passa por `esc`.
 */
import type { SondePoint } from './sondePoints'
import type { ReceiverStation } from './receiverStations'
import { STATUS_COLORS } from './tokens'
import { GMT3 } from './types'
import { getSettings } from './settings'
import { sondeHubUrl } from './radiosondy'

// ---------------------------------------------------------------------------
// Ícones (paths do lucide, viewBox 24×24, traço).

const ICONS: Record<string, string> = {
  rocket: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  mountain: '<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  antenna: '<path d="M2 12 7 2"/><path d="m7 12 5-10"/><path d="m12 12 5-10"/><path d="m17 12 5-10"/><path d="M4.5 7h15"/><path d="M12 16v6"/>',
  signal: '<path d="M2 20h.01"/><path d="M7 20v-4"/><path d="M12 20v-8"/><path d="M17 20V8"/><path d="M22 4v16"/>',
  userCheck: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  navigation: '<polygon points="3 11 22 2 13 21 11 13 3 11"/>',
  cpu: '<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  radio: '<path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/>',
  crosshair: '<circle cx="12" cy="12" r="10"/><line x1="22" x2="18" y1="12" y2="12"/><line x1="6" x2="2" y1="12" y2="12"/><line x1="12" x2="12" y1="6" y2="2"/><line x1="12" x2="12" y1="22" y2="18"/>',
  burst: '<path d="M12 2v4"/><path d="m16.2 7.8 2.9-2.9"/><path d="M18 12h4"/><path d="m16.2 16.2 2.9 2.9"/><path d="M12 18v4"/><path d="m4.9 19.1 2.9-2.9"/><path d="M2 12h4"/><path d="m4.9 4.9 2.9 2.9"/>',
  trendUp: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  sliders: '<line x1="4" x2="4" y1="21" y2="14"/><line x1="4" x2="4" y1="10" y2="3"/><line x1="12" x2="12" y1="21" y2="12"/><line x1="12" x2="12" y1="8" y2="3"/><line x1="20" x2="20" y1="21" y2="16"/><line x1="20" x2="20" y1="12" y2="3"/><line x1="2" x2="6" y1="14" y2="14"/><line x1="10" x2="14" y1="8" y2="8"/><line x1="18" x2="22" y1="16" y2="16"/>',
}

function icon(name: keyof typeof ICONS, color?: string): string {
  return `<svg class="mp-ico" viewBox="0 0 24 24"${color ? ` style="stroke:${color}"` : ''} aria-hidden="true">${ICONS[name]}</svg>`
}

export function esc(value: string): string {
  return value.replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c] ?? c))
}

const pad = (n: number) => String(n).padStart(2, '0')

function fmtLocal(date: Date, seconds = false): string {
  const l = new Date(date.getTime() + GMT3)
  return `${pad(l.getUTCDate())}/${pad(l.getUTCMonth() + 1)}/${l.getUTCFullYear()} ${pad(l.getUTCHours())}:${pad(l.getUTCMinutes())}` +
    (seconds ? `:${pad(l.getUTCSeconds())}` : '')
}

function parseDate(iso?: string): Date | null {
  if (!iso) return null
  const d = new Date(iso)
  return isNaN(d.getTime()) ? null : d
}

function ago(date: Date): string {
  const s = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000))
  if (s < 90) return 'agora'
  const m = Math.round(s / 60)
  if (m < 60) return `há ${m} min`
  const h = Math.round(m / 60)
  if (h < 48) return `há ${h} h`
  return `há ${Math.round(h / 24)} dias`
}

function myCallsign(): string {
  try { return getSettings().uploaderCallsign.trim().toUpperCase() } catch { return '' }
}

// Linha compacta: ícone · rótulo à esquerda · valor à direita (quebra de
// linha só se não couber). `title` vira dica ao passar o mouse.
function row(ico: keyof typeof ICONS, label: string, valueHtml: string, title?: string): string {
  return `<div class="mp-row"${title ? ` title="${esc(title)}"` : ''}>${icon(ico)}` +
    `<div class="mp-kv"><span class="mp-label">${label}</span><span class="mp-value">${valueHtml}</span></div></div>`
}

// Bloco (rótulo em cima, conteúdo embaixo) — listas e textos longos.
function block(ico: keyof typeof ICONS, label: string, innerHtml: string): string {
  return `<div class="mp-row">${icon(ico)}<div><div class="mp-label">${label}</div>${innerHtml}</div></div>`
}

function button(href: string, ico: keyof typeof ICONS, label: string): string {
  return `<a class="mp-btn" href="${href}" target="_blank" rel="noopener noreferrer">${icon(ico)}${label}</a>`
}

const STATUS_LABEL: Record<string, string> = {
  FOUND: 'Recuperada',
  LOST: 'Perdida',
  UNKNOWN: 'Não confirmada',
}

function statusBadge(status: string): string {
  const color = status === 'FOUND' ? STATUS_COLORS.found : status === 'LOST' ? STATUS_COLORS.lost : STATUS_COLORS.unknown
  return `<span class="mp-badge" style="color:${color};border-color:${color}66;background:${color}1a">${esc(STATUS_LABEL[status] ?? status)}</span>`
}

const SOURCE_LABELS: Record<string, string> = {
  cache: 'histórico',
  radiosondy: 'radiosondy.info',
  sondehub: 'SondeHub',
  archive: 'arquivo SondeHub',
  registry: 'registro do app',
}

// ---------------------------------------------------------------------------
// Sonda

export interface SondePopupOptions {
  // Faixa no topo pra sonda em voo/pousada hoje (painel).
  banner?: { text: string; color: string }
}

function receiversBlock(p: SondePoint): string {
  if (!p.receivers?.length) return ''
  const me = myCallsign()
  const frames = p.receiverFrames ?? {}
  const max = Math.max(1, ...p.receivers.map(r => frames[r] ?? 0))
  const items = p.receivers.slice(0, 8).map(r => {
    const n = frames[r]
    const mine = me && r.trim().toUpperCase() === me
    return `<div class="mp-rx${mine ? ' mp-me' : ''}">` +
      `<span class="mp-rxname mp-mono" title="${esc(r)}">${esc(r)}</span>` +
      (n ? `<span class="mp-bar"><span style="width:${Math.max(4, Math.round((n / max) * 100))}%"></span></span>` +
        `<span class="mp-rxn mp-mono">${n.toLocaleString('pt-BR')}</span>` : '<span></span><span></span>') +
      `</div>`
  }).join('')
  const more = p.receivers.length > 8 ? `<div class="mp-muted">+${p.receivers.length - 8} estações</div>` : ''
  return block('antenna', 'Recepção · quadros', `<div class="mp-rxlist">${items}${more}</div>`)
}

export function sondePopupHtml(p: SondePoint, opts: SondePopupOptions = {}): string {
  const first = parseDate(p.firstFrameUtc)
  const onlyCache = p.sources.length === 1 && p.sources[0] === 'cache'
  const sub = [p.sondeType, p.frequencyMHz ? `${p.frequencyMHz.toFixed(2)} MHz` : ''].filter(Boolean).join(' · ')
  const lastRx = p.lastReceiver
    ? `<span class="mp-mono">${esc(p.lastReceiver)}</span>` +
      (parseDate(p.lastReceiverAt) ? ` <span class="mp-muted">· ${fmtLocal(parseDate(p.lastReceiverAt)!, true)}</span>` : '')
    : ''
  const rows = [
    first ? row('rocket', 'Lançamento', fmtLocal(first), 'Horário do 1º dado recebido da sonda') :
      onlyCache ? row('rocket', 'Lançamento', `~${fmtLocal(p.date)}`, 'Horário sinótico nominal (1º dado ainda desconhecido)') : '',
    !onlyCache ? row('clock', 'Último reporte', fmtLocal(p.date, true), ago(p.date)) : '',
    p.altitude != null ? row('mountain', 'Altitude',
      `${Math.round(p.altitude).toLocaleString('pt-BR')} m` +
      (p.maxAltM ? ` <span class="mp-muted">· máx. ${Math.round(p.maxAltM).toLocaleString('pt-BR')} m</span>` : '')) : '',
    row('pin', 'Posição', `<span class="mp-mono">${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}</span>`),
    receiversBlock(p),
    lastRx ? block('signal', 'Último sinal', `<div class="mp-value">${lastRx}</div>`) : '',
    p.recoveredBy || p.recoveryNote ? block('userCheck', p.recoveredBy ? 'Recuperada por' : 'Observação',
      (p.recoveredBy ? `<div class="mp-value mp-mono">${esc(p.recoveredBy)}</div>` : '') +
      (p.recoveryNote ? `<div class="mp-note">“${esc(p.recoveryNote)}”</div>` : '')) : '',
  ].filter(Boolean).join('')
  const sources = p.sources.map(s => `<span class="mp-chip">${esc(SOURCE_LABELS[s] ?? s)}</span>`).join('')
  const warn = p.geographic
    ? `<div class="mp-warn">${icon('alert', '#f59e0b')}<span>Associada só por proximidade — pode ser de outra estação</span></div>` : ''
  return `<div class="mp">` +
    (opts.banner ? `<div class="mp-banner" style="background:${opts.banner.color}22;color:${opts.banner.color};border-bottom-color:${opts.banner.color}55">${icon('activity', opts.banner.color)}<span>${esc(opts.banner.text)}</span></div>` : '') +
    `<div class="mp-head">` +
      `<div class="mp-headtext"><div class="mp-title">${esc(p.serial)}</div>${sub ? `<div class="mp-sub">${esc(sub)}</div>` : ''}</div>` +
      statusBadge(p.status) +
    `</div>` +
    `<div class="mp-body">${rows}${warn}` +
      `<div class="mp-sources">${icon('database')}<div class="mp-chips">${sources}</div></div>` +
    `</div>` +
    `<div class="mp-foot">` +
      button(`https://radiosondy.info/sonde_archive.php?sondenumber=${encodeURIComponent(p.serial)}`, 'external', 'radiosondy') +
      button(sondeHubUrl(p.serial, p.lat, p.lon), 'external', 'SondeHub') +
      button(`https://www.openstreetmap.org/directions?route=%3B${p.lat},${p.lon}`, 'navigation', 'Navegar') +
    `</div>` +
  `</div>`
}

// ---------------------------------------------------------------------------
// Estação receptora

export function stationPopupHtml(st: ReceiverStation, opts: { mine?: boolean; sondes?: number } = {}): string {
  const seen = parseDate(st.lastSeenAt)
  const active = !!seen && Date.now() - seen.getTime() < 24 * 3600_000
  const badge = opts.mine
    ? `<span class="mp-badge" style="color:#f87171;border-color:#f8717166;background:#f871711a">Meu receptor</span>`
    : `<span class="mp-badge" style="color:${active ? '#22c55e' : '#9aa4b2'};border-color:${active ? '#22c55e66' : '#9aa4b266'};background:${active ? '#22c55e1a' : '#9aa4b21a'}">${active ? 'Ativa' : 'Inativa'}</span>`
  const rows = [
    st.software ? row('cpu', 'Software', `<span class="mp-mono">${esc(st.software)}</span>`) : '',
    st.antenna ? row('antenna', 'Antena', esc(st.antenna)) : '',
    seen ? row('clock', 'Último contato', `${fmtLocal(seen)} <span class="mp-muted">· ${ago(seen)}</span>`) : '',
    st.alt != null ? row('mountain', 'Altitude', `${Math.round(st.alt).toLocaleString('pt-BR')} m`) : '',
    row('pin', 'Posição', `<span class="mp-mono">${st.lat.toFixed(5)}, ${st.lon.toFixed(5)}</span>`),
    opts.sondes ? row('radio', 'Neste mapa', `recebeu ${opts.sondes} sonda${opts.sondes === 1 ? '' : 's'}`) : '',
  ].filter(Boolean).join('')
  return `<div class="mp">` +
    `<div class="mp-head">${icon('antenna', opts.mine ? '#f87171' : '#2dd4bf')}` +
      `<div class="mp-headtext"><div class="mp-title">${esc(st.callsign)}</div><div class="mp-sub">Estação receptora</div></div>${badge}</div>` +
    `<div class="mp-body">${rows}</div>` +
    `<div class="mp-foot">${button(`https://www.openstreetmap.org/?mlat=${st.lat}&mlon=${st.lon}#map=14/${st.lat}/${st.lon}`, 'external', 'Ver no mapa')}</div>` +
  `</div>`
}

// ---------------------------------------------------------------------------
// Local de lançamento (estação Wyoming)

export function launchSitePopupHtml(site: { name: string; id: string; lat: number; lon: number }): string {
  return `<div class="mp">` +
    `<div class="mp-head">${icon('home', '#3b82f6')}<div class="mp-headtext"><div class="mp-title">${esc(site.name)}</div>` +
    `<div class="mp-sub">Local de lançamento · STNM ${esc(site.id)}</div></div></div>` +
    `<div class="mp-body">${row('pin', 'Posição', `<span class="mp-mono">${site.lat.toFixed(4)}, ${site.lon.toFixed(4)}</span>`)}</div>` +
  `</div>`
}

// ---------------------------------------------------------------------------
// Popup simples (mesmo visual) pra marcadores auxiliares: estouro da
// trajetória, "você", células do mapa de calor.

export type PopupIcon = keyof typeof ICONS

export function simplePopupHtml(opts: {
  title: string; subtitle?: string; icon?: PopupIcon; color?: string
  rows?: { icon: PopupIcon; label: string; value: string }[]
}): string {
  const rows = (opts.rows ?? []).map(r => row(r.icon, esc(r.label), esc(r.value))).join('')
  return `<div class="mp">` +
    `<div class="mp-head">${opts.icon ? icon(opts.icon, opts.color) : ''}<div class="mp-headtext">` +
      `<div class="mp-title">${esc(opts.title)}</div>${opts.subtitle ? `<div class="mp-sub">${esc(opts.subtitle)}</div>` : ''}</div></div>` +
    (rows ? `<div class="mp-body">${rows}</div>` : '') +
  `</div>`
}

/** Opções de popup comuns (largura) — passadas em todo bindPopup. */
// maxHeight: acima disso o cartão rola por dentro (mapas baixos, como o do
// lançamento no histórico ou o painel no celular, cortavam o popup).
export const POPUP_OPTIONS = { maxWidth: 320, minWidth: 250, maxHeight: 340, className: 'mp-popup' } as const
