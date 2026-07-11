#!/usr/bin/env node
/**
 * Simula um rdzTTGOsonde (firmware dev2 + deep sleep v2) publicando no broker
 * público — para testar a camada MQTT do painel sem esperar um voo real.
 *
 * Publica (QoS 1, retained, como o firmware faz):
 *  - `{prefix}uptime` no start e a cada 60s — shape dev2 (uptime em SEGUNDOS
 *    + campo `time` UTC);
 *  - `{prefix}pmu` a cada 60s — `{"V_Batt": ...}` (bateria do TTGO);
 *  - `{prefix}packet` a cada 1s, simulando uma RS41 subindo perto de casa;
 *  - `{prefix}sleep` — passe `--sleep N` para simular o receptor dormindo
 *    por N minutos (publica o retained de sleep e sai, como o firmware faz
 *    antes do esp_deep_sleep_start()).
 *
 * Uso:
 *   node scripts/mqtt-fake-publish.mjs rdz/seucallsign/ [lat] [lon] [--sleep N]
 */
import mqtt from 'mqtt'

const args = process.argv.slice(2)
const sleepIdx = args.indexOf('--sleep')
const sleepMin = sleepIdx >= 0 ? Number(args[sleepIdx + 1] ?? 60) : null
if (sleepIdx >= 0) args.splice(sleepIdx, 2)

const prefix = args[0]
if (!prefix) {
  console.error('uso: node scripts/mqtt-fake-publish.mjs <prefixo-do-topico> [lat] [lon] [--sleep N]')
  process.exit(1)
}
const homeLat = Number(args[1] ?? -5.83)
const homeLon = Number(args[2] ?? -35.2)

const BROKER = 'mqtt://broker.emqx.io:1883' // mesmo endpoint TCP que o TTGO usaria
const startMs = Date.now()
let alt = 300
let lat = homeLat + 0.02
let lon = homeLon + 0.02

const client = mqtt.connect(BROKER, { clientId: `rdz-fake-${Math.random().toString(16).slice(2, 8)}` })
const pub = (suffix, obj) => {
  const payload = JSON.stringify(obj)
  client.publish(`${prefix}${suffix}`, payload, { qos: 1, retain: true })
  console.log(`[${suffix}]`, payload)
}

function utcStr() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ')
}

function publishStation() {
  // shape dev2: uptime em segundos + campo time (discriminador usado pelo app)
  pub('uptime', {
    uptime: (Date.now() - startMs) / 1000,
    user: 'FAKE',
    time: utcStr(),
    rxlat: homeLat,
    rxlon: homeLon,
    SW: 'rdzTTGOsonde',
    VER: 'dev2-fake',
  })
  pub('pmu', { V_Batt: 3.92 })
}

function publishPacket() {
  alt += 5 // ~5 m/s de subida
  lat += 0.0002
  lon += 0.0003
  pub('packet', {
    lat: Number(lat.toFixed(5)),
    lon: Number(lon.toFixed(5)),
    alt: Number(alt.toFixed(1)),
    vs: 5.0,
    climb: 5.0,
    hs: 12.3,
    dir: 55.0,
    type: 'RS41-SGP',
    id: 'T1234567',
    ser: 'T1234567',
    frame: Math.floor((Date.now() - startMs) / 1000),
    time: Math.floor(Date.now() / 1000),
    sats: 9,
    freq: 403.0,
    rssi: 140 + Math.floor(Math.random() * 20), // cru: dBm = -rssi/2
    afc: 12,
    batt: 2.6, // bateria da SONDA
    launchsite: 'FAKE',
  })
}

client.on('connect', () => {
  if (sleepMin != null) {
    // Simula o firmware indo dormir: retained de sleep + status e sai.
    pub('sleep', {
      sleep_until: Math.floor(Date.now() / 1000) + sleepMin * 60,
      reason: 'out_of_window',
      V_Batt: 3.78,
      boot: 42,
    })
    client.publish(`${prefix}status`, 'sleeping', { qos: 1, retain: true }, () => {
      console.log(`receptor "dormindo" por ${sleepMin} min publicado — Ctrl+C`)
      client.end()
    })
    return
  }
  console.log(`conectado a ${BROKER}, publicando em ${prefix}{packet,uptime,pmu} — Ctrl+C para parar`)
  // acordou: limpa o estado de sleep no broker (como o firmware faz)
  pub('sleep', { sleep_until: 0, reason: 'awake', V_Batt: 3.92, boot: 43 })
  publishStation()
  publishPacket()
  setInterval(publishStation, 60_000)
  setInterval(publishPacket, 1_000)
})
client.on('error', err => console.error('erro mqtt:', err.message))
