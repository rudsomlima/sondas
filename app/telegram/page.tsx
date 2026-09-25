'use client'

import { useCallback, useEffect, useState } from 'react'
import { Send, Save, CheckCircle2, XCircle, Loader2, MapPin, Trash2, Rocket, PlaneLanding, Search, Radio, BatteryWarning, GripVertical, Plus, X, Clock, Mountain, Trophy, TrendingUp, Ruler, Link2, Star, Wifi, FileText, ChevronDown, RotateCcw, Building2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Station, DEFAULT_STATION, getSelectedStation, SOUTH_AMERICA_STATIONS } from '@/app/lib/stations'
import { findMatchingGeofence } from '@/app/lib/geofence'
import { DEFAULT_WATCH_RADIUS_KM, type Geofence } from '@/app/lib/telegramTypes'
import type { TelegramMessageTemplateKey, TelegramMessageTemplates } from '@/app/lib/telegramTypes'
import { DEFAULT_MESSAGE_TEMPLATES, LEGACY_DEFAULT_LANDING_TEMPLATE } from '@/app/lib/telegramMessage'
import GeofenceMap from './components/GeofenceMap'

interface TelegramSettingsView {
  chatId: string
  enabled: boolean
  notifyLaunch: boolean
  notifyLanding: boolean
  notifyAnywhere: boolean
  notifyReceiverOffline: boolean
  receiverOfflineMinutes: number
  notifyLowBattery: boolean
  lowBatteryVoltage: number
  watchedStationIds: string[]
  stationRadiusKm: Record<string, number>
  messageTemplates: TelegramMessageTemplates
  hasToken: boolean
  tokenPreview: string
}

const EMPTY_SETTINGS: TelegramSettingsView = {
  chatId: '', enabled: false, notifyLaunch: true, notifyLanding: true, notifyAnywhere: true,
  notifyReceiverOffline: true, receiverOfflineMinutes: 30, notifyLowBattery: true, lowBatteryVoltage: 3.5,
  watchedStationIds: [DEFAULT_STATION.id], stationRadiusKm: {},
  messageTemplates: {},
  hasToken: false, tokenPreview: '',
}

export default function TelegramPage() {
  const [station, setStation] = useState<Station>(DEFAULT_STATION)
  const [settings, setSettingsState] = useState<TelegramSettingsView>(EMPTY_SETTINGS)
  const [tokenInput, setTokenInput] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [detectMsg, setDetectMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const [areas, setAreas] = useState<Geofence[]>([])
  const [areasLoaded, setAreasLoaded] = useState(false)
  const [areasSaving, setAreasSaving] = useState(false)
  const [areasSaveMsg, setAreasSaveMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    setStation(getSelectedStation())
    fetch('/api/telegram-settings', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (j) setSettingsState(j) })
      .finally(() => setLoaded(true))
    fetch('/api/telegram-geofences', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (j?.areas) setAreas(j.areas) })
      .finally(() => setAreasLoaded(true))
  }, [])

  async function handleSave(messageTemplates = settings.messageTemplates) {
    setSaving(true)
    setSaveMsg(null)
    const tokenToSave = tokenInput.trim()
    try {
      const res = await fetch('/api/telegram-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botToken: tokenToSave,
          chatId: settings.chatId,
          enabled: settings.enabled,
          notifyLaunch: settings.notifyLaunch,
          notifyLanding: settings.notifyLanding,
          notifyAnywhere: settings.notifyAnywhere,
          notifyReceiverOffline: settings.notifyReceiverOffline,
          receiverOfflineMinutes: settings.receiverOfflineMinutes,
          notifyLowBattery: settings.notifyLowBattery,
          lowBatteryVoltage: settings.lowBatteryVoltage,
          watchedStationIds: settings.watchedStationIds,
          stationRadiusKm: settings.stationRadiusKm,
          messageTemplates,
        }),
      })
      const responseText = await res.text()
      let json: any
      try { json = responseText ? JSON.parse(responseText) : {} }
      catch { throw new Error(`Resposta inválida do servidor (${res.status}): ${responseText.slice(0, 160)}`) }
      if (!res.ok) throw new Error(json?.error || `erro ${res.status}`)
      const refreshRes = await fetch('/api/telegram-settings', { cache: 'no-store' })
      if (refreshRes.ok) {
        const refreshed = await refreshRes.json()
        setSettingsState(refreshed)
        setSaveMsg({ ok: true, text: 'Configurações salvas.' })
      } else {
        setSettingsState(s => ({ ...s, hasToken: s.hasToken || Boolean(tokenToSave), tokenPreview: tokenToSave ? `…${tokenToSave.slice(-6)}` : s.tokenPreview }))
        setSaveMsg({ ok: true, text: 'Configurações salvas; a confirmação do armazenamento não carregou.' })
      }
      setTokenInput('')
    } catch (e: any) {
      setSaveMsg({ ok: false, text: e?.message || 'Falha ao salvar.' })
    } finally {
      setSaving(false)
      setTimeout(() => setSaveMsg(null), 3500)
    }
  }

  async function restoreDefaultTemplates() {
    setSettingsState(s => ({ ...s, messageTemplates: {} }))
    await handleSave({})
  }

  async function handleDetectChat() {
    setDetecting(true)
    setDetectMsg(null)
    try {
      // Precisa do token já salvo no servidor pra chamar o getUpdates — se o
      // usuário acabou de digitar um novo token, salva primeiro.
      if (tokenInput.trim()) await handleSave()
      const res = await fetch('/api/telegram-detect-chat', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || `erro ${res.status}`)
      setSettingsState(s => ({ ...s, chatId: json.chatId }))
      setDetectMsg({ ok: true, text: `Encontrado: ${json.label} (${json.chatId}). Clique em Salvar pra confirmar.` })
    } catch (e: any) {
      setDetectMsg({ ok: false, text: e?.message || 'Falha ao detectar.' })
    } finally {
      setDetecting(false)
    }
  }

  const [stationFilter, setStationFilter] = useState('')
  const watched = new Set(settings.watchedStationIds ?? [])
  function toggleStation(id: string) {
    setSettingsState(s => {
      const cur = new Set(s.watchedStationIds ?? [])
      if (cur.has(id)) cur.delete(id); else cur.add(id)
      return { ...s, watchedStationIds: [...cur] }
    })
  }
  const watchedRadii: Record<string, number> = {}
  for (const id of settings.watchedStationIds ?? []) watchedRadii[id] = settings.stationRadiusKm?.[id] ?? DEFAULT_WATCH_RADIUS_KM
  function setRadius(id: string, km: number) {
    setSettingsState(s => ({ ...s, stationRadiusKm: { ...s.stationRadiusKm, [id]: km } }))
  }
  const stationsInAreas = SOUTH_AMERICA_STATIONS.filter(st => findMatchingGeofence(st.lat, st.lon, areas))
  const visibleStations = SOUTH_AMERICA_STATIONS.filter(st =>
    !stationFilter.trim() || `${st.name} ${st.id}`.toLowerCase().includes(stationFilter.trim().toLowerCase()))

  const persistAreas = useCallback(async (next: Geofence[]) => {
    setAreas(next)
    setAreasSaving(true)
    setAreasSaveMsg(null)
    try {
      const res = await fetch('/api/telegram-geofences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ areas: next }),
      })
      if (!res.ok) throw new Error(`erro ${res.status}`)
    } catch (e: any) {
      setAreasSaveMsg({ ok: false, text: 'Falha ao salvar as áreas no servidor — tente de novo.' })
    } finally {
      setAreasSaving(false)
    }
  }, [])

  function renameArea(id: string, name: string) {
    setAreas(prev => prev.map(a => a.id === id ? { ...a, name } : a))
  }

  function commitRename(id: string) {
    const area = areas.find(a => a.id === id)
    if (area) persistAreas(areas.map(a => a.id === id ? { ...a, name: area.name || 'Área sem nome' } : a))
  }

  function deleteArea(id: string) {
    persistAreas(areas.filter(a => a.id !== id))
  }

  function toggleArea(id: string) {
    persistAreas(areas.map(a => a.id === id ? { ...a, enabled: !(a.enabled !== false) } : a))
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Send size={22} className="text-blue-400" />
          Telegram
        </h1>
        <p className="text-gray-400 text-sm mt-1">
          Avisos de lançamento e pouso no Telegram, com dados completos da sonda, mapa com o local e áreas de interesse.
        </p>
      </div>

      {/* Bot */}
      <div className="panel p-5 mb-6">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-4">
          <Send size={14} className="text-blue-400" />
          Bot do Telegram
        </h2>

        {!loaded ? (
          <div className="text-xs text-dim flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Carregando…</div>
        ) : (
          <>
            <div className="mb-3">
              <label className="block text-xs text-gray-400 mb-1.5">Bot token</label>
              <input
                type="password"
                value={tokenInput}
                onChange={e => setTokenInput(e.target.value)}
                placeholder={settings.hasToken ? `Configurado (${settings.tokenPreview}) — digite pra trocar` : 'ex.: 123456789:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'}
                className="w-full bg-bg border border-border rounded-md text-sm text-white px-3 py-2 outline-none focus:border-blue-500 mono"
              />
              <p className="text-[11px] text-faint mt-1.5">
                Crie um bot com o <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">@BotFather</a> e cole o token gerado. Fica só no servidor — nunca é reenviado pro navegador.
              </p>
            </div>

            <div className="mb-4">
              <label className="block text-xs text-gray-400 mb-1.5">Chat ID do grupo</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={settings.chatId}
                  onChange={e => setSettingsState(s => ({ ...s, chatId: e.target.value }))}
                  placeholder="ex.: -1001234567890"
                  className="flex-1 min-w-0 bg-bg border border-border rounded-md text-sm text-white px-3 py-2 outline-none focus:border-blue-500 mono"
                />
                <button
                  type="button"
                  onClick={handleDetectChat}
                  disabled={detecting || (!settings.hasToken && !tokenInput.trim())}
                  title={!settings.hasToken && !tokenInput.trim() ? 'Cole o bot token acima primeiro' : undefined}
                  className="flex items-center gap-1.5 px-3 py-2 bg-surface border border-border rounded-md text-xs text-gray-300 hover:text-white transition-all disabled:opacity-50 whitespace-nowrap flex-shrink-0"
                >
                  {detecting ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
                  Detectar
                </button>
              </div>
              <p className="text-[11px] text-faint mt-1.5 leading-relaxed">
                Para enviar ao grupo, adicione o bot ao grupo e use Detectar depois de alguém enviar uma mensagem nele. O ID geralmente começa com <span className="mono">-100</span>.
              </p>
              <p className="text-[11px] text-faint mt-1.5 leading-relaxed">Se o teste indicar "chat not found", confira o ID. Em grupos, verifique se o bot continua no grupo e pode enviar mensagens.</p>
              {detectMsg && (
                <span className={`flex items-center gap-1.5 mt-1.5 text-[11px] ${detectMsg.ok ? 'text-emerald-400' : 'text-yellow-400'}`}>
                  {detectMsg.ok ? <CheckCircle2 size={11} /> : <XCircle size={11} />} {detectMsg.text}
                </span>
              )}
            </div>

            <ToggleRow
              label="Notificações ativas"
              desc="Chave geral — desligada, nenhuma mensagem é enviada mesmo com bot configurado."
              checked={settings.enabled}
              onChange={v => setSettingsState(s => ({ ...s, enabled: v }))}
            />
            <ToggleRow
              label={<span className="flex items-center gap-1.5"><Rocket size={12} className="text-blue-400" /> Avisar lançamento</span>}
              desc="Manda mensagem assim que uma sonda de hoje aparece ao vivo."
              checked={settings.notifyLaunch}
              onChange={v => setSettingsState(s => ({ ...s, notifyLaunch: v }))}
              disabled={!settings.enabled}
            />
            <ToggleRow
              label={<span className="flex items-center gap-1.5"><PlaneLanding size={12} className="text-blue-400" /> Avisar pouso</span>}
              desc="Manda mensagem quando uma sonda pousa, com altitude, distância/rumo da estação, área de interesse (se houver) e uma imagem do mapa com o local."
              checked={settings.notifyLanding}
              onChange={v => setSettingsState(s => ({ ...s, notifyLanding: v }))}
              disabled={!settings.enabled}
            />
            {settings.notifyLanding && (
              <div className="pl-4 border-l-2 border-border ml-1">
                <ToggleRow
                  label="Avisar pouso em qualquer lugar"
                  desc={settings.notifyAnywhere
                    ? 'Ligado: avisa todo pouso, em qualquer lugar. Se cair dentro de uma área de interesse cadastrada, o nome dela entra na mensagem.'
                    : 'Desligado: só avisa pousos que caírem DENTRO de alguma área de interesse cadastrada abaixo — pousos fora não notificam.'}
                  checked={settings.notifyAnywhere}
                  onChange={v => setSettingsState(s => ({ ...s, notifyAnywhere: v }))}
                  disabled={!settings.enabled}
                />
              </div>
            )}

            <div className="flex flex-wrap gap-2 mt-4">
              <button
                onClick={() => handleSave()}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 rounded-md text-sm text-white hover:bg-blue-700 transition-all disabled:opacity-60"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Salvar
              </button>
            </div>

            <div className="mt-3 min-h-[16px] text-[11px]">
              {saveMsg && (
                <span className={`flex items-center gap-1.5 ${saveMsg.ok ? 'text-emerald-400' : 'text-yellow-400'}`}>
                  {saveMsg.ok ? <CheckCircle2 size={11} /> : <XCircle size={11} />} {saveMsg.text}
                </span>
              )}
            </div>

            <p className="text-[11px] text-faint mt-3 leading-relaxed">
              A detecção roda no navegador enquanto o <span className="text-blue-400">Painel</span> estiver aberto
              numa aba (igual aos alertas de "nova sonda no meu receptor") — não depende de nenhum app instalado,
              mas só dispara com a aba aberta em algum aparelho.
            </p>
          </>
        )}
      </div>

      {/* Modelos das mensagens */}
      <div className="panel p-5 mb-6">
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-blue-400/15 bg-gradient-to-r from-blue-500/10 via-surface to-violet-500/10 p-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-blue-400/20 bg-blue-400/10 text-blue-300"><FileText size={21} /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-white">Modelos de todas as mensagens</h2>
              <span className="rounded-full border border-blue-400/20 bg-blue-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-blue-200">6 modelos</span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-gray-400">Monte cada mensagem com peças visuais. Clique ou arraste um badge para adicionar, depois reorganize as peças na área de composição. A prévia mostra um exemplo no formato do Telegram.</p>
          </div>
        </div>
        <div className="space-y-3">
          {([
            ['launch', 'Lançamento'], ['landing', 'Pouso'], ['receiverOffline', 'Receptor offline'],
            ['receiverOnline', 'Receptor voltou online'], ['lowBattery', 'Bateria baixa'], ['batteryOk', 'Bateria normalizada'],
          ] as [TelegramMessageTemplateKey, string][]).map(([key, label]) => (
            <MessageTemplateEditor
              key={key}
              label={label}
              templateKey={key}
              value={key === 'landing' && settings.messageTemplates[key] === LEGACY_DEFAULT_LANDING_TEMPLATE
                ? DEFAULT_MESSAGE_TEMPLATES[key]
                : settings.messageTemplates[key] ?? DEFAULT_MESSAGE_TEMPLATES[key]}
              canTest={settings.hasToken && Boolean(settings.chatId)}
              onChange={value => setSettingsState(s => ({ ...s, messageTemplates: { ...s.messageTemplates, [key]: value } }))}
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-2 mt-4">
          <button onClick={() => handleSave()} disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-blue-600 rounded-md text-sm text-white hover:bg-blue-700 transition-all disabled:opacity-60">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Salvar modelos
          </button>
          <button onClick={restoreDefaultTemplates} disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-surface border border-border rounded-md text-sm text-gray-300 hover:text-white transition-all disabled:opacity-60">
            <RotateCcw size={14} />
            Restaurar todos ao padrão
          </button>
          {saveMsg && <span className={`flex items-center gap-1.5 text-[11px] self-center ${saveMsg.ok ? 'text-emerald-400' : 'text-yellow-400'}`}>{saveMsg.ok ? <CheckCircle2 size={11} /> : <XCircle size={11} />}{saveMsg.text}</span>}
        </div>
      </div>

      {/* Meu receptor: offline / bateria baixa */}
      <div className="panel p-5 mb-6">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-1">
          <Radio size={14} className="text-blue-400" />
          Meu receptor
        </h2>
        <p className="text-[11px] text-faint mb-4 leading-relaxed">
          Diferente dos avisos acima, estes rodam no servidor (cron periódico), então funcionam mesmo sem o
          navegador aberto — cobrem todos os receptores já vistos por este app.
        </p>

        {!loaded ? (
          <div className="text-xs text-dim flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Carregando…</div>
        ) : (
          <>
            <ToggleRow
              label={<span className="flex items-center gap-1.5"><Radio size={12} className="text-blue-400" /> Avisar receptor offline</span>}
              desc="Manda mensagem quando um receptor para de reportar (sem contar deep sleep esperado) e outra quando ele volta."
              checked={settings.notifyReceiverOffline}
              onChange={v => setSettingsState(s => ({ ...s, notifyReceiverOffline: v }))}
              disabled={!settings.enabled}
            />
            {settings.notifyReceiverOffline && (
              <div className="pl-4 border-l-2 border-border ml-1 py-2">
                <label className="block text-xs text-gray-400 mb-1.5">Minutos sem report pra considerar offline</label>
                <input
                  type="number"
                  min={5}
                  value={settings.receiverOfflineMinutes}
                  onChange={e => setSettingsState(s => ({ ...s, receiverOfflineMinutes: Math.max(5, Number(e.target.value) || 5) }))}
                  disabled={!settings.enabled}
                  className="w-28 bg-bg border border-border rounded-md text-sm text-white px-3 py-1.5 outline-none focus:border-blue-500 mono disabled:opacity-50"
                />
              </div>
            )}
            <ToggleRow
              label={<span className="flex items-center gap-1.5"><BatteryWarning size={12} className="text-blue-400" /> Avisar bateria baixa</span>}
              desc="Manda mensagem quando a tensão da bateria do receptor cai abaixo do limiar, e outra quando normaliza."
              checked={settings.notifyLowBattery}
              onChange={v => setSettingsState(s => ({ ...s, notifyLowBattery: v }))}
              disabled={!settings.enabled}
            />
            {settings.notifyLowBattery && (
              <div className="pl-4 border-l-2 border-border ml-1 py-2">
                <label className="block text-xs text-gray-400 mb-1.5">Tensão mínima (V)</label>
                <input
                  type="number"
                  step={0.1}
                  min={3}
                  max={4.2}
                  value={settings.lowBatteryVoltage}
                  onChange={e => setSettingsState(s => ({ ...s, lowBatteryVoltage: Number(e.target.value) || 3.5 }))}
                  disabled={!settings.enabled}
                  className="w-28 bg-bg border border-border rounded-md text-sm text-white px-3 py-1.5 outline-none focus:border-blue-500 mono disabled:opacity-50"
                />
              </div>
            )}

            <div className="flex flex-wrap gap-2 mt-4">
              <button
                onClick={() => handleSave()}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 rounded-md text-sm text-white hover:bg-blue-700 transition-all disabled:opacity-60"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Salvar
              </button>
            </div>
          </>
        )}
      </div>

      {/* Áreas de interesse */}
      <div className="panel p-5 mb-6">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-1">
          <MapPin size={14} className="text-blue-400" />
          Áreas de interesse
        </h2>
        <p className="text-[11px] text-faint mb-4 leading-relaxed">
          Desenhe polígonos ou círculos no mapa (ferramentas no canto superior esquerdo). Com "avisar pouso em
          qualquer lugar" ligado (padrão), essas áreas só rotulam a mensagem quando o pouso cai dentro de uma
          delas. Desligado, elas passam a ser as ÚNICAS áreas notificadas.
        </p>

        {!areasLoaded ? (
          <div className="text-xs text-dim flex items-center gap-1.5 mb-4"><Loader2 size={12} className="animate-spin" /> Carregando áreas…</div>
        ) : (
          <div className="mb-4">
            <GeofenceMap station={station} areas={areas} onChange={persistAreas} watchedRadii={watchedRadii} onToggleStation={toggleStation} />
          </div>
        )}

        {areas.length > 0 && (
          <div className="space-y-2">
            {areas.map(area => {
              const isEnabled = area.enabled !== false
              return (
                <div key={area.id} className={`flex items-center gap-2 ${isEnabled ? '' : 'opacity-60'}`}>
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isEnabled ? 'bg-orange-500' : 'bg-gray-600'}`} />
                  <input
                    type="text"
                    value={area.name}
                    onChange={e => renameArea(area.id, e.target.value)}
                    onBlur={() => commitRename(area.id)}
                    className="flex-1 bg-bg border border-border rounded-md text-sm text-white px-2.5 py-1.5 outline-none focus:border-blue-500"
                  />
                  <span className="text-[11px] text-faint flex-shrink-0">
                    {area.shape.type === 'circle' ? `círculo · ${Math.round(area.shape.radiusM)} m` : `polígono · ${area.shape.points.length} pontos`}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isEnabled}
                    onClick={() => toggleArea(area.id)}
                    title={isEnabled ? 'Área ativa — clique pra desativar' : 'Área desativada — clique pra ativar'}
                    className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full border transition-colors ${
                      isEnabled ? 'bg-blue-600 border-blue-500' : 'bg-surface-2 border-border-strong'
                    }`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${isEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </button>
                  <button
                    onClick={() => deleteArea(area.id)}
                    className="text-gray-500 hover:text-red-400 transition-colors flex-shrink-0"
                    title="Remover área"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )
            })}
          </div>
        )}

        <div className="mt-2 min-h-[16px] text-[11px]">
          {areasSaving && <span className="text-dim flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" /> Salvando…</span>}
          {areasSaveMsg && (
            <span className={`flex items-center gap-1.5 ${areasSaveMsg.ok ? 'text-emerald-400' : 'text-yellow-400'}`}>
              {areasSaveMsg.ok ? <CheckCircle2 size={11} /> : <XCircle size={11} />} {areasSaveMsg.text}
            </span>
          )}
        </div>

        <div className="mt-5 pt-4 border-t border-border">
          <h3 className="text-sm font-semibold text-white mb-1">Estações monitoradas</h3>
          <p className="text-[11px] text-faint mb-3 leading-relaxed">
            O servidor avisa lançamento e pouso das estações marcadas mesmo com o app fechado. Marque as da região
            das suas áreas de interesse (também dá pra clicar nas estações no mapa). O círculo ciano no mapa é o alcance. Depois de marcar, clique em Salvar estações.
          </p>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <input
              type="text"
              value={stationFilter}
              onChange={e => setStationFilter(e.target.value)}
              placeholder="Buscar estação…"
              className="flex-1 min-w-[140px] bg-surface-2 border border-border rounded px-2 py-1 text-xs text-white"
            />
            <button
              type="button"
              disabled={stationsInAreas.length === 0}
              onClick={() => setSettingsState(s => ({
                ...s, watchedStationIds: [...new Set([...(s.watchedStationIds ?? []), ...stationsInAreas.map(x => x.id)])],
              }))}
              className="text-xs px-2 py-1 rounded border border-border-strong text-gray-300 hover:text-white disabled:opacity-40"
              title="Marca as estações que ficam dentro das áreas ativas desenhadas no mapa"
            >
              Marcar as dentro das áreas ({stationsInAreas.length})
            </button>
          </div>
          <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
            {visibleStations.map(st => (
              <label key={st.id} className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                <input type="checkbox" checked={watched.has(st.id)} onChange={() => toggleStation(st.id)} />
                <span className="flex-1">{st.name} <span className="text-faint">({st.id})</span></span>
                {watched.has(st.id) && (
                  <span className="flex items-center gap-1 text-faint" onClick={e => e.preventDefault()}>
                    alcance
                    <input
                      type="number" min={10} max={1000} step={10}
                      value={settings.stationRadiusKm?.[st.id] ?? DEFAULT_WATCH_RADIUS_KM}
                      onChange={e => setRadius(st.id, Math.min(1000, Math.max(10, Number(e.target.value) || DEFAULT_WATCH_RADIUS_KM)))}
                      className="w-16 bg-surface-2 border border-border rounded px-1 py-0.5 text-xs text-white"
                    />
                    km
                  </span>
                )}
              </label>
            ))}
          </div>
          <div className="flex items-center gap-3 mt-3">
            <button
              onClick={() => handleSave()}
              disabled={saving}
              className="flex items-center gap-2 px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium transition-colors"
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              Salvar estações
            </button>
            <span className="text-[11px] text-faint">{watched.size} estação(ões) marcada(s).</span>
            {saveMsg && (
              <span className={`flex items-center gap-1.5 text-[11px] ${saveMsg.ok ? 'text-emerald-400' : 'text-yellow-400'}`}>
                {saveMsg.ok ? <CheckCircle2 size={11} /> : <XCircle size={11} />} {saveMsg.text}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

type TemplateToken = { key: string; label: string; icon: LucideIcon; style: string }

const EVENT_TEMPLATE_TOKENS: TemplateToken[] = [
  { key: 'header', label: 'Título do aviso', icon: Rocket, style: 'blue' },
  { key: 'stationLine', label: 'Estação', icon: Radio, style: 'cyan' },
  { key: 'timeLine', label: 'Horário', icon: Clock, style: 'violet' },
  { key: 'positionLine', label: 'Coordenadas', icon: MapPin, style: 'rose' },
  { key: 'landingCityLine', label: 'Cidade do pouso', icon: Building2, style: 'green' },
  { key: 'altitudeLine', label: 'Altitude', icon: Mountain, style: 'orange' },
  { key: 'firstSignalLine', label: 'Primeiro sinal', icon: Trophy, style: 'yellow' },
  { key: 'climbingLine', label: 'Subida / descida', icon: TrendingUp, style: 'green' },
  { key: 'frequencyLine', label: 'Frequência', icon: Radio, style: 'cyan' },
  { key: 'sourceLine', label: 'Fonte', icon: Search, style: 'violet' },
  { key: 'receiverLine', label: 'Receptor', icon: Wifi, style: 'green' },
  { key: 'distanceLine', label: 'Distância e rumo', icon: Ruler, style: 'orange' },
  { key: 'areaLine', label: 'Área de interesse', icon: Star, style: 'yellow' },
  { key: 'linksLine', label: 'Links do mapa', icon: Link2, style: 'blue' },
]

const ALERT_TEMPLATE_TOKENS: Partial<Record<TelegramMessageTemplateKey, TemplateToken[]>> = {
  receiverOffline: [
    { key: 'offlineHeader', label: 'Título offline', icon: Wifi, style: 'rose' },
    { key: 'offlineBody', label: 'Tempo sem sinal', icon: Clock, style: 'orange' },
  ],
  receiverOnline: [
    { key: 'onlineHeader', label: 'Aviso online', icon: Wifi, style: 'green' },
  ],
  lowBattery: [
    { key: 'lowBatteryHeader', label: 'Título bateria baixa', icon: BatteryWarning, style: 'orange' },
    { key: 'lowBatteryBody', label: 'Tensão atual', icon: TrendingUp, style: 'yellow' },
  ],
  batteryOk: [
    { key: 'batteryOkHeader', label: 'Título bateria normal', icon: BatteryWarning, style: 'green' },
    { key: 'batteryOkBody', label: 'Tensão atual', icon: TrendingUp, style: 'cyan' },
  ],
}

const TOKEN_STYLES: Record<string, string> = {
  blue: 'border-blue-400/30 bg-blue-400/10 text-blue-200 hover:bg-blue-400/20',
  cyan: 'border-cyan-400/30 bg-cyan-400/10 text-cyan-200 hover:bg-cyan-400/20',
  violet: 'border-violet-400/30 bg-violet-400/10 text-violet-200 hover:bg-violet-400/20',
  rose: 'border-rose-400/30 bg-rose-400/10 text-rose-200 hover:bg-rose-400/20',
  orange: 'border-orange-400/30 bg-orange-400/10 text-orange-200 hover:bg-orange-400/20',
  yellow: 'border-yellow-400/30 bg-yellow-400/10 text-yellow-200 hover:bg-yellow-400/20',
  green: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20',
}

const TEMPLATE_PREVIEW_VALUES: Record<string, string> = {
  header: '🚀 <b>Sonda W12345 lançada</b>',
  stationLine: '📡 Estação: Natal Aeroporto (82599)',
  timeLine: '🕒 12:34:56 (GMT-3)',
  positionLine: '📍 -5.90, -35.20',
  landingCityLine: '🏙️ Localidade: Natal-RN',
  altitudeLine: '⬆️ Altitude: 850 m',
  firstSignalLine: '🥇 Primeiro sinal: 720 m às 12:32 (RX-CASA)',
  climbingLine: '📈 Subida: +5.2 m/s',
  frequencyLine: '📻 Frequência: 403.200 MHz',
  sourceLine: '🔎 Fonte: SondeHub (RF)',
  receiverLine: '📶 Último receptor: RX-CASA',
  distanceLine: '📏 12 km da estação, rumo N (5°)',
  areaLine: '⭐ Dentro da área de interesse: <b>Centro</b>',
  linksLine: '🗺 <a href="https://example.com">Abrir no Google Maps</a> · <a href="https://example.com">SondeHub</a>',
  offlineHeader: '📴 <b>Receptor "RX-CASA" parece offline</b>',
  offlineBody: 'Sem nenhum report há 32 min.',
  onlineHeader: '📡 <b>Receptor "RX-CASA" voltou a reportar</b>',
  lowBatteryHeader: '🔋 <b>Bateria baixa no receptor "RX-CASA"</b>',
  lowBatteryBody: 'Tensão atual: 3.42 V',
  batteryOkHeader: '🔋 <b>Bateria do receptor "RX-CASA" normalizou</b>',
  batteryOkBody: 'Tensão atual: 3.42 V',
  name: 'RX-CASA',
  minutesSilent: '32',
  voltage: '3.42',
}

function previewMarkup(line: string): React.ReactNode[] {
  const withoutLinks = line.replace(/<a\b[^>]*>(.*?)<\/a>/gi, '$1')
  const parts = withoutLinks.split(/(<\/?(?:b|strong|i|em|code)>)/gi)
  let bold = false
  let italic = false
  let code = false
  return parts.filter(Boolean).map((part, index) => {
    if (/^<\/?(?:b|strong|i|em|code)>$/i.test(part)) {
      const closing = /^<\//.test(part)
      const tag = part.replace(/[<>/]/g, '').toLowerCase()
      if (tag === 'b' || tag === 'strong') bold = !closing
      if (tag === 'i' || tag === 'em') italic = !closing
      if (tag === 'code') code = !closing
      return null
    }
    return <span key={index} className={`${bold ? 'font-bold' : ''} ${italic ? 'italic' : ''} ${code ? 'font-mono' : ''}`}>{part}</span>
  })
}

function MessageTemplateEditor({ label, templateKey, value, canTest, onChange }: {
  label: string
  templateKey: TelegramMessageTemplateKey
  value: string
  canTest: boolean
  onChange: (value: string) => void
}) {
  const [drag, setDrag] = useState<{ kind: 'token'; key: string } | { kind: 'block'; index: number } | null>(null)
  const [expanded, setExpanded] = useState(templateKey === 'launch')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null)
  const blocks = value ? value.split('\n') : []
  const tokens = templateKey === 'launch' || templateKey === 'landing'
    ? EVENT_TEMPLATE_TOKENS.filter(token => templateKey === 'landing' || token.key !== 'landingCityLine')
    : (ALERT_TEMPLATE_TOKENS[templateKey] ?? [])
  const tokenByKey = new Map(tokens.map(token => [token.key, token]))
  const landing = templateKey === 'landing'
  const sampleValues: Record<string, string> = {
    ...TEMPLATE_PREVIEW_VALUES,
    header: landing ? '🪂 <b>Sonda W12345 pousou</b>' : TEMPLATE_PREVIEW_VALUES.header,
    climbingLine: landing ? '📉 Variação vertical: -1.1 m/s' : TEMPLATE_PREVIEW_VALUES.climbingLine,
  }
  const previewLines = blocks
    .map(line => line.replace(/\{([a-zA-Z]+)\}/g, (token, key: string) => sampleValues[key] ?? token))
    .filter(line => line.trim().length > 0)

  function writeBlocks(next: string[]) { onChange(next.join('\n')) }
  async function sendTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/telegram-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateKey, template: value }),
      })
      const responseText = await res.text()
      let json: any
      try { json = responseText ? JSON.parse(responseText) : {} }
      catch { throw new Error(`O servidor retornou uma resposta inválida (${res.status}): ${responseText.slice(0, 160)}`) }
      if (!res.ok) throw new Error(json?.error || `erro ${res.status}`)
      setTestResult({ ok: true, text: json.withPhoto ? 'Teste enviado com mapa.' : 'Teste enviado ao grupo.' })
    } catch (e: any) {
      setTestResult({ ok: false, text: e?.message || 'Falha ao enviar o teste.' })
    } finally {
      setTesting(false)
    }
  }
  function addToken(key: string, at = blocks.length) {
    const next = [...blocks]
    next.splice(at, 0, `{${key}}`)
    writeBlocks(next)
  }
  function removeBlock(index: number) { writeBlocks(blocks.filter((_, i) => i !== index)) }
  function updateBlock(index: number, text: string) {
    const next = [...blocks]
    next[index] = text
    writeBlocks(next)
  }
  function dropOnBlock(e: React.DragEvent, index: number) {
    e.preventDefault()
    if (!drag) return
    if (drag.kind === 'token') addToken(drag.key, index)
    else if (drag.index !== index) {
      const next = [...blocks]
      const [item] = next.splice(drag.index, 1)
      next.splice(index, 0, item)
      writeBlocks(next)
    }
    setDrag(null)
  }
  function renderBlock(line: string, index: number) {
    const match = line.match(/^\{([a-zA-Z]+)\}$/)
    const token = match ? tokenByKey.get(match[1]) : undefined
    const Icon = token?.icon ?? FileText
    const chipStyle = TOKEN_STYLES[token?.style ?? 'blue']
    return (
      <div
        key={index}
        draggable
        onDragStart={e => { setDrag({ kind: 'block', index }); e.dataTransfer.effectAllowed = 'move' }}
        onDragOver={e => e.preventDefault()}
        onDrop={e => dropOnBlock(e, index)}
        onDragEnd={() => setDrag(null)}
        className={`group inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-2 text-xs shadow-sm transition-all ${chipStyle} ${drag?.kind === 'block' && drag.index === index ? 'opacity-40' : ''}`}
      >
        {token ? <Icon size={14} className="shrink-0" /> : <GripVertical size={14} className="shrink-0 cursor-grab opacity-60" />}
        {token
          ? <span className="font-medium">{token.label}</span>
          : <input value={line.trim()} onChange={e => updateBlock(index, e.target.value)} placeholder="Texto personalizado" aria-label={`${label}, texto personalizado`} className="w-40 bg-transparent text-xs outline-none placeholder:text-current/50" />}
        <button type="button" onClick={() => removeBlock(index)} title="Remover item" aria-label="Remover item" className="-mr-1 rounded-full p-0.5 opacity-60 transition hover:bg-black/20 hover:opacity-100">
          <X size={13} />
        </button>
      </div>
    )
  }

  return (
    <details open={expanded} onToggle={e => setExpanded(e.currentTarget.open)} className="overflow-hidden rounded-xl border border-border bg-surface/60 shadow-sm">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5 hover:bg-surface-2/60 [&::-webkit-details-marker]:hidden">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10 text-blue-300">
          {templateKey === 'launch' ? <Rocket size={17} /> : templateKey === 'landing' ? <PlaneLanding size={17} /> : templateKey.toLowerCase().includes('battery') || templateKey === 'lowBattery' || templateKey === 'batteryOk' ? <BatteryWarning size={17} /> : <Radio size={17} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-white">{label}</span>
          <span className="block text-[11px] text-faint">{blocks.length} {blocks.length === 1 ? 'item' : 'itens'} na mensagem</span>
        </span>
        <ChevronDown size={16} className={`text-faint transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </summary>

      {expanded && <div className="space-y-4 border-t border-border p-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-faint">
            <Plus size={13} /> Itens disponíveis <span className="normal-case tracking-normal">· clique ou arraste para adicionar</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {tokens.map(token => {
              const Icon = token.icon
              return <button key={token.key} type="button" draggable onClick={() => addToken(token.key)}
                onDragStart={e => { setDrag({ kind: 'token', key: token.key }); e.dataTransfer.effectAllowed = 'copy' }}
                onDragEnd={() => setDrag(null)}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium shadow-sm transition hover:-translate-y-0.5 ${TOKEN_STYLES[token.style]}`}>
                <Icon size={14} /> {token.label}
              </button>
            })}
            <button type="button" onClick={() => writeBlocks([...blocks, ' '])} className="inline-flex items-center gap-2 rounded-full border border-dashed border-border-strong bg-bg px-3 py-2 text-xs text-gray-300 transition hover:border-blue-400 hover:text-white">
              <FileText size={14} /> Texto livre
            </button>
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-3 text-[11px] font-medium uppercase tracking-wider text-faint">
            <span className="flex items-center gap-2"><GripVertical size={13} /> Sua mensagem</span>
            <span className="normal-case tracking-normal">Arraste os badges para reordenar</span>
          </div>
          <div onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (drag?.kind === 'token') addToken(drag.key); setDrag(null) }}
            className={`flex min-h-16 flex-wrap content-start items-center gap-2 rounded-xl border border-dashed p-3 transition ${drag ? 'border-blue-400 bg-blue-400/5' : 'border-border-strong bg-bg/70'}`}>
            {blocks.map((line, index) => renderBlock(line, index))}
            {blocks.length === 0 && <span className="w-full py-2 text-center text-xs text-faint">Arraste itens para cá ou escolha um badge acima.</span>}
          </div>
        </div>

        <div className="rounded-xl border border-[#2a3a49] bg-[#101820] p-3 sm:p-4">
          <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400"><Send size={13} /> Prévia no Telegram <span className="normal-case tracking-normal">· exemplo</span></div>
          <div className="max-w-xl rounded-2xl rounded-tl-sm border border-[#263544] bg-[#182533] px-4 py-3 shadow-lg">
            <div className="space-y-1 break-words text-sm leading-relaxed text-slate-100">
              {previewLines.map((line, index) => <div key={index}>{previewMarkup(line)}</div>)}
              {previewLines.length === 0 && <span className="text-slate-500">A mensagem aparecerá aqui conforme você adicionar itens.</span>}
            </div>
            <div className="mt-2 text-right text-[10px] text-slate-500">12:34</div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={sendTest} disabled={!canTest || testing}
              title={!canTest ? 'Configure e salve o bot token e o ID do grupo primeiro.' : 'Envia somente este modelo para o grupo.'}
              className="inline-flex items-center gap-2 rounded-lg border border-blue-400/30 bg-blue-500/15 px-3 py-2 text-xs font-medium text-blue-100 transition hover:bg-blue-500/25 disabled:cursor-not-allowed disabled:opacity-40">
              {testing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {testing ? 'Enviando…' : 'Testar esta mensagem'}
            </button>
            {testResult && <span className={`flex items-center gap-1.5 text-[11px] ${testResult.ok ? 'text-emerald-300' : 'text-rose-300'}`}>
              {testResult.ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />}{testResult.text}
            </span>}
          </div>
        </div>
      </div>}
    </details>
  )
}

function ToggleRow({ label, desc, checked, onChange, disabled }: {
  label: React.ReactNode; desc: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean
}) {
  return (
    <div className={`flex items-start justify-between gap-4 py-2.5 border-t border-border first:border-t-0 ${disabled ? 'opacity-50' : ''}`}>
      <div className="min-w-0">
        <p className="text-sm text-white">{label}</p>
        <p className="text-[11px] text-faint mt-0.5 leading-relaxed">{desc}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full border transition-colors disabled:cursor-not-allowed ${
          checked ? 'bg-blue-600 border-blue-500' : 'bg-surface-2 border-border-strong'
        }`}
      >
        <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
    </div>
  )
}

