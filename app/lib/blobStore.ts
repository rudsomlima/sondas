/**
 * Persistência do histórico anual no Vercel Blob Storage.
 * Um arquivo JSON por ano, atualizado incrementalmente.
 * Requer a env var BLOB_READ_WRITE_TOKEN (criada ao conectar um Blob Store
 * ao projeto no painel da Vercel). Sem ela, as funções abaixo são no-op.
 */
import { put, list } from '@vercel/blob'

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
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null
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
  if (!process.env.BLOB_READ_WRITE_TOKEN) return
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
