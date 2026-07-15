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
import type { YearStore, SyncStatus } from './types'

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
