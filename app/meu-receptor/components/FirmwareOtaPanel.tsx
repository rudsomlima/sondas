'use client'

import { useEffect, useState } from 'react'
import { Cpu, UploadCloud, CheckCircle2, XCircle, Loader2, AlertTriangle } from 'lucide-react'

interface FirmwareMeta {
  version:    string
  uploadedAt: number
  sizeBytes:  number
}

interface InstalledFirmware {
  version:    string
  reportedAt: number
}

interface FirmwareOtaPanelProps {
  receiverKey: string // mesma chave do histórico power/batt (receiverKey(mqtt.prefix))
  pollMs?: number // cadência do polling em segundo plano (default 20s) — ver mqtt.report_interval
}

const DEFAULT_POLL_MS = 20_000
const MIN_POLL_MS = 5_000
const MAX_POLL_MS = 60_000

// Painel "Firmware (auto-OTA)": o próprio app funciona como servidor de OTA
// do receptor (ver conn-ota.cpp no firmware) — o usuário publica o
// firmware.bin compilado aqui, e o ESP32 baixa sozinho no próximo wake se
// `mqtt.siteurl` apontar pra este app (mesmo campo usado por report/config
// remota — o firmware monta o path de firmware sozinho a partir dele + o
// próprio mqtt.prefix). Um slot por receptor: cada receiverKey tem seu
// próprio publicado/instalado.
export default function FirmwareOtaPanel({ receiverKey, pollMs }: FirmwareOtaPanelProps) {
  const effectivePollMs = pollMs ? Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, pollMs)) : DEFAULT_POLL_MS
  const [meta, setMeta] = useState<FirmwareMeta | null>(null)
  const [installed, setInstalled] = useState<InstalledFirmware | null>(null)
  const [loading, setLoading] = useState(true)
  const [version, setVersion] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [origin, setOrigin] = useState('')

  const load = (silent = false) => {
    if (!silent) setLoading(true)
    fetch(`/api/firmware/${receiverKey}/upload`)
      .then(r => r.json())
      .then(d => { setMeta(d.meta ?? null); setInstalled(d.installed ?? null) })
      .catch(() => {})
      .finally(() => { if (!silent) setLoading(false) })
  }

  useEffect(() => {
    load()
    setOrigin(window.location.origin)
    // Atualiza sozinho (sem piscar o spinner) — pega a versão instalada
    // assim que o receptor reportar de novo, sem precisar recarregar a página.
    const id = setInterval(() => load(true), effectivePollMs)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiverKey, effectivePollMs])

  const handleUpload = async () => {
    if (!file || !version.trim()) return
    setUploading(true)
    setResult(null)
    try {
      const form = new FormData()
      form.append('version', version.trim())
      form.append('bin', file)
      const res = await fetch(`/api/firmware/${receiverKey}/upload`, { method: 'POST', body: form })
      const data = await res.json()
      if (data.ok) {
        setResult({ ok: true, msg: 'Firmware publicado.' })
        setVersion('')
        setFile(null)
        load()
      } else {
        setResult({ ok: false, msg: data.error ?? 'Erro ao publicar.' })
      }
    } catch {
      setResult({ ok: false, msg: 'Erro de rede ao publicar.' })
    } finally {
      setUploading(false)
    }
  }

  const outOfDate = meta && installed && meta.version !== installed.version

  return (
    <div className="panel p-5 mb-6">
      <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
        <Cpu size={14} className="text-blue-400" />
        Firmware (auto-OTA)
      </h2>

      <p className="text-xs text-dim mb-3">
        O app funciona como o servidor de atualização deste receptor ({receiverKey}). Publique aqui o{' '}
        <code className="text-[11px]">firmware.bin</code> compilado (build{' '}
        <code className="text-[11px]">pio run -e ttgo-lora32</code>) e configure nele{' '}
        <code className="text-[11px]">mqtt.siteurl</code> = <code className="text-[11px]">{origin}</code>{' '}
        (mesmo campo do reporte de bateria e da config remota — o firmware monta o resto da URL sozinho).
        No próximo wake sem sonda no ar e com bateria ok, ele confere a versão e se atualiza sozinho.
      </p>

      {loading ? (
        <p className="text-xs text-dim flex items-center gap-2 mb-3">
          <Loader2 size={12} className="animate-spin" /> Carregando…
        </p>
      ) : (
        <div className="mb-3 text-xs text-dim mono space-y-1">
          {meta ? (
            <div>
              Publicado: <span className="text-white">{meta.version}</span>
              {' · '}{(meta.sizeBytes / 1024).toFixed(0)} KB
              {' · '}{new Date(meta.uploadedAt).toLocaleString('pt-BR')}
            </div>
          ) : (
            <p className="text-faint">Nenhum firmware publicado ainda.</p>
          )}
          {installed ? (
            <div className="flex items-center gap-1.5">
              Instalado no receptor:{' '}
              <span className={outOfDate ? 'text-amber-400' : 'text-emerald-400'}>{installed.version}</span>
              {' · reportado '}{new Date(installed.reportedAt).toLocaleString('pt-BR')}
              {outOfDate && (
                <span className="flex items-center gap-1 text-amber-400" title="Diferente do publicado — vai atualizar no próximo wake elegível">
                  <AlertTriangle size={11} /> desatualizado
                </span>
              )}
            </div>
          ) : (
            <p className="text-faint">
              Receptor ainda não reportou a versão instalada (precisa do firmware com conn-report.cpp/reportVersion).
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={version}
          onChange={e => setVersion(e.target.value)}
          placeholder="versão (ex.: 2026.07.23)"
          className="px-2 py-1.5 rounded border border-border bg-bg text-xs text-white w-44"
        />
        <input
          type="file"
          accept=".bin"
          onChange={e => setFile(e.target.files?.[0] ?? null)}
          className="text-xs text-dim"
        />
        <button
          onClick={handleUpload}
          disabled={!file || !version.trim() || uploading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-blue-600/20 border border-blue-500/40 text-blue-300 text-xs hover:bg-blue-600/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {uploading ? <Loader2 size={12} className="animate-spin" /> : <UploadCloud size={12} />}
          Publicar
        </button>
      </div>

      {result && (
        <p className={`mt-2 text-xs flex items-center gap-1.5 ${result.ok ? 'text-emerald-400' : 'text-red-400'}`}>
          {result.ok ? <CheckCircle2 size={12} /> : <XCircle size={12} />} {result.msg}
        </p>
      )}
    </div>
  )
}
