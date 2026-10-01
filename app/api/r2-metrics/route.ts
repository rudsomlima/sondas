import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const QUERY = `query R2Usage($accountTag: String!, $startDate: Time!, $endDate: Time!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      r2OperationsAdaptiveGroups(
        limit: 10000
        filter: { datetime_geq: $startDate, datetime_leq: $endDate }
      ) {
        sum { requests }
        dimensions { actionType bucketName }
      }
      r2StorageAdaptiveGroups(
        limit: 10000
        filter: { datetime_geq: $startDate, datetime_leq: $endDate }
        orderBy: [datetime_DESC]
      ) {
        max { payloadSize objectCount }
        dimensions { bucketName datetime }
      }
      r2BandwidthUsageAdaptiveGroups(
        limit: 10000
        filter: { datetime_geq: $startDate, datetime_lt: $endDate }
      ) {
        sum { bytesUpload bytesDownload }
        dimensions { bucketName }
      }
    }
  }
}`

const CLASS_A = new Set([
  'listbuckets', 'putbucket', 'listobjects', 'listobjectsv2', 'putobject', 'copyobject',
  'completemultipartupload', 'createmultipartupload', 'lifecyclestoragetiertransition',
  'listmultipartuploads', 'uploadpart', 'uploadpartcopy', 'listparts', 'putbucketencryption',
  'putbucketcors', 'putbucketlifecycleconfiguration',
])
const CLASS_B = new Set([
  'headbucket', 'headobject', 'getobject', 'usagesummary', 'getbucketencryption',
  'getbucketlocation', 'getbucketcors', 'getbucketlifecycleconfiguration',
])

type OperationRow = { sum?: { requests?: number | null }; dimensions?: { actionType?: string | null; bucketName?: string | null } }
type StorageRow = { max?: { payloadSize?: number | null; objectCount?: number | null }; dimensions?: { bucketName?: string | null; datetime?: string | null } }
type BandwidthRow = { sum?: { bytesUpload?: number | null; bytesDownload?: number | null }; dimensions?: { bucketName?: string | null } }

function n(value: number | null | undefined): number { return Number.isFinite(value) ? Number(value) : 0 }

export async function GET() {
  const accountTag = process.env.R2_ACCOUNT_ID
  const token = process.env.CLOUDFLARE_API_TOKEN
  if (!accountTag || !token) {
    return NextResponse.json({ configured: false, missing: [!accountTag && 'R2_ACCOUNT_ID', !token && 'CLOUDFLARE_API_TOKEN'].filter(Boolean) })
  }

  const now = new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const startDate = start.toISOString()
  const endDate = now.toISOString()
  const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: QUERY, variables: { accountTag, startDate, endDate } }),
    cache: 'no-store',
    signal: AbortSignal.timeout(12_000),
  }).catch(() => null)

  if (!response?.ok) return NextResponse.json({ configured: true, error: 'Não foi possível consultar o Cloudflare Analytics.' }, { status: 502 })
  const payload = await response.json().catch(() => null)
  if (!payload || payload.errors?.length) {
    return NextResponse.json({ configured: true, error: 'Token sem permissão de Analytics ou métricas R2 indisponíveis.' }, { status: 502 })
  }

  const account = payload.data?.viewer?.accounts?.[0]
  if (!account) return NextResponse.json({ configured: true, error: 'A API não retornou dados para esta conta.' }, { status: 502 })

  const buckets = new Map<string, { classA: number; classB: number; unclassified: number; uploadBytes: number; downloadBytes: number; storageBytes: number; objects: number }>()
  const get = (name: string | null | undefined) => {
    const key = name || '(sem bucket)'
    let value = buckets.get(key)
    if (!value) {
      value = { classA: 0, classB: 0, unclassified: 0, uploadBytes: 0, downloadBytes: 0, storageBytes: 0, objects: 0 }
      buckets.set(key, value)
    }
    return value
  }

  let classA = 0
  let classB = 0
  let unclassified = 0
  for (const row of (account.r2OperationsAdaptiveGroups ?? []) as OperationRow[]) {
    const count = n(row.sum?.requests)
    const action = (row.dimensions?.actionType ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
    const bucket = get(row.dimensions?.bucketName)
    if (CLASS_A.has(action)) { classA += count; bucket.classA += count }
    else if (CLASS_B.has(action)) { classB += count; bucket.classB += count }
    else { unclassified += count; bucket.unclassified += count }
  }

  // Use each bucket's newest storage sample in the current cycle. This is a
  // current footprint, not a substitute for Cloudflare's monthly GB-month bill.
  const newestStorage = new Map<string, { at: string; bytes: number; objects: number }>()
  for (const row of (account.r2StorageAdaptiveGroups ?? []) as StorageRow[]) {
    const bucketName = row.dimensions?.bucketName || '(sem bucket)'
    const at = row.dimensions?.datetime || ''
    const prev = newestStorage.get(bucketName)
    if (!prev || at > prev.at) newestStorage.set(bucketName, { at, bytes: n(row.max?.payloadSize), objects: n(row.max?.objectCount) })
  }
  for (const [name, sample] of newestStorage) {
    const bucket = get(name)
    bucket.storageBytes = sample.bytes
    bucket.objects = sample.objects
  }

  let uploadBytes = 0
  let downloadBytes = 0
  for (const row of (account.r2BandwidthUsageAdaptiveGroups ?? []) as BandwidthRow[]) {
    const up = n(row.sum?.bytesUpload)
    const down = n(row.sum?.bytesDownload)
    uploadBytes += up
    downloadBytes += down
    const bucket = get(row.dimensions?.bucketName)
    bucket.uploadBytes += up
    bucket.downloadBytes += down
  }

  const storageBytes = [...newestStorage.values()].reduce((sum, sample) => sum + sample.bytes, 0)
  const estimatedClassACost = Math.ceil(Math.max(0, classA - 1_000_000) / 1_000_000) * 4.5
  const estimatedClassBCost = Math.ceil(Math.max(0, classB - 10_000_000) / 1_000_000) * 0.36

  return NextResponse.json({
    configured: true,
    period: { start: startDate, end: endDate },
    operations: { classA, classB, unclassified },
    bandwidth: { uploadBytes, downloadBytes },
    storage: { bytes: storageBytes, objects: [...newestStorage.values()].reduce((sum, sample) => sum + sample.objects, 0) },
    estimate: { classA: estimatedClassACost, classB: estimatedClassBCost, total: estimatedClassACost + estimatedClassBCost },
    buckets: [...buckets].map(([name, data]) => ({ name, ...data })).sort((a, b) => b.classA + b.classB - a.classA - a.classB),
    source: 'cloudflare-graphql',
  })
}
