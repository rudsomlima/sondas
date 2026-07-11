import type { Launch } from '@/app/lib/types'

// Alvo selecionado no painel: uma sonda de hoje (ao vivo/pousada) ou um
// lançamento recente com posição conhecida.
export interface SelectedTarget {
  serial: string
  lat: number
  lon: number
  altitude?: number
  climbing?: number
  isLive: boolean
  lastReportUtc?: string
  launch?: Launch
  // Presentes quando a sonda vem do "meu receptor" (frames do próprio
  // usuário no SondeHub) — snr/rssi nem sempre são enviados pelo firmware.
  snr?: number
  rssi?: number
  frequency?: number
  battV?: number // bateria da sonda (V)
  receivedByMe?: boolean
}
