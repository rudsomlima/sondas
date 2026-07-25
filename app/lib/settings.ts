/**
 * Preferências do usuário (localStorage `sondas_settings`), tipadas.
 * `autoRefreshMinutes` é lido de verdade por useTodayData (polling do
 * "houve lançamento hoje"); o polling ao vivo de 20s é operacional e fixo.
 *
 * Os campos de "meu receptor" ligam o painel a um receptor rdzTTGOsonde (ou
 * radiosonde_auto_rx) do próprio usuário que já faz upload pro SondeHub:
 * filtramos a telemetria pública pelo `uploader_callsign` dele, então nada
 * disso exige acesso à LAN do receptor. Callsign vazio = feature desligada.
 */

export interface KnownReceiver {
  prefix: string       // mqtt.prefix exato do firmware (chave única)
  displayName: string  // nome amigável (pode ser igual ao prefix se não customizado)
  addedAt: number      // epoch ms
}

export interface AppSettings {
  autoRefreshMinutes: number // 0 = desativado
  uploaderCallsign: string // callsign como configurado no firmware/SondeHub; '' = desligado
  homeLat: number | null // posição de casa (centro da busca por sondas próximas)
  homeLon: number | null
  // Lista de todos os receptores conhecidos (auto-descobertos via reporte
  // HTTP ou adicionados manualmente). O receptor ativo é sempre aquele cujo
  // prefix === mqttTopicPrefix.
  knownReceivers: KnownReceiver[]
  receiverAlertsEnabled: boolean // Notification API ao decodificar sonda nova
  alertRadiusKm: number // 0 = sem filtro de distância
  // Identidade do receptor ativo — precisa bater EXATAMENTE com mqtt.prefix
  // configurado no firmware; '' = nenhum receptor ativo. Usado como chave em
  // toda URL/endpoint HTTP direto (report, OTA, config remota, live status).
  mqttTopicPrefix: string
  // Config completa do firmware (app/meu-receptor), lida/gravada via HTTP
  // (ver conn-cfg.cpp no firmware). rdzConfigSecret deve bater com
  // mqtt.cfgsecret configurado no firmware (só necessário pra gravar;
  // leitura não exige segredo).
  rdzConfigSecret: string
}

const SETTINGS_KEY = 'sondas_settings'
export const DEFAULT_SETTINGS: AppSettings = {
  autoRefreshMinutes: 5,
  uploaderCallsign: '',
  homeLat: null,
  homeLon: null,
  knownReceivers: [],
  receiverAlertsEnabled: false,
  alertRadiusKm: 0,
  mqttTopicPrefix: '',
  rdzConfigSecret: '',
}

export function getSettings(): AppSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw)
    // Parse defensivo campo a campo: settings gravados por versões antigas
    // não têm os campos novos — cada um cai no seu default individualmente.
    const minutes = Number(parsed.autoRefreshMinutes)
    const homeLat = Number(parsed.homeLat)
    const homeLon = Number(parsed.homeLon)
    const radius = Number(parsed.alertRadiusKm)
    return {
      autoRefreshMinutes: isFinite(minutes) && minutes >= 0 ? minutes : DEFAULT_SETTINGS.autoRefreshMinutes,
      uploaderCallsign: typeof parsed.uploaderCallsign === 'string' ? parsed.uploaderCallsign.trim() : DEFAULT_SETTINGS.uploaderCallsign,
      homeLat: parsed.homeLat != null && isFinite(homeLat) ? homeLat : null,
      homeLon: parsed.homeLon != null && isFinite(homeLon) ? homeLon : null,
      receiverAlertsEnabled: parsed.receiverAlertsEnabled === true,
      alertRadiusKm: isFinite(radius) && radius >= 0 ? radius : DEFAULT_SETTINGS.alertRadiusKm,
      knownReceivers: Array.isArray(parsed.knownReceivers)
        ? parsed.knownReceivers.filter((r: any) => r && typeof r.prefix === 'string' && r.prefix)
        : DEFAULT_SETTINGS.knownReceivers,
      mqttTopicPrefix: typeof parsed.mqttTopicPrefix === 'string' ? parsed.mqttTopicPrefix.trim() : DEFAULT_SETTINGS.mqttTopicPrefix,
      rdzConfigSecret: typeof parsed.rdzConfigSecret === 'string' ? parsed.rdzConfigSecret : DEFAULT_SETTINGS.rdzConfigSecret,
    }
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
