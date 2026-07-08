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
}
