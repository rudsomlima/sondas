'use client'

import { useCallback, useEffect, useState } from 'react'
import { Send, Save, CheckCircle2, XCircle, Loader2, MapPin, Trash2, Rocket, PlaneLanding, Search, Radio, BatteryWarning } from 'lucide-react'
import { Station, DEFAULT_STATION, getSelectedStation } from '@/app/lib/stations'
import type { Geofence } from '@/app/lib/telegramTypes'
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
  hasToken: boolean
  tokenPreview: string
}

const EMPTY_SETTINGS: TelegramSettingsView = {
  chatId: '', enabled: false, notifyLaunch: true, notifyLanding: true, notifyAnywhere: true,
  notifyReceiverOffline: true, receiverOfflineMinutes: 30, notifyLowBattery: true, lowBatteryVoltage: 3.5,
  hasToken: false, tokenPreview: '',
}

export default function TelegramPage() {
  const [station, setStation] = useState<Station>(DEFAULT_STATION)
  const [settings, setSettingsState] = useState<TelegramSettingsView>(EMPTY_SETTINGS)
  const [tokenInput, setTokenInput] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null)
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

  async function handleSave() {
    setSaving(true)
    setSaveMsg(null)
    try {
      const res = await fetch('/api/telegram-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botToken: tokenInput.trim(),
          chatId: settings.chatId,
          enabled: settings.enabled,
          notifyLaunch: settings.notifyLaunch,
          notifyLanding: settings.notifyLanding,
          notifyAnywhere: settings.notifyAnywhere,
          notifyReceiverOffline: settings.notifyReceiverOffline,
          receiverOfflineMinutes: settings.receiverOfflineMinutes,
          notifyLowBattery: settings.notifyLowBattery,
          lowBatteryVoltage: settings.lowBatteryVoltage,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || `erro ${res.status}`)
      setTokenInput('')
      const refreshed = await fetch('/api/telegram-settings', { cache: 'no-store' }).then(r => r.json())
      setSettingsState(refreshed)
      setSaveMsg({ ok: true, text: 'Configurações salvas.' })
    } catch (e: any) {
      setSaveMsg({ ok: false, text: e?.message || 'Falha ao salvar.' })
    } finally {
      setSaving(false)
      setTimeout(() => setSaveMsg(null), 3500)
    }
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

  async function handleTest() {
    setTesting(true)
    setTestMsg(null)
    try {
      const res = await fetch('/api/telegram-test', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || `erro ${res.status}`)
      setTestMsg({
        ok: true,
        text: json.withPhoto
          ? 'Mensagens de teste enviadas com mapa (lançamento + pouso) — confira o Telegram.'
          : 'Mensagens de teste enviadas (sem imagem — o servidor não conseguiu gerar o mapa agora) — confira o Telegram.',
      })
    } catch (e: any) {
      setTestMsg({ ok: false, text: e?.message || 'Falha ao enviar.' })
    } finally {
      setTesting(false)
    }
  }

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
              <label className="block text-xs text-gray-400 mb-1.5">Chat ID</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={settings.chatId}
                  onChange={e => setSettingsState(s => ({ ...s, chatId: e.target.value }))}
                  placeholder="ex.: 123456789 ou -1001234567890 (grupo)"
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
                <b className="text-gray-400">"Bad Request: chat not found"</b> no teste = quase sempre o chat ID errado
                ou vazio. O Telegram só deixa o bot mandar mensagem pra quem já falou com ele: abra o chat com o seu
                bot, mande qualquer mensagem (ex.: <span className="mono">/start</span>) e clique em{' '}
                <span className="text-gray-300">Detectar</span> pra preencher o ID automaticamente.
              </p>
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
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 rounded-md text-sm text-white hover:bg-blue-700 transition-all disabled:opacity-60"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Salvar
              </button>
              <button
                onClick={handleTest}
                disabled={testing || !settings.hasToken}
                title={!settings.hasToken ? 'Salve um bot token primeiro' : undefined}
                className="flex items-center gap-2 px-4 py-2 bg-surface border border-border rounded-md text-sm text-gray-300 hover:text-white transition-all disabled:opacity-50"
              >
                {testing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                {testing ? 'Gerando mapas…' : 'Enviar teste'}
              </button>
            </div>
            <p className="text-[11px] text-faint mt-1.5">
              O teste sorteia dois pontos aleatórios no Rio Grande do Norte e gera um mapa pra cada um (busca tiles
              do OpenStreetMap e monta a imagem no servidor) — leva alguns segundos, é normal.
            </p>

            <div className="mt-3 min-h-[16px] text-[11px]">
              {saveMsg && (
                <span className={`flex items-center gap-1.5 ${saveMsg.ok ? 'text-emerald-400' : 'text-yellow-400'}`}>
                  {saveMsg.ok ? <CheckCircle2 size={11} /> : <XCircle size={11} />} {saveMsg.text}
                </span>
              )}
              {testMsg && (
                <span className={`flex items-center gap-1.5 mt-1 ${testMsg.ok ? 'text-emerald-400' : 'text-yellow-400'}`}>
                  {testMsg.ok ? <CheckCircle2 size={11} /> : <XCircle size={11} />} {testMsg.text}
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
                onClick={handleSave}
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
            <GeofenceMap station={station} areas={areas} onChange={persistAreas} />
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
      </div>
    </div>
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
