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

interface LaunchPosition {
  lat: number
  lon: number
  sondeNumber: string
  status: string
}

interface Launch {
  date: string
  time_local: string
  time_utc: string
  day: number
  month: number
  year: number
  // Preenchido pelo sync em segundo plano (app/api/radiosondy-sync/route.ts).
  radiosondyMatch?: 'yes' | 'no'
  // Posição final da sonda (radiosondy.info ou sondehub.org), preenchida ao
  // criar o lançamento (fontes aproximadas já trazem a posição em mãos) ou
  // pelo sync em segundo plano — uma vez presente, LaunchMap.tsx mostra o
  // mapa sem nenhum fetch ao vivo.
  position?: LaunchPosition
  // Estações sem cobertura na Wyoming (Station.wyomingSupported === false):
  // 'radiosondy'/'sondehub' = horário aproximado. Ausente = Wyoming (padrão).
  source?: 'wyoming' | 'radiosondy' | 'sondehub'
  approx?: boolean
}

export interface YearStore {
  year: number
  launches: Launch[]
  monthsComplete: number[]
  updatedAt: number
}

const DEFAULT_STATION_ID = '82599'

// Mantém o caminho antigo (sem estação) para a estação padrão, preservando o
// histórico já persistido antes de existir seleção de estação; demais
// estações ganham seu próprio arquivo.
function pathFor(station: string, year: number) {
  return station === DEFAULT_STATION_ID
    ? `sondas/history-${year}.json`
    : `sondas/history-${station}-${year}.json`
}

export async function readYearStore(station: string, year: number): Promise<YearStore | null> {
  if (!hasBlobCredentials()) return null
  try {
    const path = pathFor(station, year)
    const { blobs } = await list({ prefix: path })
    const blob = blobs.find(b => b.pathname === path)
    if (!blob) return null
    const res = await fetch(blob.url, { cache: 'no-store' })
    if (!res.ok) return null
    return await res.json()
  } catch (e) {
    console.error('[Blob] readYearStore falhou:', e)
    return null
  }
}

export async function writeYearStore(station: string, store: YearStore): Promise<void> {
  if (!hasBlobCredentials()) return
  try {
    await put(pathFor(station, store.year), JSON.stringify(store), {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
    })
  } catch (e) {
    console.error('[Blob] writeYearStore falhou:', e)
  }
}
