/**
 * Tipos compartilhados da integração com Telegram (notificação de
 * lançamento/pouso + áreas de interesse desenhadas no mapa). Ver
 * app/lib/blobStore.ts (persistência), app/api/telegram-* (rotas) e
 * app/telegram/page.tsx (UI).
 */

export interface TelegramSettings {
  botToken: string
  chatId: string
  enabled: boolean
  notifyLaunch: boolean
  notifyLanding: boolean
  // true (padrão) = avisa pouso em qualquer lugar (área desenhada só rotula
  // a mensagem quando bate). false = só avisa se o pouso cair DENTRO de
  // alguma área de interesse cadastrada — pousos fora não notificam.
  notifyAnywhere: boolean
  // Avisos de "meu receptor" (ver app/lib/receiverAlerts.ts, checado pelo
  // cron /api/poll — funciona mesmo sem ninguém com o app aberto). Cobre
  // TODOS os receptores conhecidos (readKnownReceivers), não só o ativo no
  // navegador de quem configurou.
  notifyReceiverOffline: boolean
  notifyReceiverOnline: boolean
  // Minutos sem nenhum report (pmu/sleep/power) pra considerar "offline" —
  // nunca conta tempo de deep sleep esperado (ver isReceiverFresh/
  // deriveSleepState em powerState.ts).
  receiverOfflineMinutes: number
  notifyLowBattery: boolean
  notifyBatteryOk: boolean
  lowBatteryVoltage: number
  // Estações (id STNM) cujos lançamentos/pousos o servidor avisa sozinho, via
  // cron /api/poll, sem ninguém com o app aberto. Ausente = só a estação padrão.
  watchedStationIds?: string[]
  // Raio de alcance (km) por estação monitorada; ausente = 300 km.
  stationRadiusKm?: Record<string, number>
  messageTemplates?: TelegramMessageTemplates
  updatedAt: number
}

export type TelegramMessageTemplateKey = 'launch' | 'landing' | 'receiverOffline' | 'receiverOnline' | 'lowBattery' | 'batteryOk'
export type TelegramMessageTemplates = Partial<Record<TelegramMessageTemplateKey, string>>

export const DEFAULT_TELEGRAM_SETTINGS: TelegramSettings = {
  botToken: '',
  chatId: '',
  enabled: false,
  notifyLaunch: true,
  notifyLanding: true,
  notifyAnywhere: true,
  notifyReceiverOffline: true,
  notifyReceiverOnline: true,
  receiverOfflineMinutes: 30,
  notifyLowBattery: true,
  notifyBatteryOk: true,
  lowBatteryVoltage: 3.5,
  updatedAt: 0,
}

export type GeofenceShape =
  | { type: 'circle'; center: [number, number]; radiusM: number }
  | { type: 'polygon'; points: [number, number][] }

export interface Geofence {
  id: string
  name: string
  shape: GeofenceShape
  // ausente = true (compat com áreas criadas antes deste campo existir).
  // false = área fica desenhada mas não conta pra notificação (nem pra
  // rotular a mensagem, nem como área restrita com "qualquer lugar" desligado).
  enabled?: boolean
  createdAt: number
}

export const DEFAULT_WATCH_RADIUS_KM = 300
