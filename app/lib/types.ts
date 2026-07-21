/**
 * Tipos compartilhados do domínio — fonte única de verdade.
 * Antes duplicados em 4 arquivos (api/sounding, blobStore, historico/page, LaunchMap).
 */

export const GMT3 = -3 * 60 * 60 * 1000

// Date.now() já é um instante absoluto (UTC); nunca usar getTimezoneOffset()
// (dependeria do fuso da máquina/servidor).
export function nowGMT3(): Date {
  return new Date(Date.now() + GMT3)
}

export type SourceId = 'wyoming' | 'radiosondy' | 'sondehub'

export interface LaunchPosition {
  lat: number
  lon: number
  sondeNumber: string
  status: string
  altitude?: number
  course?: string
}

// Estatísticas do voo, calculadas a partir dos frames de trajetória do
// sondehub.org quando disponíveis (campo opcional — YearStores antigos
// não têm e continuam válidos).
export interface FlightStats {
  burstAltM?: number
  durationMin?: number
  distanceKm?: number
  bearingDeg?: number
}

// Quais fontes confirmaram este lançamento (campo opcional, gravado pelo
// cron radiosondy-sync; ausente = derivar por heurística em confidence.ts).
export interface LaunchSources {
  wyoming?: boolean
  radiosondy?: boolean
  sondehub?: boolean
}

export interface Launch {
  date: string
  time_local: string
  time_utc: string
  day: number
  month: number
  year: number
  // Preenchido pelo sync em segundo plano (app/api/radiosondy-sync).
  radiosondyMatch?: 'yes' | 'no'
  // Posição final da sonda (radiosondy.info ou sondehub.org), já resolvida.
  position?: LaunchPosition
  // Estações sem cobertura na Wyoming: 'radiosondy'/'sondehub' = horário
  // aproximado. Ausente = Wyoming (padrão).
  source?: SourceId
  approx?: boolean
  // Wyoming listou este datetime no inventário, mas a sondagem individual
  // (type=TEXT:LIST) não retornou dados ao ser verificada (ver
  // checkWyomingDataAvailable em app/api/sounding/route.ts). true = dados
  // confirmados; false = inventário e dados divergem (flakiness do servidor
  // da Wyoming); ausente = ainda não verificado (launches persistidos antes
  // desta checagem existir, ou verificação falhou por erro de rede/timeout).
  wyomingDataOk?: boolean
  // Novos campos opcionais (reformulação mission control):
  sources?: LaunchSources
  flightStats?: FlightStats
}

export interface YearStore {
  year: number
  launches: Launch[]
  monthsComplete: number[]
  updatedAt: number
}

export interface YearData {
  year: number
  station: string
  count: number
  launches: Launch[]
  errors: { month: number; error: string }[]
}

export interface TodayData {
  today: string
  station: string
  launched_today: boolean
  count: number
  launches: Launch[]
}

// Status da última execução do cron radiosondy-sync (app/api/radiosondy-sync)
// — persistido no R2 pra dar visibilidade de "bastidores" ao usuário: o que
// foi checado, quantos lançamentos ganharam posição, quantos ficaram
// pendentes (ainda dentro da janela de voo ou aguardando a próxima execução).
export interface SyncStationStatus {
  checked: number
  yes: number
  no: number
  pending: number
}

export interface SyncStatus {
  lastRunAt: number
  durationMs: number
  year: number
  stations: Record<string, SyncStationStatus>
}

// Registro de receptores conhecidos pelo servidor — populado automaticamente
// pelo navegador (POST /api/register-receiver) sempre que MQTT está
// ativado/configurado, pra o cron do servidor (app/api/poll) saber quais
// prefixos consultar. Sem isso, mqttTopicPrefix só existe no localStorage de
// cada usuário (ver app/lib/settings.ts) e o servidor não tem como saber
// quais receptores existem.
export interface ReceiverRegistryEntry {
  prefix:      string
  brokerUrl:   string
  addedAt:     number
  lastSeenAt:  number
}

export interface PollStationStatus {
  radiosondy: number // quantos voos encontrados
  sondehub:   number
}

export interface PollStatus {
  lastRunAt:   number
  durationMs:  number
  receivers: {
    total:   number
    updated: number
    errors:  number
  }
  liveFlights: {
    stations: Record<string, PollStationStatus>
    errors:   number
  }
}
