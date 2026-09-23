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
  // Relato de recuperação do SondeHub (sondehubRecovery.ts) — opcionais,
  // YearStores antigos não têm.
  recoveredBy?: string
  recoveryNote?: string
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

// Quais fontes confirmaram este lançamento — preenchido a partir do registro
// de sondas (sourcesFromRecord em sondeLaunches.ts); ausente = derivar por
// heurística em confidence.ts.
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
  // Legado: gravado pelo antigo cron radiosondy-sync (removido em 2026-09 —
  // substituído pelo registro de sondas, ver sourcesFromRecord em
  // sondeLaunches.ts). Ainda lido se existir em YearStores antigos.
  radiosondyMatch?: 'yes' | 'no'
  // Posição final da sonda (radiosondy.info ou sondehub.org), já resolvida.
  position?: LaunchPosition
  // Estações sem cobertura na Wyoming: 'radiosondy'/'sondehub' = horário
  // aproximado. Ausente = Wyoming (padrão).
  source?: SourceId
  approx?: boolean
  // Strength of the link between telemetry and launch site. Geographic means
  // the sonde merely passed within the configured radius and is not, alone,
  // proof that this station launched it.
  association?: 'station' | 'geographic' | 'startplace'
  // Wyoming listou este datetime no inventário, mas a sondagem individual
  // (type=TEXT:LIST) não retornou dados ao ser verificada (ver
  // checkWyomingDataAvailable em app/api/sounding/route.ts). true = dados
  // confirmados; false = inventário e dados divergem (flakiness do servidor
  // da Wyoming); ausente = ainda não verificado (launches persistidos antes
  // desta checagem existir, ou verificação falhou por erro de rede/timeout).
  wyomingDataOk?: boolean
  // Primeiro quadro recebido desta sonda (registro de sondas no R2, ver
  // app/lib/sondeRegistry.ts), ISO UTC. Quando
  // presente é ELE o horário de lançamento mostrado na interface — `time_local`
  // segue sendo o slot sinótico nominal da Wyoming (e a identidade do
  // lançamento em caches/merges). Ver launchDisplayTime em launchUtils.ts.
  firstFrameUtc?: string
  // Estações que participaram da recepção RF desta sonda (registro de sondas
  // no R2: radiosondy.info + SondeHub, ver app/lib/sondeRegistry.ts), em
  // ordem de quadros recebidos. Não confundir com quem RECUPEROU o
  // equipamento fisicamente (LaunchPosition.recoveredBy).
  receivers?: string[]
  receiverFrames?: Record<string, number>
  lastReceiver?: string   // de quem foi o último sinal recebido
  lastReceiverAt?: string // ISO UTC
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
  all_this_month?: Launch[]
  candidates?: Launch[]
  partial?: boolean
  sourceStatus?: Record<string, string>
}

// Lista de receptores que já reportaram algo pelo canal HTTP direto (ver
// /api/receiver-report), independente de MQTT — populada automaticamente a
// cada report, pra o navegador de QUALQUER usuário descobrir sozinho um
// receptor que ele ligou, sem precisar "cadastrar" nada manualmente (basta o
// firmware ter mqtt.siteurl apontando pra este app, já necessário pro
// auto-OTA/persistência funcionarem).
export interface KnownReceiverEntry {
  prefix:      string
  firstSeenAt: number
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
  // Passo do registro de sondas (backfillRegistry) nesta execução.
  registry?: {
    seeded: number    // posições de lançamento novas semeadas no registro
    checked: string[] // sondas consultadas nas fontes
    listeners?: number // estações ativas atualizadas (a cada 6 h)
    error?: string
  }
  // Checagem de receptores offline/bateria baixa nesta execução (ver
  // app/lib/receiverAlerts.ts) — independe de alguém com o app aberto.
  receiverAlerts?: {
    checked: number     // quantos receptores conhecidos foram avaliados
    sent: number         // quantas mensagens foram mandadas pro Telegram
    error?: string
  }
}
