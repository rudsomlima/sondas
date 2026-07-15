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

export interface AppSettings {
  autoRefreshMinutes: number // 0 = desativado
  uploaderCallsign: string // callsign como configurado no firmware/SondeHub; '' = desligado
  homeLat: number | null // posição de casa (centro da busca por sondas próximas)
  homeLon: number | null
  receiverAlertsEnabled: boolean // Notification API ao decodificar sonda nova
  alertRadiusKm: number // 0 = sem filtro de distância
  // MQTT direto do firmware (opcional, desligado por padrão): o TTGO publica
  // num broker público (TCP 1883, sem TLS — limitação do firmware) e o
  // browser assina o mesmo broker via WSS. Fonte primária quando fresco;
  // o polling SondeHub continua como fallback automático.
  mqttEnabled: boolean
  mqttBrokerUrl: string // endpoint WebSocket do broker (ws:// ou wss://)
  mqttTopicPrefix: string // deve bater EXATAMENTE com mqtt.prefix do firmware; '' = inoperante
  // Config completa do firmware (app/meu-receptor) — canal escolhido pelo
  // usuário pra ler/gravar; null = ainda não escolheu. rdzConfigSecret deve
  // bater com mqtt.cfgsecret configurado no firmware (só necessário pro
  // canal MQTT gravar; leitura MQTT e o canal HTTP não exigem segredo).
  rdzConfigChannel: 'http' | 'mqtt' | null
  rdzConfigSecret: string
}

const SETTINGS_KEY = 'sondas_settings'
export const DEFAULT_SETTINGS: AppSettings = {
  autoRefreshMinutes: 5,
  uploaderCallsign: '',
  homeLat: null,
  homeLon: null,
  receiverAlertsEnabled: false,
  alertRadiusKm: 0,
  mqttEnabled: false,
  mqttBrokerUrl: 'wss://broker.emqx.io:8084/mqtt',
  mqttTopicPrefix: '',
  rdzConfigChannel: null,
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
      mqttEnabled: parsed.mqttEnabled === true,
      mqttBrokerUrl: typeof parsed.mqttBrokerUrl === 'string' && /^wss?:\/\//.test(parsed.mqttBrokerUrl.trim())
        ? parsed.mqttBrokerUrl.trim()
        : DEFAULT_SETTINGS.mqttBrokerUrl,
      mqttTopicPrefix: typeof parsed.mqttTopicPrefix === 'string' ? parsed.mqttTopicPrefix.trim() : DEFAULT_SETTINGS.mqttTopicPrefix,
      rdzConfigChannel: parsed.rdzConfigChannel === 'http' || parsed.rdzConfigChannel === 'mqtt' ? parsed.rdzConfigChannel : null,
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
