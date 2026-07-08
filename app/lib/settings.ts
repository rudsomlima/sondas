/**
 * Preferências do usuário (localStorage `sondas_settings`), tipadas.
 * `autoRefreshMinutes` é lido de verdade por useTodayData (polling do
 * "houve lançamento hoje"); o polling ao vivo de 20s é operacional e fixo.
 */

export interface AppSettings {
  autoRefreshMinutes: number // 0 = desativado
}

const SETTINGS_KEY = 'sondas_settings'
export const DEFAULT_SETTINGS: AppSettings = { autoRefreshMinutes: 5 }

export function getSettings(): AppSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw)
    const minutes = Number(parsed.autoRefreshMinutes)
    return { autoRefreshMinutes: isFinite(minutes) && minutes >= 0 ? minutes : DEFAULT_SETTINGS.autoRefreshMinutes }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function setSettings(s: AppSettings): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {
    // localStorage cheio/indisponível — preferência não crítica
  }
}
