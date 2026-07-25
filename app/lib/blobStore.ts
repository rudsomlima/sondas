/**
 * Persistência do histórico anual no Cloudflare R2 (API S3-compatível).
 * Um arquivo JSON por ano, atualizado incrementalmente.
 *
 * Variáveis de ambiente necessárias (configurar no painel da Vercel e no
 * arquivo .env.local para desenvolvimento local):
 *   R2_ACCOUNT_ID        — ID da conta Cloudflare (ex.: "abc123")
 *   R2_ACCESS_KEY_ID     — chave de acesso do token R2
 *   R2_SECRET_ACCESS_KEY — chave secreta do token R2
 *   R2_BUCKET_NAME       — nome do bucket (ex.: "sondas")
 *
 * Sem essas variáveis (ex.: dev local sem .env.local), as funções são no-op.
 */
import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import type { YearStore, SyncStatus, PollStatus, KnownReceiverEntry } from './types'
import type { TodayFlight } from './radiosondy'

export type { YearStore }

function getClient(): S3Client | null {
  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  if (!accountId || !accessKeyId || !secretAccessKey) return null
  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  })
}

function bucket(): string {
  return process.env.R2_BUCKET_NAME || 'sondas'
}

const DEFAULT_STATION_ID = '82599'

function pathFor(station: string, year: number) {
  return station === DEFAULT_STATION_ID
    ? `sondas/history-${year}.json`
    : `sondas/history-${station}-${year}.json`
}

export async function readYearStore(station: string, year: number): Promise<YearStore | null> {
  const client = getClient()
  if (!client) return null
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: bucket(), Key: pathFor(station, year) }))
    const body = await res.Body?.transformToString()
    if (!body) return null
    return JSON.parse(body)
  } catch (e: any) {
    // NoSuchKey = arquivo ainda não existe (estação/ano novo) — não é erro.
    if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) return null
    console.error('[R2] readYearStore falhou:', e)
    return null
  }
}

export async function writeYearStore(station: string, store: YearStore): Promise<void> {
  const client = getClient()
  if (!client) return
  try {
    await client.send(new PutObjectCommand({
      Bucket: bucket(),
      Key: pathFor(station, store.year),
      Body: JSON.stringify(store),
      ContentType: 'application/json',
    }))
  } catch (e) {
    console.error('[R2] writeYearStore falhou:', e)
  }
}

export interface R2FileInfo {
  key: string
  station: string
  year: number
  sizeBytes: number
  lastModified: string
}

// Lista todos os arquivos de histórico no R2 usando apenas metadados S3
// (sem ler o conteúdo de cada arquivo — rápido, independente do nº de arquivos).
export async function listYearStores(): Promise<R2FileInfo[]> {
  const client = getClient()
  if (!client) return []
  try {
    const result: R2FileInfo[] = []
    let continuationToken: string | undefined
    do {
      const res = await client.send(new ListObjectsV2Command({
        Bucket: bucket(),
        Prefix: 'sondas/',
        ContinuationToken: continuationToken,
      }))
      for (const obj of res.Contents ?? []) {
        if (!obj.Key?.endsWith('.json')) continue
        const m = obj.Key.match(/history-(?:(\d+)-)?(\d{4})\.json$/)
        if (!m) continue
        result.push({
          key: obj.Key,
          station: m[1] ?? DEFAULT_STATION_ID,
          year: parseInt(m[2]),
          sizeBytes: obj.Size ?? 0,
          lastModified: obj.LastModified?.toISOString() ?? '',
        })
      }
      continuationToken = res.NextContinuationToken
    } while (continuationToken)
    return result.sort((a, b) => b.year - a.year || a.station.localeCompare(b.station))
  } catch (e) {
    console.error('[R2] listYearStores falhou:', e)
    return []
  }
}

export async function deleteYearStore(station: string, year: number): Promise<void> {
  const client = getClient()
  if (!client) return
  try {
    await client.send(new DeleteObjectCommand({ Bucket: bucket(), Key: pathFor(station, year) }))
  } catch (e) {
    console.error('[R2] deleteYearStore falhou:', e)
  }
}

// Retorna tamanho em bytes de um arquivo específico sem baixar o conteúdo.
export async function getYearStoreSize(station: string, year: number): Promise<number> {
  const client = getClient()
  if (!client) return 0
  try {
    const res = await client.send(new HeadObjectCommand({ Bucket: bucket(), Key: pathFor(station, year) }))
    return res.ContentLength ?? 0
  } catch {
    return 0
  }
}

// Lista TODOS os objetos no bucket (não só histórico) — para o painel de gestão.
export interface R2AnyObject {
  key: string
  sizeBytes: number
  lastModified: string
}

export async function listAllR2Objects(): Promise<R2AnyObject[]> {
  const client = getClient()
  if (!client) return []
  try {
    const result: R2AnyObject[] = []
    let continuationToken: string | undefined
    do {
      const res = await client.send(new ListObjectsV2Command({
        Bucket: bucket(),
        Prefix: 'sondas/',
        ContinuationToken: continuationToken,
      }))
      for (const obj of res.Contents ?? []) {
        if (!obj.Key) continue
        result.push({
          key: obj.Key,
          sizeBytes: obj.Size ?? 0,
          lastModified: obj.LastModified?.toISOString() ?? '',
        })
      }
      continuationToken = res.NextContinuationToken
    } while (continuationToken)
    return result.sort((a, b) => a.key.localeCompare(b.key))
  } catch (e) {
    console.error('[R2] listAllR2Objects falhou:', e)
    return []
  }
}

export async function deleteR2Object(key: string): Promise<void> {
  const client = getClient()
  if (!client) return
  try {
    await client.send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }))
  } catch (e) {
    console.error('[R2] deleteR2Object falhou:', e)
  }
}

const SYNC_STATUS_KEY = 'sondas/sync-status.json'

// Status da última execução do cron radiosondy-sync — dá visibilidade dos
// "bastidores" da sincronização (ver app/api/sync-status/route.ts).
export async function readSyncStatus(): Promise<SyncStatus | null> {
  const client = getClient()
  if (!client) return null
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: bucket(), Key: SYNC_STATUS_KEY }))
    const body = await res.Body?.transformToString()
    return body ? JSON.parse(body) : null
  } catch (e: any) {
    if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) return null
    console.error('[R2] readSyncStatus falhou:', e)
    return null
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Histórico de bateria e power por receptor
// Caminho: sondas/receivers/{receiverKey}/{type}-history.json
// ──────────────────────────────────────────────────────────────────────────────
function receiverHistoryPath(key: string, type: 'power' | 'batt'): string {
  return `sondas/receivers/${key}/${type}-history.json`
}

export async function readReceiverHistory<T>(key: string, type: 'power' | 'batt'): Promise<T[] | null> {
  const client = getClient()
  if (!client) return null
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: bucket(), Key: receiverHistoryPath(key, type) }))
    const body = await res.Body?.transformToString()
    if (!body) return null
    const arr = JSON.parse(body)
    return Array.isArray(arr) ? arr : null
  } catch (e: any) {
    if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) return null
    console.error('[R2] readReceiverHistory falhou:', e)
    return null
  }
}

export async function writeReceiverHistory<T>(key: string, type: 'power' | 'batt', data: T[]): Promise<void> {
  const client = getClient()
  if (!client) return
  try {
    await client.send(new PutObjectCommand({
      Bucket: bucket(),
      Key: receiverHistoryPath(key, type),
      Body: JSON.stringify(data),
      ContentType: 'application/json',
    }))
  } catch (e) {
    console.error('[R2] writeReceiverHistory falhou:', e)
  }
}

export interface ReceiverHistoryFile {
  key:          string   // receiverKey (ex.: "home_rdz01")
  type:         'power' | 'batt'
  r2Key:        string   // caminho completo no R2
  sizeBytes:    number
  lastModified: string
}

export async function listReceiverHistories(): Promise<ReceiverHistoryFile[]> {
  const client = getClient()
  if (!client) return []
  try {
    const result: ReceiverHistoryFile[] = []
    let continuationToken: string | undefined
    do {
      const res = await client.send(new ListObjectsV2Command({
        Bucket: bucket(),
        Prefix: 'sondas/receivers/',
        ContinuationToken: continuationToken,
      }))
      for (const obj of res.Contents ?? []) {
        if (!obj.Key) continue
        const m = obj.Key.match(/receivers\/([^/]+)\/(power|batt)-history\.json$/)
        if (!m) continue
        result.push({
          key:          m[1],
          type:         m[2] as 'power' | 'batt',
          r2Key:        obj.Key,
          sizeBytes:    obj.Size ?? 0,
          lastModified: obj.LastModified?.toISOString() ?? '',
        })
      }
      continuationToken = res.NextContinuationToken
    } while (continuationToken)
    return result
  } catch (e) {
    console.error('[R2] listReceiverHistories falhou:', e)
    return []
  }
}

export async function deleteReceiverHistory(key: string): Promise<void> {
  const client = getClient()
  if (!client) return
  try {
    await Promise.all([
      client.send(new DeleteObjectCommand({ Bucket: bucket(), Key: receiverHistoryPath(key, 'power') })),
      client.send(new DeleteObjectCommand({ Bucket: bucket(), Key: receiverHistoryPath(key, 'batt') })),
    ])
  } catch (e) {
    console.error('[R2] deleteReceiverHistory falhou:', e)
  }
}

export async function writeSyncStatus(status: SyncStatus): Promise<void> {
  const client = getClient()
  if (!client) return
  try {
    await client.send(new PutObjectCommand({
      Bucket: bucket(),
      Key: SYNC_STATUS_KEY,
      Body: JSON.stringify(status),
      ContentType: 'application/json',
    }))
  } catch (e) {
    console.error('[R2] writeSyncStatus falhou:', e)
  }
}


// ──────────────────────────────────────────────────────────────────────────────
// Auto-descoberta via reporte HTTP direto (ver /api/receiver-report e
// KnownReceiverEntry em types.ts) — decoupled do registro acima (que é
// específico do polling MQTT server-side e exige brokerUrl). Qualquer
// receptor que reporte algo aqui vira automaticamente descobrível pelo
// navegador, sem precisar de MQTT nem de cadastro manual.
// ──────────────────────────────────────────────────────────────────────────────
const KNOWN_RECEIVERS_KEY = 'sondas/known-receivers.json'
const KNOWN_RECEIVER_REWRITE_THRESHOLD_MS = 10 * 60_000 // evita reescrever a cada report (pmu/sleep/power/fw chegam separados)

export async function readKnownReceivers(): Promise<KnownReceiverEntry[]> {
  const client = getClient()
  if (!client) return []
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: bucket(), Key: KNOWN_RECEIVERS_KEY }))
    const body = await res.Body?.transformToString()
    if (!body) return []
    const arr = JSON.parse(body)
    return Array.isArray(arr) ? arr : []
  } catch (e: any) {
    if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) return []
    console.error('[R2] readKnownReceivers falhou:', e)
    return []
  }
}

export async function upsertKnownReceiver(prefix: string): Promise<void> {
  const client = getClient()
  if (!client) return
  const entries = await readKnownReceivers()
  const now = Date.now()
  const existing = entries.find(e => e.prefix === prefix)
  if (existing && now - existing.lastSeenAt < KNOWN_RECEIVER_REWRITE_THRESHOLD_MS) return // já visto recentemente, não reescreve à toa
  if (existing) existing.lastSeenAt = now
  else entries.push({ prefix, firstSeenAt: now, lastSeenAt: now })
  try {
    await client.send(new PutObjectCommand({
      Bucket: bucket(), Key: KNOWN_RECEIVERS_KEY, Body: JSON.stringify(entries), ContentType: 'application/json',
    }))
  } catch (e) {
    console.error('[R2] upsertKnownReceiver falhou:', e)
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Cache de voos ao vivo por estação (SondeHub + radiosondy.info), pra não
// todo mundo que abrir /historico reprocessar o feed global sozinho.
// Caminho: sondas/live/{station}.json
// ──────────────────────────────────────────────────────────────────────────────
export interface LiveFlightsSnapshot {
  updatedAt: number
  flights:   TodayFlight[]
}

function liveFlightsPath(station: string): string {
  return `sondas/live/${station}.json`
}

export async function readLiveFlights(station: string): Promise<LiveFlightsSnapshot | null> {
  const client = getClient()
  if (!client) return null
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: bucket(), Key: liveFlightsPath(station) }))
    const body = await res.Body?.transformToString()
    return body ? JSON.parse(body) : null
  } catch (e: any) {
    if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) return null
    console.error('[R2] readLiveFlights falhou:', e)
    return null
  }
}

export async function writeLiveFlights(station: string, snapshot: LiveFlightsSnapshot): Promise<void> {
  const client = getClient()
  if (!client) return
  try {
    await client.send(new PutObjectCommand({
      Bucket: bucket(),
      Key: liveFlightsPath(station),
      Body: JSON.stringify(snapshot),
      ContentType: 'application/json',
    }))
  } catch (e) {
    console.error('[R2] writeLiveFlights falhou:', e)
  }
}

const POLL_STATUS_KEY = 'sondas/poll-status.json'

export async function readPollStatus(): Promise<PollStatus | null> {
  const client = getClient()
  if (!client) return null
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: bucket(), Key: POLL_STATUS_KEY }))
    const body = await res.Body?.transformToString()
    return body ? JSON.parse(body) : null
  } catch (e: any) {
    if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) return null
    console.error('[R2] readPollStatus falhou:', e)
    return null
  }
}

export async function writePollStatus(status: PollStatus): Promise<void> {
  const client = getClient()
  if (!client) return
  try {
    await client.send(new PutObjectCommand({
      Bucket: bucket(),
      Key: POLL_STATUS_KEY,
      Body: JSON.stringify(status),
      ContentType: 'application/json',
    }))
  } catch (e) {
    console.error('[R2] writePollStatus falhou:', e)
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Firmware (auto-OTA): o app funciona como o "servidor OTA" do próprio
// usuário (ver conn-ota.cpp no firmware). Um slot por receptor (mesma chave
// receiverKey() usada no histórico de power/batt) — cada receptor cadastrado
// pode ter seu próprio firmware/versão publicados. Upload via
// /api/firmware/[receiver]/upload (Meu Receptor), servido em
// /api/firmware/[receiver]/version e /api/firmware/[receiver]/ino.
// ──────────────────────────────────────────────────────────────────────────────
function firmwareMetaPath(key: string) { return `sondas/firmware/${key}/meta.json` }
function firmwareBinPath(key: string) { return `sondas/firmware/${key}/firmware.bin` }

export interface FirmwareMeta {
  version:    string
  uploadedAt: number
  sizeBytes:  number
}

export async function readFirmwareMeta(key: string): Promise<FirmwareMeta | null> {
  const client = getClient()
  if (!client) return null
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: bucket(), Key: firmwareMetaPath(key) }))
    const body = await res.Body?.transformToString()
    return body ? JSON.parse(body) : null
  } catch (e: any) {
    if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) return null
    console.error('[R2] readFirmwareMeta falhou:', e)
    return null
  }
}

export async function writeFirmwareBinary(key: string, bin: Uint8Array, version: string): Promise<void> {
  const client = getClient()
  if (!client) throw new Error('R2 não configurado')
  await client.send(new PutObjectCommand({
    Bucket: bucket(), Key: firmwareBinPath(key), Body: bin, ContentType: 'application/octet-stream',
  }))
  const meta: FirmwareMeta = { version, uploadedAt: Date.now(), sizeBytes: bin.byteLength }
  await client.send(new PutObjectCommand({
    Bucket: bucket(), Key: firmwareMetaPath(key), Body: JSON.stringify(meta), ContentType: 'application/json',
  }))
}

export async function readFirmwareBinary(key: string): Promise<Uint8Array | null> {
  const client = getClient()
  if (!client) return null
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: bucket(), Key: firmwareBinPath(key) }))
    const bytes = await res.Body?.transformToByteArray()
    return bytes ?? null
  } catch (e: any) {
    if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) return null
    console.error('[R2] readFirmwareBinary falhou:', e)
    return null
  }
}

// Versão que o RECEPTOR reportou ter instalada (ver reportVersion em
// conn-report.cpp, chamado uma vez por boot) — distinto do FirmwareMeta acima
// (o que está PUBLICADO/disponível pra baixar). Permite o painel mostrar
// "instalado vX" vs "publicado vY" e destacar quando estão desatualizados.
export interface InstalledFirmware {
  version:      string
  reportedAt:   number
}

function installedVersionPath(key: string) { return `sondas/receivers/${key}/version.json` }

export async function readInstalledFirmware(key: string): Promise<InstalledFirmware | null> {
  const client = getClient()
  if (!client) return null
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: bucket(), Key: installedVersionPath(key) }))
    const body = await res.Body?.transformToString()
    return body ? JSON.parse(body) : null
  } catch (e: any) {
    if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) return null
    console.error('[R2] readInstalledFirmware falhou:', e)
    return null
  }
}

export async function writeInstalledFirmware(key: string, version: string): Promise<void> {
  const client = getClient()
  if (!client) return
  try {
    const data: InstalledFirmware = { version, reportedAt: Date.now() }
    await client.send(new PutObjectCommand({
      Bucket: bucket(), Key: installedVersionPath(key), Body: JSON.stringify(data), ContentType: 'application/json',
    }))
  } catch (e) {
    console.error('[R2] writeInstalledFirmware falhou:', e)
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// "Live status" (branch mqtt-cfg-only): substitui, pro painel "Meu receptor"
// em /painel, o que antes vinha ao vivo via tópicos MQTT pmu/sleep/power —
// agora o firmware reporta via HTTP direto (/api/receiver-report) e o
// navegador faz polling deste snapshot (useReceiverLiveStatus.ts). Não é
// histórico (isso já existe em readReceiverHistory) — é só "o último estado
// conhecido", sobrescrito a cada report, merge por campo (um report só de
// pmu não apaga o sleep/power já conhecidos).
// ──────────────────────────────────────────────────────────────────────────────
import type { RdzPmu, RdzSleep, RdzPower } from './mqtt'

export interface ReceiverLiveStatus {
  pmu?:       RdzPmu
  sleep?:     RdzSleep
  power?:     RdzPower
  updatedAt:  number
}

function liveStatusPath(key: string) { return `sondas/receivers/${key}/live.json` }

export async function readReceiverLiveStatus(key: string): Promise<ReceiverLiveStatus | null> {
  const client = getClient()
  if (!client) return null
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: bucket(), Key: liveStatusPath(key) }))
    const body = await res.Body?.transformToString()
    return body ? JSON.parse(body) : null
  } catch (e: any) {
    if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) return null
    console.error('[R2] readReceiverLiveStatus falhou:', e)
    return null
  }
}

export async function writeReceiverLiveStatus(
  key: string,
  data: { pmu?: RdzPmu; sleep?: RdzSleep; power?: RdzPower }
): Promise<void> {
  const client = getClient()
  if (!client) return
  try {
    const prev = await readReceiverLiveStatus(key)
    const next: ReceiverLiveStatus = {
      pmu:   data.pmu   ?? prev?.pmu,
      sleep: data.sleep ?? prev?.sleep,
      power: data.power ?? prev?.power,
      updatedAt: Date.now(),
    }
    await client.send(new PutObjectCommand({
      Bucket: bucket(), Key: liveStatusPath(key), Body: JSON.stringify(next), ContentType: 'application/json',
    }))
  } catch (e) {
    console.error('[R2] writeReceiverLiveStatus falhou:', e)
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Config remota completa via HTTP (substitui cfg/get, cfg/set do MQTT
// legado — ver conn-cfg.cpp/cfgchannel.cpp no firmware). Três peças:
//  - snapshot: o firmware empurra a config (redigida) uma vez por boot;
//  - request:  o navegador enfileira uma mudança; o firmware faz polling
//              (boot + periódico enquanto acordado) e aplica;
//  - result:   o firmware reporta o resultado; o navegador faz polling.
// ──────────────────────────────────────────────────────────────────────────────
export interface ConfigSnapshot {
  config:    Record<string, string>
  updatedAt: number
}

export interface ConfigRequest {
  reqId:     string
  auth:      string
  apply:     'live' | 'reboot'
  changes:   Record<string, string>
  createdAt: number
}

export interface ConfigResult {
  reqId:       string
  ok:          boolean
  error?:      string
  rebooting?:  boolean
  resolvedAt:  number
}

function configSnapshotPath(key: string) { return `sondas/receivers/${key}/config-snapshot.json` }
function configRequestPath(key: string) { return `sondas/receivers/${key}/config-request.json` }
function configResultPath(key: string) { return `sondas/receivers/${key}/config-result.json` }

async function readJsonKey<T>(key: string): Promise<T | null> {
  const client = getClient()
  if (!client) return null
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: bucket(), Key: key }))
    const body = await res.Body?.transformToString()
    return body ? JSON.parse(body) : null
  } catch (e: any) {
    if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) return null
    console.error(`[R2] readJsonKey(${key}) falhou:`, e)
    return null
  }
}

async function writeJsonKey(key: string, data: unknown): Promise<void> {
  const client = getClient()
  if (!client) return
  try {
    await client.send(new PutObjectCommand({
      Bucket: bucket(), Key: key, Body: JSON.stringify(data), ContentType: 'application/json',
    }))
  } catch (e) {
    console.error(`[R2] writeJsonKey(${key}) falhou:`, e)
  }
}

async function deleteJsonKey(key: string): Promise<void> {
  const client = getClient()
  if (!client) return
  try {
    await client.send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }))
  } catch (e) {
    console.error(`[R2] deleteJsonKey(${key}) falhou:`, e)
  }
}

export const readConfigSnapshot = (key: string) => readJsonKey<ConfigSnapshot>(configSnapshotPath(key))
export const writeConfigSnapshot = (key: string, config: Record<string, string>) =>
  writeJsonKey(configSnapshotPath(key), { config, updatedAt: Date.now() } as ConfigSnapshot)

export const readConfigRequest = (key: string) => readJsonKey<ConfigRequest>(configRequestPath(key))
export const writeConfigRequest = (key: string, req: Omit<ConfigRequest, 'createdAt'>) =>
  writeJsonKey(configRequestPath(key), { ...req, createdAt: Date.now() } as ConfigRequest)
export const deleteConfigRequest = (key: string) => deleteJsonKey(configRequestPath(key))

export const readConfigResult = (key: string) => readJsonKey<ConfigResult>(configResultPath(key))
export const writeConfigResult = (key: string, result: Omit<ConfigResult, 'resolvedAt'>) =>
  writeJsonKey(configResultPath(key), { ...result, resolvedAt: Date.now() } as ConfigResult)

// Mesmo padrão do canal de config.txt acima, só que carregando texto bruto
// (o conteúdo de screens1.txt) em vez de um mapa chave=valor estruturado.
export interface ScreensSnapshot {
  text:      string
  updatedAt: number
}

export interface ScreensRequest {
  reqId:     string
  auth:      string
  text:      string
  createdAt: number
}

export interface ScreensResult {
  reqId:       string
  ok:          boolean
  error?:      string
  resolvedAt:  number
}

function screensSnapshotPath(key: string) { return `sondas/receivers/${key}/screens-snapshot.json` }
function screensRequestPath(key: string) { return `sondas/receivers/${key}/screens-request.json` }
function screensResultPath(key: string) { return `sondas/receivers/${key}/screens-result.json` }

export const readScreensSnapshot = (key: string) => readJsonKey<ScreensSnapshot>(screensSnapshotPath(key))
export const writeScreensSnapshot = (key: string, text: string) =>
  writeJsonKey(screensSnapshotPath(key), { text, updatedAt: Date.now() } as ScreensSnapshot)

export const readScreensRequest = (key: string) => readJsonKey<ScreensRequest>(screensRequestPath(key))
export const writeScreensRequest = (key: string, req: Omit<ScreensRequest, 'createdAt'>) =>
  writeJsonKey(screensRequestPath(key), { ...req, createdAt: Date.now() } as ScreensRequest)
export const deleteScreensRequest = (key: string) => deleteJsonKey(screensRequestPath(key))

export const readScreensResult = (key: string) => readJsonKey<ScreensResult>(screensResultPath(key))
export const writeScreensResult = (key: string, result: Omit<ScreensResult, 'resolvedAt'>) =>
  writeJsonKey(screensResultPath(key), { ...result, resolvedAt: Date.now() } as ScreensResult)
