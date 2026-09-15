'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { RadioTower, LocateFixed, Pencil, Trash2, Plus, KeyRound, Bell, BatteryMedium, ExternalLink, Wifi } from 'lucide-react'
import type { AppSettings, KnownReceiver } from '@/app/lib/settings'
import type { RdzConfig } from '@/app/lib/rdzConfig'
import { receiverKey } from '@/app/lib/receiverKey'

interface ReceiverSettingsPanelProps {
  settings: AppSettings
  // Grava na hora (localStorage) — sem botão "Salvar".
  updateSettings: (updater: (s: AppSettings) => AppSettings) => void
  firmwareConfig: RdzConfig | null // último snapshot da config do receptor ativo
  knownReceivers: KnownReceiver[]
  onRenameReceiver: (prefix: string, name: string) => void
  onForgetReceiver: (prefix: string) => void
  onSwitchReceiver: (prefix: string) => void
  onAddReceiver: (prefix: string) => void
  onEditFirmwareConfig: () => void // rola até a "Configuração completa do firmware"
}

interface ReceiverSummary {
  lastSeenAt: number | null
  battV: number | null
  fwVersion: string | null
  localIp: string | null
  publicIp: string | null
  rssi: number | null
}

// Estado ao vivo (bateria, visto há, IPs) muda a cada reporte; firmware quase
// nunca — por isso o firmware é relido bem mais devagar.
const LIVE_POLL_MS = 20_000
const EMPTY_SUMMARY: ReceiverSummary = { lastSeenAt: null, battV: null, fwVersion: null, localIp: null, publicIp: null, rssi: null }
const FW_POLL_MS = 5 * 60_000

// Resumo de cada receptor da lista (visto há, bateria, firmware, IPs),
// atualizado sozinho enquanto a página está aberta (pausa com a aba oculta).
function useReceiverSummaries(receivers: KnownReceiver[]): Record<string, ReceiverSummary> {
  const [summaries, setSummaries] = useState<Record<string, ReceiverSummary>>({})
  const prefixesKey = receivers.map(r => r.prefix).join('|')
  useEffect(() => {
    let cancelled = false
    const prefixes = prefixesKey ? prefixesKey.split('|') : []

    const patch = (prefix: string, p: Partial<ReceiverSummary>) => {
      if (cancelled) return
      setSummaries(prev => ({
        ...prev,
        [prefix]: { ...EMPTY_SUMMARY, ...prev[prefix], ...p },
      }))
    }

    const loadLive = () => {
      if (document.hidden) return
      for (const prefix of prefixes) {
        fetch(`/api/receiver-live-status?receiver=${encodeURIComponent(receiverKey(prefix))}`)
          .then(res => res.json())
          .then(live => {
            const s = live?.status
            patch(prefix, {
              lastSeenAt: s?.updatedAt ?? null,
              battV: s?.pmu?.vBatt ?? null,
              localIp: s?.net?.localIp ?? null,
              publicIp: s?.net?.publicIp ?? null,
              rssi: s?.net?.rssi ?? null,
            })
          })
          .catch(() => {})
      }
    }
    const loadFw = () => {
      if (document.hidden) return
      for (const prefix of prefixes) {
        fetch(`/api/firmware/${encodeURIComponent(receiverKey(prefix))}/upload`)
          .then(res => res.json())
          .then(fw => patch(prefix, { fwVersion: fw?.installed?.version ?? null }))
          .catch(() => {})
      }
    }

    loadLive()
    loadFw()
    const liveId = setInterval(loadLive, LIVE_POLL_MS)
    const fwId = setInterval(loadFw, FW_POLL_MS)
    // Voltando pra aba: atualiza na hora em vez de esperar o próximo ciclo.
    const onVisible = () => { if (!document.hidden) { loadLive(); loadFw() } }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      clearInterval(liveId)
      clearInterval(fwId)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [prefixesKey])
  return summaries
}

// Re-renderiza a cada `ms` — pro "visto há X" andar sozinho entre os polls.
function useTick(ms: number) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), ms)
    return () => clearInterval(id)
  }, [ms])
}

function agoLabel(ms: number | null): string {
  if (ms == null) return 'nunca reportou'
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 90) return `visto há ${s} s`
  const min = Math.round(s / 60)
  if (min < 90) return `visto há ${min} min`
  const h = Math.round(min / 60)
  if (h < 36) return `visto há ${h} h`
  return `visto há ${Math.round(h / 24)} dias`
}

function Section({ icon, title, children, first }: { icon: ReactNode; title: string; children: ReactNode; first?: boolean }) {
  return (
    <div className={first ? '' : 'mt-5 pt-5 border-t border-border'}>
      <h3 className="text-xs font-semibold text-white flex items-center gap-1.5 mb-2">{icon}{title}</h3>
      {children}
    </div>
  )
}

const inputCls = 'bg-bg border border-border rounded-md text-sm text-white mono px-3 py-2 outline-none focus:border-blue-500'

/**
 * Bloco "Meu receptor": qual receptor está ativo, de onde vêm callsign e
 * posição, segredo de gravação e alertas do painel. Callsign/posição saem do
 * firmware (sondehub.callsign, rxlat/rxlon) quando ele reporta a config — só
 * ficam editáveis aqui sem firmware reportando (ex.: auto_rx), pra não haver
 * dois lugares pro mesmo dado.
 */
export default function ReceiverSettingsPanel({
  settings, updateSettings, firmwareConfig, knownReceivers,
  onRenameReceiver, onForgetReceiver, onSwitchReceiver, onAddReceiver, onEditFirmwareConfig,
}: ReceiverSettingsPanelProps) {
  const [editingPrefix, setEditingPrefix] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [adding, setAdding] = useState(false)
  const [newPrefix, setNewPrefix] = useState('')
  const [locating, setLocating] = useState(false)
  // Lido só no efeito: Notification não existe no servidor (hidratação).
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | 'unsupported'>('default')
  useEffect(() => {
    setNotifPermission(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported')
  }, [])

  const summaries = useReceiverSummaries(knownReceivers)
  useTick(5_000)

  // Valores do firmware (só contam se válidos — double vazio vem "nan").
  const fwCallsign = String(firmwareConfig?.['sondehub.callsign'] ?? '').trim()
  const fwLat = parseFloat(String(firmwareConfig?.['rxlat'] ?? ''))
  const fwLon = parseFloat(String(firmwareConfig?.['rxlon'] ?? ''))
  const fwHasPosition = isFinite(fwLat) && isFinite(fwLon) && !(fwLat === 0 && fwLon === 0)

  const useMyLocation = () => {
    if (!navigator.geolocation) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      pos => {
        updateSettings(s => ({ ...s, homeLat: Number(pos.coords.latitude.toFixed(5)), homeLon: Number(pos.coords.longitude.toFixed(5)) }))
        setLocating(false)
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 15000 },
    )
  }

  const toggleAlerts = async () => {
    if (settings.receiverAlertsEnabled) {
      updateSettings(s => ({ ...s, receiverAlertsEnabled: false }))
      return
    }
    if (typeof Notification === 'undefined') return
    let permission = Notification.permission
    if (permission === 'default') {
      try { permission = await Notification.requestPermission() } catch { permission = 'denied' }
    }
    setNotifPermission(permission)
    if (permission === 'granted') updateSettings(s => ({ ...s, receiverAlertsEnabled: true }))
  }

  const submitNewPrefix = () => {
    const p = newPrefix.trim()
    if (!p) return
    onAddReceiver(p)
  }

  const fromFirmware = (label: string, value: string) => (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
      <span className="text-gray-400 w-32 flex-shrink-0">{label}</span>
      <span className="mono text-white">{value}</span>
      <button type="button" onClick={onEditFirmwareConfig} className="text-[11px] text-blue-400 hover:underline flex items-center gap-0.5">
        do firmware · editar <ExternalLink size={10} />
      </button>
    </div>
  )

  return (
    <div className="panel p-5 mb-6">
      <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-4">
        <RadioTower size={14} className="text-blue-400" />
        Meu receptor
      </h2>

      {/* ── Receptor ativo ── */}
      <Section first icon={null} title="Receptores">
        {knownReceivers.length === 0 && !adding && (
          <p className="text-[11px] text-faint mb-2">
            Nenhum receptor ainda. Ele aparece aqui sozinho quando reportar pela primeira vez
            (firmware com <span className="mono">mqtt.siteurl</span> apontando pra este app).
          </p>
        )}
        <div className="space-y-1.5">
          {knownReceivers.map(kr => {
            const isActive = kr.prefix === settings.mqttTopicPrefix
            const sum = summaries[kr.prefix]
            return (
              <div key={kr.prefix} className={`flex items-center gap-2 p-2 rounded border text-xs ${
                isActive ? 'border-blue-500/50 bg-blue-600/10' : 'border-border bg-bg'
              }`}>
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isActive ? 'bg-blue-400' : 'bg-gray-600'}`} />
                {editingPrefix === kr.prefix ? (
                  <>
                    <input
                      autoFocus
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { onRenameReceiver(kr.prefix, editName.trim() || kr.prefix); setEditingPrefix(null) }
                        if (e.key === 'Escape') setEditingPrefix(null)
                      }}
                      className="flex-1 bg-surface border border-border rounded px-2 py-0.5 text-white text-xs outline-none focus:border-blue-500"
                    />
                    <button onClick={() => { onRenameReceiver(kr.prefix, editName.trim() || kr.prefix); setEditingPrefix(null) }}
                      className="text-blue-400 hover:text-blue-300 text-[10px]">ok</button>
                    <button onClick={() => setEditingPrefix(null)} className="text-gray-500 hover:text-white text-[10px]">×</button>
                  </>
                ) : (
                  <>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-white truncate">{kr.displayName}</span>
                        {kr.displayName !== kr.prefix && <span className="text-faint mono text-[10px]">{kr.prefix}</span>}
                        {isActive && <span className="text-blue-400 text-[10px]">ativo</span>}
                      </div>
                      <div className="text-[10px] text-faint flex items-center gap-2 flex-wrap mt-0.5">
                        <span>{sum ? agoLabel(sum.lastSeenAt) : '…'}</span>
                        {sum?.fwVersion && <span className="mono">fw {sum.fwVersion}</span>}
                        {sum?.battV != null && (
                          <span className="flex items-center gap-0.5 mono"><BatteryMedium size={10} /> {sum.battV.toFixed(2)} V</span>
                        )}
                      </div>
                      {(sum?.localIp || sum?.publicIp) && (
                        <div className="text-[10px] text-faint flex items-center gap-2 flex-wrap mt-0.5">
                          {sum.localIp && (
                            <a
                              href={`http://${sum.localIp}/`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-0.5 mono text-blue-400 hover:underline"
                              title="Abre a página de configuração do receptor — só funciona conectado à mesma rede WiFi dele"
                            >
                              <Wifi size={10} /> {sum.localIp} <ExternalLink size={9} />
                            </a>
                          )}
                          {sum.publicIp && (
                            <span className="mono" title="IP público da internet onde o receptor está">
                              público {sum.publicIp}
                            </span>
                          )}
                          {sum.rssi != null && (
                            <span className="mono" title="Sinal do WiFi no receptor (quanto mais perto de 0, melhor)">{sum.rssi} dBm</span>
                          )}
                        </div>
                      )}
                    </div>
                    {!isActive && (
                      <button onClick={() => onSwitchReceiver(kr.prefix)}
                        className="px-2 py-0.5 rounded border border-border text-[10px] text-cyan-300 hover:text-white hover:border-border-strong"
                        title="Usar este receptor (recarrega a página)">
                        usar
                      </button>
                    )}
                    <button onClick={() => { setEditingPrefix(kr.prefix); setEditName(kr.displayName) }}
                      className="text-gray-500 hover:text-gray-200" title="Renomear">
                      <Pencil size={11} />
                    </button>
                    <button onClick={() => onForgetReceiver(kr.prefix)}
                      className="text-gray-500 hover:text-red-400"
                      title="Tirar da lista (não apaga o histórico no servidor; volta se ele reportar de novo)">
                      <Trash2 size={11} />
                    </button>
                  </>
                )}
              </div>
            )
          })}
        </div>

        {adding ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              autoFocus
              value={newPrefix}
              onChange={e => setNewPrefix(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitNewPrefix(); if (e.key === 'Escape') setAdding(false) }}
              placeholder="mqtt.prefix do receptor (ex.: pu7iol)"
              className={`w-64 ${inputCls}`}
            />
            <button onClick={submitNewPrefix} disabled={!newPrefix.trim()}
              className="px-3 py-2 bg-blue-600 rounded-md text-xs text-white hover:bg-blue-700 disabled:opacity-50">
              Adicionar e usar
            </button>
            <button onClick={() => setAdding(false)} className="text-xs text-gray-400 hover:text-white">cancelar</button>
            <p className="w-full text-[11px] text-faint">Precisa ser idêntico ao <span className="mono">mqtt.prefix</span> configurado no receptor.</p>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} className="mt-2 flex items-center gap-1 text-[11px] text-gray-400 hover:text-white">
            <Plus size={11} /> Adicionar manualmente
          </button>
        )}

        {settings.mqttTopicPrefix && (
          <div className="mt-4 space-y-2">
            {fwCallsign ? fromFirmware('Callsign SondeHub', fwCallsign) : (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-gray-400 w-32 flex-shrink-0" title="Como seus frames aparecem no sondehub.org — usado pro painel achar as sondas que ESTE receptor decodifica">
                  Callsign SondeHub
                </span>
                <input
                  type="text"
                  value={settings.uploaderCallsign}
                  onChange={e => updateSettings(s => ({ ...s, uploaderCallsign: e.target.value }))}
                  placeholder="ex.: PU7ABC"
                  className={`w-40 ${inputCls}`}
                />
              </div>
            )}
            {fwHasPosition ? fromFirmware('Posição', `${fwLat.toFixed(5)}, ${fwLon.toFixed(5)}`) : (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-gray-400 w-32 flex-shrink-0" title="Centro da busca por sondas próximas e do raio de alerta">Posição</span>
                <input type="number" step="0.00001" value={settings.homeLat ?? ''}
                  onChange={e => updateSettings(s => ({ ...s, homeLat: e.target.value === '' ? null : Number(e.target.value) }))}
                  placeholder="Latitude" className={`w-28 ${inputCls}`} />
                <input type="number" step="0.00001" value={settings.homeLon ?? ''}
                  onChange={e => updateSettings(s => ({ ...s, homeLon: e.target.value === '' ? null : Number(e.target.value) }))}
                  placeholder="Longitude" className={`w-28 ${inputCls}`} />
                <button onClick={useMyLocation} disabled={locating}
                  className="flex items-center gap-1.5 px-3 py-2 bg-surface border border-border rounded-md text-xs text-gray-400 hover:text-white disabled:opacity-60">
                  <LocateFixed size={13} /> {locating ? 'Localizando…' : 'Minha localização'}
                </button>
              </div>
            )}
          </div>
        )}
      </Section>

      {/* ── Acesso ── */}
      {settings.mqttTopicPrefix && (
        <Section icon={<KeyRound size={12} className="text-amber-400" />} title="Segredo de gravação">
          <input
            type="password"
            value={settings.rdzConfigSecret}
            onChange={e => updateSettings(s => ({ ...s, rdzConfigSecret: e.target.value }))}
            placeholder="igual ao mqtt.cfgsecret do receptor"
            className={`w-64 ${inputCls}`}
          />
          <p className="text-[11px] text-faint mt-1.5">
            Necessário pra aplicar config e usar o turbo. Fica só neste navegador. Vazio = só leitura.
          </p>
        </Section>
      )}

      {/* ── Alertas do painel ── */}
      <Section icon={<Bell size={12} className="text-blue-400" />} title="Alertas no painel">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={toggleAlerts}
            className={`px-3 py-2 rounded-md text-xs border transition-all ${
              settings.receiverAlertsEnabled ? 'bg-blue-600 border-blue-600 text-white' : 'bg-surface border-border text-gray-400 hover:text-white'
            }`}
          >
            {settings.receiverAlertsEnabled ? 'Notificações ativadas' : 'Avisar quando decodificar sonda nova'}
          </button>
          <select
            value={settings.alertRadiusKm}
            onChange={e => updateSettings(s => ({ ...s, alertRadiusKm: Number(e.target.value) }))}
            disabled={!settings.receiverAlertsEnabled}
            className="bg-bg border border-border rounded-md text-xs text-white px-2 py-2 outline-none focus:border-blue-500 cursor-pointer disabled:opacity-50"
          >
            <option value={0}>qualquer distância</option>
            <option value={50}>até 50 km</option>
            <option value={100}>até 100 km</option>
            <option value={200}>até 200 km</option>
            <option value={300}>até 300 km</option>
          </select>
        </div>
        {notifPermission === 'denied' && (
          <p className="text-[11px] text-amber-400 mt-1.5">Permissão negada no navegador — libere nas configurações do site.</p>
        )}
        {notifPermission === 'unsupported' && (
          <p className="text-[11px] text-faint mt-1.5">Este navegador não suporta notificações.</p>
        )}
        <p className="text-[11px] text-faint mt-1.5">Funciona com a aba do painel aberta (mesmo em segundo plano).</p>
      </Section>
    </div>
  )
}
