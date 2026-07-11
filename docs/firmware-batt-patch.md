# Bateria do TTGO via MQTT — nativo no firmware dev2 (patch aposentado)

**Este documento substituiu o antigo patch de firmware.** O branch `dev2` do
rdzTTGOsonde (usado no fork local com deep sleep v2) **já publica a tensão da
bateria do TTGO nativamente**, no tópico **`{prefix}pmu`** (QoS 1, retained):

```json
{"V_Batt": 3.987}
```

(Em placas com PMU AXP — T-Beam — vêm também `I_Batt`, `I_Vbus`, `V_Vbus`, `T_sys`.)

## O que é preciso configurar

1. `mqtt.active` é um **bitfield**: 1=Sondes, 2=Uptime, 4=PMU, 8=GPS, 16=RF.
   Para o app Sondas funcionar completo use **`mqtt.active=7`** (sondes + uptime + pmu).
2. `batt_adc=35` no TTGO LoRa32 v2.1 (autodetectado na maioria dos casos; sem
   `batt_adc` válido o tópico `pmu` não é publicado).
3. O app Sondas lê `V_Batt` do tópico `pmu` automaticamente (e também aceita o
   campo `batt` no `uptime`, para compatibilidade com firmwares antigos patchados).

## Deep sleep v2 (fork local)

O fork em `PlatformIO/Projects/rdz_ttgo_sonde_06_03_2026/rdz_ttgo_sonde`
(branch `deep-sleep-custom`) adiciona ainda o tópico **`{prefix}sleep`**
(retained), publicado antes de cada deep sleep e limpo ao acordar:

```json
{"sleep_until": 1783166700, "reason": "out_of_window", "V_Batt": 3.812, "boot": 42}
```

`reason`: `out_of_window` | `window_end` | `signal_lost` | `vlow` | `vcrit`;
`sleep_until: 0` = acordado. O app mostra "dormindo até HH:MM" no card
"Meu receptor" a partir desse tópico. Configuração das janelas e economias:
web UI do TTGO, seção "Deep sleep / power management" (`sleep.*`).

Para testar a UI sem hardware: `node scripts/mqtt-fake-publish.mjs rdz/seucallsign/`
(e `--sleep 30` para simular o receptor dormindo).
