/**
 * Leitura das configurações globais no servidor (R2), com cache curto por
 * instância. Só servidor.
 *
 * Wyoming: o navegador sempre manda `wyoming=0|1` nas chamadas a
 * /api/sounding (é o que torna o liga/desliga imediato); sem o parâmetro
 * (cron, chamada antiga, outro cliente) vale o que está gravado no R2.
 */
import { readAppGlobalSettings } from './blobStore'

const CACHE_MS = 10_000
let cached: { at: number; wyomingEnabled: boolean } | null = null

export async function wyomingEnabledOnServer(): Promise<boolean> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.wyomingEnabled
  const s = await readAppGlobalSettings().catch(() => null)
  cached = { at: Date.now(), wyomingEnabled: s?.wyomingEnabled !== false }
  return cached.wyomingEnabled
}

export function forgetAppSettingsCache() {
  cached = null
}

/** Parâmetro explícito do navegador vence; senão, o valor salvo no R2. */
export async function isWyomingEnabled(params: URLSearchParams): Promise<boolean> {
  const p = params.get('wyoming')
  if (p === '0') return false
  if (p === '1') return true
  return wyomingEnabledOnServer()
}
