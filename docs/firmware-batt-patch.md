# Bateria e energia do TTGO — reporte HTTP direto (não MQTT)

> **Este documento substitui a versão anterior**, que descrevia publicação via
> MQTT (`{prefix}pmu`, `mqtt.active` bitfield). **MQTT foi removido do
> projeto por completo** (branch `mqtt-cfg-only` e seguintes) — o firmware
> nunca mais publica em tópicos de broker. Todo o reporte de bateria/energia/
> deep sleep é `POST` HTTP direto pro app (`RX_FSK/src/conn-report.cpp`),
> consumido em `POST /api/receiver-report` e lido pelo app via
> `GET /api/receiver-live-status`. Ver a seção "Meu Receptor" em
> `sondas/CLAUDE.md` para a arquitetura completa desse canal.

## O que o firmware reporta

`reportPmu()`, `reportSleep()` e `reportPower()`
(`RX_FSK/src/conn-report.cpp`) fazem `POST {mqtt.siteurl}/api/receiver-report`
a cada ciclo de wake, com corpos como:

```json
{"prefix": "pu7iol", "pmu": {"V_Batt": 3.987}}
{"prefix": "pu7iol", "sleep": {"sleep_until": 1783166700, "reason": "out_of_window", "V_Batt": 3.812, "boot": 42}}
{"prefix": "pu7iol", "power": {"eco": false, "cpu_mhz": 80, "wifi": "off", "level": 2, "period": "idle", "report_s": 900}}
```

> Desde `dev20260914.4` o deep sleep virou **níveis de energia** (`power.*`):
> a espera por lançamento atrasado reporta `reason: "listen_wait"`, e os
> motivos `listen_extend`/`listen_wifioff`/`listen_check` abaixo só aparecem
> em firmwares antigos. Ver `docs/POWER_MODES_GUIDE.md` no repo do firmware.

(o nome do campo de config `mqtt.siteurl` é histórico — é só a URL base do
app, nada depende de broker; ver nota equivalente em `AUTO_OTA_GUIDE.md` no
repo do firmware.)

Em placas com PMU AXP (T-Beam), `pmu` também traz `I_Batt`/`I_Vbus`/`V_Vbus`/
`T_sys`. `sleep.reason` pode ser `out_of_window` | `window_end` |
`signal_lost` | `vpanic` (sleep de verdade) ou `listen_extend` |
`listen_wifioff` | `listen_check` (escuta estendida — acordado, aguardando
lançamento atrasado); `sleep_until: 0` = acordado. Ver
`docs/DEEP_SLEEP_V2_GUIDE.md` no repo do firmware para o significado de cada
`reason` e de todos os campos `sleep.*`.

## O que é preciso configurar

1. `mqtt.siteurl` — URL do app publicado (ex.: `https://sondas.vercel.app`,
   ou o IP do relay HTTP→HTTPS se o firmware não tiver TLS — ver
   `http-relay/README.md`). Sem isso, nada é reportado (todas as funções em
   `conn-report.cpp` fazem no-op se `mqtt.siteurl` estiver vazio).
2. `mqtt.prefix` — identidade do receptor; precisa bater exatamente com o
   `mqttTopicPrefix` configurado no app (aba "Meu Receptor").
3. `batt_adc=35` no TTGO LoRa32 v2.1 (autodetectado na maioria dos casos; sem
   `batt_adc` válido, `V_Batt` não é reportado).
4. `mqtt.report_interval` — intervalo em ms entre reportes periódicos
   (bateria, config/telas pendentes). O app usa esse mesmo valor pra
   calibrar a cadência do próprio polling (ver `useFirmwareConfig.ts`).

O app lê tudo isso automaticamente assim que o receptor reporta pela primeira
vez — não precisa de nenhum passo manual além de configurar `mqtt.siteurl`/
`mqtt.prefix` no firmware.

## Testando sem hardware

O script antigo `scripts/mqtt-fake-publish.mjs` **não funciona mais** — ele
simula publicação via broker MQTT, canal que não existe mais no app. Para
testar a UI sem um TTGO real, use `curl` direto contra
`POST /api/receiver-report` com os corpos JSON acima (troque `prefix` por um
valor de teste).
