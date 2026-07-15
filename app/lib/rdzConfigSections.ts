/**
 * Metadados de exibição da config completa do rdzTTGOsonde — seções, rótulos
 * e tipo de input, espelhando RX_FSK/data/cfg.js (a própria UI web do
 * firmware) e os tipos de RX_FSK/RX_FSK.ino:config_list[]. Fonte da verdade
 * pro VALOR é sempre o firmware (via RdzConfig); isto aqui é só apresentação
 * — não precisa vir do wire.
 *
 * `needsReboot` é uma heurística nossa (o firmware não expõe isso por campo
 * hoje — só o texto genérico "itens marcados needs reboot" na própria página
 * de config dele, sem lista formal): tudo em hardware/pinos, mais os poucos
 * campos que o cfg.js já anota manualmente (kisstnc.active, mqtt.active,
 * oled_rst). Não é autoritativo — é só um alerta na UI pra guiar "aplicar +
 * reiniciar" vs "aplicar agora".
 */

export type RdzFieldKind = 'int' | 'double' | 'string' | 'intlist'

export interface RdzConfigFieldMeta {
  key: string
  label: string
  kind: RdzFieldKind
  needsReboot?: boolean
}

export interface RdzConfigSectionMeta {
  label: string
  fields: RdzConfigFieldMeta[]
}

const f = (key: string, label: string, kind: RdzFieldKind, needsReboot?: boolean): RdzConfigFieldMeta =>
  ({ key, label, kind, needsReboot })

export const RDZ_CONFIG_SECTIONS: RdzConfigSectionMeta[] = [
  {
    label: 'Geral',
    fields: [
      f('wifi', 'Modo WiFi (0=off, 1=cliente, 2=AP, 3=cliente ou AP, 4=cliente sem scan)', 'int'),
      f('mdnsname', 'Nome mDNS na rede', 'string', true),
      f('ephftp', 'Servidor FTP de efemérides (decoder RS92)', 'string'),
      f('debug', 'Nível de debug (0=err/1=warn/2=info/3=all; +10=cor)', 'int'),
      f('maxsonde', 'Máximo de entradas de frequência (≤ 50)', 'int'),
      f('rxlat', 'Latitude fixa do receptor', 'double'),
      f('rxlon', 'Longitude fixa do receptor', 'double'),
      f('rxalt', 'Altitude fixa do receptor', 'double'),
      f('b2mute', 'Botão 2 (clique médio) muta LED/buzzer (minutos)', 'int'),
    ],
  },
  {
    label: 'Display (OLED/TFT)',
    fields: [
      f('screenfile', 'Config de telas (0=auto; 1-5=predefinido; outro=custom)', 'int'),
      f('display', 'Telas exibidas (scanner, padrão, ...)', 'intlist'),
      f('dispsaver', 'Proteção de tela (0=sempre ligado/1=sempre/2=se sem rx [+10*n: desliga após n s])', 'int'),
      f('dispcontrast', 'Contraste OLED (-1=padrão de fábrica; 0..255)', 'int'),
      f('norx_timeout', 'Timeout sem RX em segundos (-1=desabilitado)', 'int'),
      f('tft_orient', 'Orientação TFT (0/1/2/3); flip OLED: 3', 'int'),
    ],
  },
  {
    label: 'Espectro',
    fields: [
      f('spectrum', 'Espectro ao iniciar (-1=não, 0=sempre, >0=segundos)', 'int'),
      f('startfreq', 'Frequência inicial (MHz, padrão 400)', 'int'),
      f('channelbw', 'Banda do canal (kHz)', 'int'),
      f('marker', 'Marcador de frequência no espectro', 'int'),
      f('noisefloor', 'Piso de ruído do espectro', 'int'),
    ],
  },
  {
    label: 'Receptor / decoders',
    fields: [
      f('freqofs', 'Offset de frequência RX (Hz)', 'int'),
      f('rs41.agcbw', 'RS41 — banda AGC', 'int'),
      f('rs41.rxbw', 'RS41 — banda RX', 'int'),
      f('rs92.rxbw', 'RS92 — banda RX (e AGC)', 'int'),
      f('rs92.alt2d', 'RS92 — altitude padrão em fix 2D', 'int'),
      f('dfm.agcbw', 'DFM — banda AGC', 'int'),
      f('dfm.rxbw', 'DFM — banda RX', 'int'),
      f('m10m20.agcbw', 'M10/M20 — banda AGC', 'int'),
      f('m10m20.rxbw', 'M10/M20 — banda RX', 'int'),
      f('mp3h.agcbw', 'MP3H — banda AGC', 'int'),
      f('mp3h.rxbw', 'MP3H — banda RX', 'int'),
    ],
  },
  {
    label: 'KISS TNC / AXUDP / APRS-TCP',
    fields: [
      f('call', 'Callsign (APRS)', 'string'),
      f('passcode', 'Passcode APRS', 'int'),
      f('kisstnc.active', 'KISS TNC (porta 14590)', 'int', true),
      f('axudp.active', 'AXUDP ativo', 'int'),
      f('axudp.host', 'AXUDP host[:porta]', 'string'),
      f('axudp.ratelimit', 'Limite de taxa AXUDP', 'int'),
      f('tcp.active', 'APRS TCP ativo', 'int'),
      f('tcp.timeout', 'APRS TCP timeout [s] (0=off, 25=on)', 'int'),
      f('tcp.host', 'APRS TCP host[:porta] (padrão 14580)', 'string'),
      f('tcp.host2', 'APRS TCP host2[:porta]', 'string'),
      f('tcp.highrate', 'Limite de taxa APRS TCP', 'int'),
      f('tcp.objcall', 'APRS object call', 'string'),
      f('tcp.beaconsym', 'Símbolo APRS do tracker', 'string'),
      f('tcp.chase', 'Modo de posição APRS (0=off, 1=fixo, 2=chase/GPS, 3=auto)', 'int'),
      f('tcp.comment', 'Comentário de posição APRS', 'string'),
    ],
  },
  {
    label: 'MQTT (tópicos de status)',
    fields: [
      f('mqtt.active', 'Bitfield: 1=sondas, 2=uptime, 4=PMU, 8=GPS, 16=espectro, 128=debug (0 desliga)', 'int', true),
      f('mqtt.id', 'ID do cliente MQTT', 'string'),
      f('mqtt.host', 'Host do broker MQTT', 'string'),
      f('mqtt.port', 'Porta do broker MQTT', 'int'),
      f('mqtt.username', 'Usuário MQTT', 'string'),
      f('mqtt.password', 'Senha MQTT', 'string'),
      f('mqtt.prefix', 'Prefixo dos tópicos', 'string'),
      f('mqtt.report_interval', 'Intervalo de report (ms)', 'int'),
    ],
  },
  {
    label: 'Chasemapper',
    fields: [
      f('cm.active', 'Chasemapper ativo', 'int'),
      f('cm.host', 'Host UDP do Chasemapper', 'string'),
      f('cm.port', 'Porta UDP do Chasemapper', 'int'),
    ],
  },
  {
    label: 'SondeSeeker',
    fields: [
      f('ss.active', 'SondeSeeker ativo', 'int'),
      f('ss.host', 'Host UDP do SondeSeeker', 'string'),
      f('ss.port', 'Porta UDP do SondeSeeker', 'int'),
    ],
  },
  {
    label: 'SondeHub',
    fields: [
      f('sondehub.active', 'Envio pro SondeHub ativo', 'int'),
      f('sondehub.chase', 'Modo de posição (0=off, 1=fixo, 2=chase/GPS, 3=auto)', 'int'),
      f('sondehub.host', 'Host SondeHub (NÃO ALTERAR)', 'string'),
      f('sondehub.callsign', 'Callsign de uploader', 'string'),
      f('sondehub.antenna', 'Antena (opcional, visível no tracker)', 'string'),
      f('sondehub.email', 'E-mail de contato (opcional)', 'string'),
      f('sondehub.fiactive', 'Importação de frequências ativa', 'int'),
      f('sondehub.fiinterval', 'Intervalo de importação (min, ≥ 5)', 'int'),
      f('sondehub.fimaxdist', 'Distância máxima de importação (km, ≤ 700)', 'int'),
      f('sondehub.fimaxage', 'Idade máxima de importação (h, ≤ 48)', 'double'),
    ],
  },
  {
    label: 'Cartão SD',
    fields: [
      f('sd.cs', 'SD — pino CS', 'int', true),
      f('sd.miso', 'SD — pino MISO/DI', 'int', true),
      f('sd.mosi', 'SD — pino MOSI/DO', 'int', true),
      f('sd.clk', 'SD — pino CLK', 'int', true),
      f('sd.sync', 'SD — intervalo de sync [s]', 'int'),
      f('sd.name', 'SD — nomeação (0=plano, 1=pastas AAMM)', 'int'),
      f('sd.speed', 'SD — velocidade SPI (Hz, 0=padrão)', 'int'),
    ],
  },
  {
    label: 'Deep Sleep / Energia',
    fields: [
      f('sleep.mode', 'Deep sleep (0=off, 1=on): dorme fora das janelas de recepção', 'int'),
      f('sleep.w1start', 'Janela 1 — início (min locais desde 00:00, ex. 510=08:30)', 'int'),
      f('sleep.w1dur', 'Janela 1 — duração (min; 0=desabilita)', 'int'),
      f('sleep.w2start', 'Janela 2 — início (min locais, ex. 1230=20:30)', 'int'),
      f('sleep.w2dur', 'Janela 2 — duração (min; 0=desabilita)', 'int'),
      f('sleep.gmtoff', 'Fuso local em minutos (Natal/BRT: -180)', 'int'),
      f('sleep.holdoff', 'Min sem sinal (após decodificar) antes de dormir', 'int'),
      f('sleep.wakemargin', 'Min fixos de folga pra acordar antes da janela', 'int'),
      f('sleep.driftpct', '% do sono descontado por drift do relógio (proporcional, soma com wakemargin)', 'int'),
      f('sleep.cpu80', 'CPU a 80MHz (0=off, 1=on; economia ~20-30mA)', 'int'),
      f('sleep.wifips', 'WiFi modem sleep (0=off, 1=on)', 'int'),
      f('sleep.vlow', 'Bateria baixa (V): reduz janela/holdoff pela metade', 'double'),
      f('sleep.vcrit', 'Bateria crítica (V): modo economia agressivo — nunca dorme só por isso', 'double'),
      f('sleep.crituploadmult', 'Multiplicador do intervalo de upload MQTT em modo economia', 'int'),
      f('sleep.vpanic', 'Proteção física da célula (V), 0=off: força sleep real mesmo em voo', 'double'),
      f('sleep.extend', 'Escuta extra após a janela (min, 0=off)', 'int'),
      f('sleep.extendmode', 'Modo da escuta extra (0=WiFi economizado, 1=WiFi off, 2=duty-cycle)', 'int'),
      f('sleep.extendsleep', 'Modo 2 — min dormindo por ciclo de checagem', 'int'),
      f('sleep.extendsniff', 'Modo 2 — min acordado escaneando por ciclo', 'int'),
    ],
  },
  {
    label: 'Hardware / pinos (requer reinício)',
    fields: [
      f('disptype', 'Tipo de display (0=OLED/SSD1306, 1=ILI9225, 2=OLED/SH1106, 3=ILI9341, 4=ILI9342, 5=ST7789, 6=ST7796)', 'int', true),
      f('oled_sda', 'OLED SDA / TFT SDA', 'int', true),
      f('oled_scl', 'OLED SCL / TFT CLK', 'int', true),
      f('oled_rst', 'OLED RST / TFT RST', 'int', true),
      f('tft_rs', 'TFT RS', 'int', true),
      f('tft_cs', 'TFT CS', 'int', true),
      f('tft_spifreq', 'TFT — velocidade SPI', 'int', true),
      f('button_pin', 'Pino do botão 1', 'int', true),
      f('button2_pin', 'Pino do botão 2', 'int', true),
      f('button2_axp', 'Usar botão de força do AXP192 como botão 2', 'int', true),
      f('touch_thresh', 'Limiar do botão touch (0=modo calibração)', 'int'),
      f('power_pout', 'Pino de controle de energia', 'int', true),
      f('led_pout', 'Pino de saída do LED', 'int', true),
      f('gps_rxd', 'GPS — pino RXD (-1 desabilita)', 'int', true),
      f('gps_txd', 'GPS — pino TXD (opcional, só reset)', 'int', true),
      f('batt_adc', 'Pino de medição de bateria', 'int', true),
      f('sx1278_ss', 'SX1278 — SS', 'int', true),
      f('sx1278_miso', 'SX1278 — MISO', 'int', true),
      f('sx1278_mosi', 'SX1278 — MOSI', 'int', true),
      f('sx1278_sck', 'SX1278 — SCK', 'int', true),
    ],
  },
]

// Índice plano chave -> metadado, pra lookup O(1) no editor sem varrer seções.
export const RDZ_FIELD_META: Record<string, RdzConfigFieldMeta> = Object.fromEntries(
  RDZ_CONFIG_SECTIONS.flatMap(s => s.fields.map(field => [field.key, field]))
)
