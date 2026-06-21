/**
 * Persistência do histórico anual no Vercel Blob Storage.
 * Um arquivo JSON por ano, atualizado incrementalmente.
 *
 * A Vercel autentica o SDK de duas formas: a antiga (BLOB_READ_WRITE_TOKEN)
 * ou a atual, via OIDC — quando o Blob Store é conectado ao projeto pelo
 * painel, ele expõe BLOB_STORE_ID e a plataforma injeta o token OIDC
 * automaticamente em runtime (sem precisar de uma env var extra). Por isso
 * checamos os dois; sem nenhum dos dois (ex.: rodando localmente sem
 * `vercel env pull`), as funções abaixo são no-op.
 */
import { put, list } from '@vercel/blob'

function hasBlobCredentials(): boolean {
  return !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID)
}

interface Launch {
  date: string
  time_local: string
  time_utc: string
  day: number
  month: number
  year: number
}

export interface YearStore {
  year: number
  launches: Launch[]
  monthsComplete: number[]
  updatedAt: number
}

function pathFor(year: number) {
  return `sondas/history-${year}.json`
}

export async function readYearStore(year: number): Promise<YearStore | null> {
  if (!hasBlobCredentials()) return null
  try {
    const { blobs } = await list({ prefix: pathFor(year) })
    const blob = blobs.find(b => b.pathname === pathFor(year))
    if (!blob) return null
    const res = await fetch(blob.url, { cache: 'no-store' })
    if (!res.ok) return null
    return await res.json()
  } catch (e) {
    console.error('[Blob] readYearStore falhou:', e)
    return null
  }
}

export async function writeYearStore(store: YearStore): Promise<void> {
  if (!hasBlobCredentials()) return
  try {
    await put(pathFor(store.year), JSON.stringify(store), {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
    })
  } catch (e) {
    console.error('[Blob] writeYearStore falhou:', e)
  }
}
