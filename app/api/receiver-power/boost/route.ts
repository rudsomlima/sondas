import { NextRequest, NextResponse } from 'next/server'
import { readConfigSnapshot, readPowerBoostRequest, writePowerBoostRequest } from '@/app/lib/blobStore'
import { receiverKey } from '@/app/lib/receiverKey'
import { fetchNearbySondes } from '@/app/lib/sondehub'
import { haversineKm } from '@/app/lib/geo'

/**
 * Turbo remoto do nível de energia (firmware: checkPowerBoost em conn-cfg.cpp,
 * ver docs/POWER_MODES_GUIDE.md): força o receptor em Pleno até um horário.
 *
 * - Manual: o navegador grava um pedido assinado (HMAC com mqtt.cfgsecret,
 *   calculado no navegador — o servidor não tem o segredo e só repassa).
 * - Automático: calculado aqui, na hora em que o receptor consulta — se a
 *   config dele (último snapshot) tem power.boost_auto=1 e há sonda no ar a
 *   até power.boost_km de rxlat/rxlon no SondeHub. Sem cron: a detecção
 *   acontece no ritmo em que o próprio receptor pergunta.
 */

// Sonda "no ar": último frame recente e acima do chão (frames de sonda
// pousada/antigos não disparam).
const AIR_MAX_AGE_MS = 10 * 60_000
const AIR_MIN_ALT_M = 100
// O turbo automático vale até esse tanto depois do último frame visto — o
// receptor limita de novo por power.boost_min.
const AUTO_TAIL_MS = 20 * 60_000
// Não bate no SondeHub a cada consulta do receptor (pode ser 1/min).
const AUTO_CACHE_MS = 2 * 60_000

interface AutoResult {
  enabled: boolean
  radiusKm: number
  hasPosition: boolean
  sonde: { serial: string; distanceKm: number; alt: number; lastFrameAt: number } | null
  until: number // epoch s; 0 = nada
}

const autoCache = new Map<string, { at: number; result: AutoResult }>()

async function computeAuto(key: string): Promise<AutoResult> {
  const cached = autoCache.get(key)
  if (cached && Date.now() - cached.at < AUTO_CACHE_MS) return cached.result

  const snap = await readConfigSnapshot(key)
  const cfg = snap?.config ?? {}
  const enabled = cfg['power.boost_auto'] === '1'
  const radiusKm = Math.max(1, parseInt(cfg['power.boost_km'] ?? '150', 10) || 150)
  const lat = parseFloat(cfg['rxlat'] ?? '')
  const lon = parseFloat(cfg['rxlon'] ?? '')
  const hasPosition = isFinite(lat) && isFinite(lon) && !(lat === 0 && lon === 0)
  const result: AutoResult = { enabled, radiusKm, hasPosition, sonde: null, until: 0 }

  if (enabled && hasPosition) {
    try {
      const now = Date.now()
      const sondes = await fetchNearbySondes(lat, lon, radiusKm, 15 * 60)
      const inAir = sondes
        .map(s => ({ s, at: new Date(s.datetime.endsWith('Z') ? s.datetime : `${s.datetime}Z`).getTime() }))
        .filter(({ s, at }) => isFinite(at) && now - at < AIR_MAX_AGE_MS && s.alt > AIR_MIN_ALT_M)
        .sort((a, b) => b.at - a.at)
      if (inAir.length > 0) {
        const { s, at } = inAir[0]
        result.sonde = { serial: s.serial, distanceKm: Math.round(haversineKm(lat, lon, s.lat, s.lon)), alt: Math.round(s.alt), lastFrameAt: at }
        result.until = Math.floor((at + AUTO_TAIL_MS) / 1000)
      }
    } catch {
      // SondeHub fora do ar: sem turbo automático nesta rodada.
    }
  }
  autoCache.set(key, { at: Date.now(), result })
  return result
}

// GET ?prefix=xxx — consultado pelo FIRMWARE (chaves planas em string, é o
// que o extrator JSON dele entende) e pelo NAVEGADOR (usa `info`, com nomes
// que não colidem com as chaves do firmware).
export async function GET(req: NextRequest) {
  const prefix = req.nextUrl.searchParams.get('prefix')
  if (!prefix) return NextResponse.json({}, { status: 400 })
  const key = receiverKey(prefix)
  const [manual, auto] = await Promise.all([readPowerBoostRequest(key), computeAuto(key)])

  const body: Record<string, unknown> = {}
  if (manual) {
    body.mReqId = manual.reqId
    body.mAuth = manual.auth
    body.mUntil = String(manual.until)
  }
  if (auto.until > 0) {
    body.aUntil = String(auto.until)
    if (auto.sonde) body.aSerial = auto.sonde.serial
  }
  body.info = {
    manualUntilEpoch: manual?.until ?? 0,
    manualRequestedAt: manual?.createdAt ?? null,
    autoEnabled: auto.enabled,
    autoRadiusKm: auto.radiusKm,
    autoHasPosition: auto.hasPosition,
    autoSonde: auto.sonde,
    autoUntilEpoch: auto.until,
  }
  return NextResponse.json(body)
}

// POST { prefix, reqId, auth, until } — NAVEGADOR (PowerBoostPanel). until em
// epoch s; 0 cancela.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const prefix = typeof body?.prefix === 'string' ? body.prefix.trim() : ''
    const reqId = typeof body?.reqId === 'string' ? body.reqId : ''
    const auth = typeof body?.auth === 'string' ? body.auth : ''
    const until = Number(body?.until)
    if (!prefix || !reqId || !auth || !isFinite(until) || until < 0) {
      return NextResponse.json({ ok: false, error: 'prefix, reqId, auth e until obrigatórios' }, { status: 400 })
    }
    await writePowerBoostRequest(receiverKey(prefix), { reqId, auth, until: Math.floor(until) })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false, error: 'Erro ao gravar o turbo' }, { status: 500 })
  }
}
