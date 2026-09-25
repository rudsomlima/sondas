# CLAUDE.md

Este arquivo fornece orientação ao Claude Code (claude.ai/code) ao trabalhar com código neste repositório.

## Comandos

```bash
npm install
npm run dev      # servidor de dev local, http://localhost:3000
npm run build    # build de produção (Next.js)
npm run start    # serve o build de produção
npm run lint     # next lint
```

Não há suíte de testes configurada. Nenhuma variável de ambiente é obrigatória pra dev local (a persistência em R2 degrada pra no-op sem credenciais — ver abaixo).

## Arquitetura

App Next.js 15 (App Router) + TypeScript que monitora lançamentos de radiossondas (balões meteorológicos) em estações da América do Sul, com padrão em Natal/INMET 82599. Extrai horários de lançamento do arquivo de sondagens da University of Wyoming e cruza com o radiosondy.info pra plotar posições de recuperação no mapa.

### Liga/desliga da Wyoming (`app/lib/appSettings.ts`, `/api/app-settings`)

Configuração GLOBAL (R2 `sondas/app-settings.json`, igual em todos os
aparelhos) com espelho no navegador (`sondas_app_settings_v1`) pra valer na
hora: `setWyomingEnabled` avisa os componentes da aba (evento interno) e as
outras abas (`storage`), e cada seção refaz suas consultas sem recarregar.
Interruptor em Configurações → "Fontes de dados" (`DataSourcesPanel`), que só
libera o clique depois de saber o valor real (`useWyomingSetting().ready`) —
antes ele mostra o padrão e um clique inverteria o valor errado.

Desligada, em TODO o app:
- **Nenhuma consulta**: toda chamada a `/api/sounding` leva `wyomingQuery()`
  (`wyoming=0|1`, lido na hora da chamada — nunca do estado do hook, que na
  1ª renderização ainda é o padrão). No servidor, `isWyomingEnabled(params)`
  (`appSettingsServer.ts`): o parâmetro vence; sem ele, vale o R2. Desligada,
  `month`/`year`/`today` usam só `monthWithoutWyoming` (radiosondy.info +
  SondeHub, cache em memória) **sem ler nem gravar o YearStore** (que é da
  Wyoming e fica intacto pra quando religar); `recheck` responde 409.
- **Nenhum dado dela na tela**: `withoutWyoming()` (`launchData.ts`) descarta
  lançamentos sem `source` e apaga `sources.wyoming`/`wyomingDataOk` dos
  demais — aplicado em useYearData, useTodayData, painel, analytics e
  comparação. Selo W some (`SourceBadges`), `computeConfidence(l, supported,
  wyomingEnabled)` marca `disabled`, contagens/links/botão "Reverificar" e o
  rodapé escondem a Wyoming.
- **Cache local separado**: `cacheStationKey(id)` (`82599~sem-wyoming`) — sem
  isso o cache com Wyoming apareceria, ou seria sobrescrito sem ela.
- Os lançamentos passam a vir das sondas (uma entrada por sonda,
  `launchesWithSondes`). Nova chamada a `/api/sounding` precisa de
  `wyomingQuery()` e `withoutWyoming()`; componente novo que mostre algo da
  Wyoming precisa de `useWyomingEnabled()`.

### Suporte a múltiplas estações

- **`app/lib/stations.ts`** — lista estática de ~40 estações da América do Sul (`SOUTH_AMERICA_STATIONS`), cada uma com `{ id (STNM), name, lat, lon, radiosondyStartplace? }`. `radiosondyStartplace` liga uma estação Wyoming ao nome do site de lançamento correspondente no radiosondy.info, quando conhecido — os dois sistemas usam nomes *diferentes e sem relação* pro mesmo local físico (ex.: "Natal Aeroporto" na Wyoming ↔ "Barreira do Inferno Launch Center (BR)" no radiosondy.info). Esses pares foram derivados por proximidade geográfica (lat/lon), não por semelhança de nome — cerca de metade das estações não tem correspondente conhecido no radiosondy.info e fica sem mapeamento (`getRadiosondyStartplace()` retorna `null`).
- **A API da Wyoming migrou em 2026** do endpoint legado `https://weather.uwyo.edu/cgi-bin/sounding` (404) para `https://weather.uwyo.edu/wsgi/sounding`. A nova API usa dois passos: (1) inventário anual `?datetime=YYYY-MM-DD 12:00:00&id=STNM&type=INVENTORY&src=FM35` → lista de datetimes disponíveis; (2) sondagem individual `?datetime=YYYY-MM-DD HH:MM:SS&id=STNM&src=FM35&type=TEXT:LIST`. Novo formato de header: `Observations for Station XXXXX at HH UTC DD Mon YYYY`. Parâmetro `src=FM35` (antigo `region=samer`).
- A estação selecionada é persistida em `localStorage` (`sondas_station`) via `getSelectedStation()`/`setSelectedStation()`, compartilhada entre `app/configuracoes` (UI de busca-e-seleção, só aplicada ao clicar "Salvar") e `app/historico` (`<select>` simples, aplicado imediatamente na troca — também reseta o mapa/match aberto, já que trocar de estação muda o que está sendo exibido ao vivo).
- Toda chamada de API que fala com a Wyoming recebe `station` como parâmetro/query string explícito — não há estação padrão fixa na camada de API (a *UI* usa `DEFAULT_STATION` = 82599 se nada tiver sido persistido ainda).

### Fluxo de dados (histórico de lançamentos da Wyoming)

1. **`app/api/sounding/route.ts`** — a única lógica de backend de verdade pra horários de lançamento. `GET` aceita três query params `action`, todos recebendo um parâmetro `station` (padrão 82599):
   - `action=today` — busca/parseia o mês atual da Wyoming, retorna se houve lançamento hoje pra essa estação.
   - `action=month` — sincroniza um mês incrementalmente no Blob store da estação/ano.
   - `action=year` — sincroniza todos os meses até o mês atual.

   Internamente faz scraping de `https://weather.uwyo.edu/cgi-bin/sounding?region=samer&TYPE=TEXT:LIST...&STNM={station}` (HTML) e parseia com regex linhas `Observations at HHZ DD Mon YYYY` em registros `Launch` (data/hora convertidas pra GMT-3). As respostas da Wyoming são instáveis (400/403/500 intermitentes sem relação com a requisição em si), então as buscas tentam de novo até 3x com backoff e timeout de 15s.

2. **`app/lib/blobStore.ts`** — persiste um arquivo JSON por estação+ano no Cloudflare R2 (API compatível com S3 via `@aws-sdk/client-s3`). A estação padrão (82599) mantém o caminho legado `sondas/history-{year}.json`; qualquer outra estação usa `sondas/history-{station}-{year}.json`. Vira no-op completo se `R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` não estiverem definidos (ex.: dev local sem `.env.local`), então a API continua funcionando localmente, só sem persistência entre requisições. Exige `R2_BUCKET_NAME` (padrão `"sondas"`).

3. **Cache em memória** dentro de `route.ts` (Map `memoryCache`, por instância do servidor, chaveado por estação+ano+mês): mês atual cacheado por 1 hora, meses passados cacheados permanentemente pela vida da instância. Fica na frente do Blob store e da busca à Wyoming.

4. **`app/lib/cache.ts`** — cache do lado do cliente, totalmente separado do cache do servidor. Persiste o histórico anual em `localStorage` (`sondas_cache_v1`), chaveado por ano+mês+estação (`station` é opcional em `CacheEntry` por compatibilidade retroativa — ausente significa a estação padrão), versionado, com export/import em JSON e exclusão por mês/ano.

5. **Modelo de sincronização**: `syncMonth()` em `route.ts` só busca dias depois do último dia já armazenado pra aquele mês (parâmetro `FROM=`), fazendo merge com os dados existentes em vez de rebuscar meses inteiros. Um mês é marcado como `monthsComplete` quando finalizado; o mês atual nunca é marcado como completo já que ainda pode ganhar lançamentos. `sanitizeStore()` protege contra dados ruins de versões antigas do código (lançamentos classificados no ano errado, ou meses além de "hoje" por causa de um bug antigo de fuso horário).

6. **Tratamento de fuso horário**: todo cálculo de "agora" passa por `nowGMT3()` (`Date.now() + GMT3` de offset), evitando deliberadamente `Date.getTimezoneOffset()` pra que o comportamento seja idêntico independente do fuso local da máquina/servidor host. Os timestamps de lançamento da Wyoming são UTC; converter pra GMT-3 local pode empurrar um lançamento pra outro mês/dia, o que `parseLaunches()` trata explicitamente (recai pra data UTC quando o ajuste de -3h cruza um limite de mês).

### Integração com radiosondy.info (`app/lib/radiosondy.ts`)

Módulo puro (sem `'use client'`), então é importável tanto por componentes client quanto por rotas de API/cron jobs no servidor. Duas fontes de dados distintas, ambas com CORS aberto:

- **Busca de recuperação histórica** — `fetchRadiosondyFeatures(year, month, startplace)` chama `export_search.php` pra achar onde a sonda de um *lançamento passado específico* foi recuperada. `findRecoveredMatch(features, launchInstant)` escolhe o ponto GeoJSON com o timestamp mais próximo *depois* do instante de lançamento, caindo pro ponto mais próximo *antes* dele como fallback — mas **as duas direções são limitadas por `MAX_MATCH_WINDOW_MS` (4h, ver `radiosondy.ts`)**. Essa janela foi deliberadamente reduzida de um valor anterior de 18h: uma janela mais larga deixava o fallback "roubar" a recuperação — já correta — do *próximo* lançamento (dois lançamentos com 12h de diferença, ex.: 00Z/12Z, podem ter a recuperação publicada mais próxima só ~10h de distância quando o segundo voo ainda não pousou) — confirmado contra dados reais do radiosondy.info durante o desenvolvimento. A duração real de voo (subida+descida até o pouso) é ~2-2.5h; a janela foi ampliada de um valor inicial de 3h pra 4h depois de observar voos de 3h10-3h30 que ficavam fora dela (ver a nota de invariante perto do fim deste arquivo).
- **Rastreamento de voo ao vivo** — `fetchLiveFlights()` chama `export_map.php?live_map=1`, o mesmo feed global (~1MB) que alimenta a própria seção "Now Flying!" da home do radiosondy.info. Uma sonda só aparece aqui enquanto ainda está no ar. `fetchTodayFlights(todayStr, startplace)` une as sondas ao vivo de hoje com as já pousadas hoje (derivadas de `fetchRadiosondyFeatures` no mês atual, parseando `Altitude:`/`Climbing:` de dentro do `popupContent`, já que o feed de recuperação não expõe isso como campo estruturado), chaveadas por número de sonda, cada uma marcada `isLive: true/false`. Isso existe porque a Wyoming (fonte oficial de horário de lançamento) atrasa bastante em relação ao tempo real — `fetchTodayFlights` costuma ser a única forma de saber "subiu um balão hoje?" antes da Wyoming publicar.
- `matchesStartplace()` casa uma entrada do feed ao vivo com um startplace, com fallback por bounding-box de lat/lon *só* pro startplace de Natal (cobre voos que derivam sobre o Rio Grande do Norte mas reportam uma string de startplace levemente diferente).
- `sondeHubUrl(sondeNumber, lat, lon)` monta um link externo pro sondehub.org centrado na posição real conhecida mais recente da sonda — sempre precisa receber coordenadas reais, nunca um centro fixo/chutado (um bug anterior centralizava todo link em Natal, independente de qual estação estivesse sendo vista).
- `findRecoveredMatch` é proposital síncrona/sem rede (opera sobre `features` já buscadas) pra que quem chama possa evitar a busca pesada do feed ao vivo a menos que realmente necessário — `LaunchMap.tsx` só chama `fetchRadiosondyFeatures` por (startplace, mês), nunca por clique dentro de um mês já em cache, e nunca toca em `fetchLiveFlights` (esse caminho de fallback foi deliberadamente removido do mapa interativo — ver histórico do git se o match "ainda em voo" precisar voltar).
- Constrói divIcons customizados do Leaflet (`buildBalloonIcon`/`buildHighlightBalloonIcon`) coloridos por status de recuperação, cada um com um rótulo de dia-do-mês + dia/noite (sol/lua) embutido no HTML do ícone via `gmt3IconLabel()`/`IconLabel`.

### Antigo cron radiosondy-sync (removido em 2026-09)

Existia um Vercel Cron (`/api/radiosondy-sync`) que gravava em cada lançamento
da Wyoming `radiosondyMatch`, `sources` e `flightStats`, com um painel
"Sincronização multi-fonte (bastidores)" em Configurações. Foi removido
porque: consultava o radiosondy.info sem User-Agent de navegador (403), o que
gravava não chegava aos dados servidos (0 de 243 lançamentos de 2026 tinham os
campos, mesmo com o status dizendo "264 checados, 263 não"), e tudo que ele
fazia o registro de sondas faz melhor. Hoje:
- **fontes que confirmam** (selos R/S, "Multi-fonte") → `sourcesFromRecord`
  (`sondeLaunches.ts`) a partir do registro: tem dado = confirmada; fonte já
  consultada sem nada = ausente; não consultada = aguardando;
- **estouro, duração, deriva** (Análises) → `SondeRecord.flight`, calculado no
  enriquecimento a partir da trilha inteira (CSV do radiosondy ou telemetria do
  SondeHub), exposto como `Launch.flightStats` por `flightStatsFromRecord`
  (trilha truncada → só o estouro);
- **status** → painel "Registro de sondas (bastidores)"
  (`RegistryStatusPanel`, `/api/sonde-registry/status`), com botão
  "Completar agora" (`POST /api/sonde-registry/backfill`).
`Launch.radiosondyMatch` segue lido se existir em YearStores antigos.

### Refatoração "mission control" (branch mission-control)

- **`app/lib/types.ts`** agora é a fonte única de verdade pra `Launch`/`LaunchPosition`/`YearStore`/`YearData`/`TodayData` mais `GMT3`/`nowGMT3()` — a duplicação antiga em 4 arquivos acabou; todo consumidor importa daqui. Novos campos opcionais em `Launch`: `sources?` (quais fontes confirmaram o lançamento, gravado pelo cron) e `flightStats?` (altitude/duração/deriva do estouro, calculado a partir de frames S3 do SondeHub pelo cron). Ambos opcionais — YearStores antigos no R2 continuam válidos.
- **Tokens de design**: variáveis CSS em `globals.css` (`--bg #0b0e13`, `--surface`, `--border`, `--status-*`, `--src-*`) mapeadas pra classes Tailwind via `tailwind.config.js` (`bg-surface`, `border-border`, `text-src-wyoming`…); os mesmos hex espelhados em `app/lib/tokens.ts` pro código do Leaflet/Recharts. Não fixe cores hex direto nos componentes.
- **Libs novas**: `geo.ts` (haversineKm/bearingDeg), `trajectory.ts` (trajetória de voo completa via `api.v2.sondehub.org/sonde/{serial}` + arquivo S3, `analyzeTrajectory`), `confidence.ts` (`computeConfidence` → estados de fonte W/R/S), `chase.ts` (useGeolocation + URLs de navegação Maps/Waze), `metrics.ts` (métricas do ano, densidade de pousos), `settings.ts` (`sondas_settings` tipado; `autoRefreshMinutes` é de fato lido por `useTodayData`), `leafletBase.ts` (`createBaseMap` sem duplicação), `launchUtils.ts` (isDaytime/sameLaunch/formatGmt3/wyomingSoundingUrl).
- **Hooks** em `app/historico/hooks/`: `useYearData`, `useTodayData`, `useLiveFlights` (pausa o polling em `visibilitychange`) — compartilhados entre /historico e /painel.

### Meu Receptor (`/meu-receptor`): dono do próprio rdzTTGOsonde

Página separada do resto do app (que só *observa* SondeHub/Wyoming/radiosondy):
aqui o app fala **direto com o firmware do usuário** — config remota
completa, editor visual de telas OLED, histórico de energia/bateria, e
publicação de firmware para auto-OTA. Único ponto do app que lê/grava algo no
hardware do usuário; tudo mais é leitura de fontes públicas.

- **Transporte é só HTTP direto — MQTT foi removido do projeto por
  completo.** `app/lib/mqtt.ts` mantém esse nome por razões históricas (os
  mesmos JSONs eram publicados em tópicos MQTT antes da migração); hoje é só
  parsing de payloads que chegam via `POST /api/receiver-report` (firmware:
  `RX_FSK/src/conn-report.cpp`). Da mesma forma, os campos de config
  `mqtt.prefix`/`mqtt.siteurl`/`mqtt.cfgsecret` no firmware não têm mais
  nada a ver com um broker — são só a identidade do receptor e a URL do app
  (nomes mantidos porque renomear quebraria firmwares já em campo).
- **Identidade do receptor**: `mqttTopicPrefix` em `AppSettings`
  (`app/lib/settings.ts`) precisa bater exatamente com `mqtt.prefix` no
  firmware. `receiverKey(prefix)` (`app/lib/receiverKey.ts`) normaliza isso
  pra uma chave segura de path/localStorage (`"home/rdz01/"` →
  `"home_rdz01"`); é a chave usada em todo caminho R2
  (`sondas/receivers/{key}/...`, `sondas/firmware/{key}/...`). Vários
  receptores podem ser cadastrados (`knownReceivers`), cada um com seu
  próprio histórico separado; trocar o ativo recarrega a página.
- **Painel "Meu receptor"** (`ReceiverSettingsPanel.tsx`): uma lista só de
  receptores (auto-descobertos; cadastro manual recolhido), grava na hora
  (`updateSettings`, sem botão Salvar). `uploaderCallsign` e
  `homeLat/homeLon` têm **uma fonte só quando há firmware reportando**:
  `sondehub.callsign` e `rxlat/rxlon` do snapshot, espelhados nas
  preferências pela página e mostrados só pra leitura (link pra editar na
  Configuração completa); editáveis aqui só sem esses valores no firmware
  (ex.: auto_rx). Não reintroduza edição duplicada desses campos.

#### Telemetria ao vivo (bateria, deep sleep, energia)

- `POST /api/receiver-report` (`{prefix, pmu?, sleep?, power?, fw?}`) — o
  firmware chama isso a cada ciclo de wake, com os mesmos JSONs que
  historicamente ia pra MQTT. Grava em paralelo: `writeReceiverLiveStatus`
  (snapshot "agora", lido por `GET /api/receiver-live-status?receiver={key}`
  via polling) e `recordCollected` (`app/lib/receiverCollect.ts`, histórico
  incremental em R2 — `power-history.json`/`batt-history.json`, com dedup:
  só grava se o *estado* mudou, não a cada report).
- `app/lib/powerState.ts` — lógica pura (sem `'use client'`) compartilhada
  entre os hooks do navegador e `receiverCollect.ts`, pra não duplicar a
  regra de "o que conta como uma leitura nova". `deriveSleepState` distingue
  sleep de verdade (`reason` sem prefixo `listen`) de espera por lançamento
  atrasado (`reason` começa com `listen_*` — acordado; hoje `listen_wait`,
  ver `POWER_MODES_GUIDE.md` no repo do firmware); tolerância de 10 min
  sobre `sleepUntil` pro drift do RTC do TTGO.
- **Níveis de energia** (`power.*` no firmware, substituíram `sleep.*` em
  `dev20260914.4`): período do dia (voo/janela/espera/resto) × nível (0
  Pleno, 1 Econômico, 2 Silencioso com WiFi desligado, 3 Pulsado — escuta em
  pulsos com light sleep entre eles, desde `dev20260914.5` —, 4 Sono
  profundo). Silencioso e Pulsado têm o mesmo cpu/wifi no reporte: só
  `level` os distingue, por isso ele entra na chave de dedup do histórico
  (`powerHistoryKey`).
  `app/lib/powerPlan.ts` é a lógica pura compartilhada (segmentos do dia,
  presets, estimativa de mAh/dia) — espelha `normLevel`/`currentPeriod` de
  `sleep.cpp`, mantenha os dois em sincronia. O reporte `power` traz
  `level`/`period`/`report_s`; `report_s` > 0 (Silencioso) estica a janela de
  frescor em `useReceiver.ts`, senão o card acusa offline entre as religadas
  do WiFi. Capacidade da bateria e mA por nível (calibração) moram só no app
  (`AppSettings.powerEstimate`), o firmware não sabe disso.
- **Turbo remoto** (`/api/receiver-power/boost`, `PowerBoostPanel.tsx`):
  força Pleno até um horário. O firmware faz GET junto da config pendente —
  a resposta tem chaves planas em string (`mReqId`/`mAuth`/`mUntil`,
  `aUntil`/`aSerial`) porque o extrator JSON dele não entende aninhamento
  nem número; o objeto `info` é só pro navegador e **não pode ter chaves com
  esses nomes** (o extrator faz `strstr` no corpo inteiro). Manual = pedido
  assinado no navegador com `computeCfgAuth(secret, reqId, String(until))`
  (firmware verifica); automático = calculado no próprio GET (sem cron) a
  partir do snapshot da config (`power.boost_auto/boost_km`, `rxlat/rxlon`)
  e do SondeHub, com cache em memória de 2 min por receptor.
- **Liga/desliga do registro** (botão "Gravando/Pausado" nos gráficos de
  bateria e energia): preferência por receptor em
  `sondas/receivers/{key}/history-settings.json`
  (`/api/receiver-history/settings`, `useHistorySettings.ts`). Pausado =
  `recordCollected` nem lê nem grava aquele histórico no R2 (economiza
  operações — o receptor pode reportar a cada 10 s) e os hooks do navegador
  param de acrescentar leituras locais; o live-status continua. A preferência
  tem cache de 1 min por instância do servidor.
- Gráfico de bateria (`BatteryChart.tsx`): a linha tracejada de tendência
  (liga leituras espaçadas do Silencioso/Pulsado) usa o mesmo dado da linha
  cheia, então fica fora do tooltip (`tooltipType="none"`) — senão a tensão
  aparecia duas vezes. Cartões e marcadores de mínima/máxima do dia exibido.
- O gráfico de bateria grava cada ponto com o **carimbo do reporte**
  (`live.lastLiveMessageAt`), não com `Date.now()`: sem isso o heartbeat de
  `MAX_SILENT_MS` regravava a mesma tensão a cada 5 min e o gráfico parecia
  atualizado de minuto em minuto com o receptor em silêncio (Silencioso/
  Pulsado só reportam a cada `power.report_min`).
- `writeReceiverLiveStatus`/`recordCollected` (mesma requisição em
  `/api/receiver-report`) usam o MESMO `Date.now()`, calculado uma vez na
  rota — sem isso, cada gravação tinha seu próprio carimbo (a poucos ms/s
  de distância) e a mesma leitura virava dois pontos no gráfico ao mesclar
  o cache local (carimbo do live-status) com o R2 (carimbo do
  `recordCollected`). No firmware, `reportPmu()` também passou a rodar só
  uma vez por religada do WiFi no Silencioso/Pulsado (não mais uma vez por
  `mqtt.report_interval` enquanto a rajada dura) — ver
  `docs/POWER_MODES_GUIDE.md` no repo do firmware.
- Hooks: `useReceiver.ts` (agregador principal, usado por `/meu-receptor` e
  `/painel`), `useReceiverStatus.ts`, `usePowerStateHistory.ts`,
  `useBatteryHistory.ts` — consumidos por `PowerTimeline.tsx`/
  `BatteryChart.tsx` (meu-receptor) e `ReceiverPanel.tsx` (painel).

#### Config remota completa (`FullConfigEditor.tsx`, `PowerConfigEditor.tsx`)

Mesmo padrão de fila em 3 partes, usado tanto para config quanto para telas
(seção seguinte) — vale entender uma vez só:

1. **snapshot** (`GET/POST /api/receiver-config/snapshot`) — o firmware
   empurra a config inteira uma vez por boot (`conn-cfg.cpp`/
   `reportConfigSnapshot`), campos sensíveis já redigidos como `"***"` antes
   de sair do dispositivo. O navegador só lê o último snapshot — nunca é
   "ao vivo", mas config raramente muda sozinha.
2. **request** (`GET/POST/DELETE /api/receiver-config/request`) — o
   navegador enfileira uma mudança (`{reqId, auth, apply, changes}`); o
   firmware faz `GET` (`checkPendingConfig`) no boot e periodicamente
   enquanto acordado, e aplica. Só um pedido pendente por vez (o mais
   recente vence).
3. **result** (`GET/POST /api/receiver-config/result`) — o firmware reporta
   o resultado depois de tentar aplicar; o navegador faz polling
   (`RESULT_POLL_MS=15s`, timeout `20min`) até `resolved:true`.
- `app/lib/cfgAuth.ts` — toda **gravação** exige prova de posse do
  `mqtt.cfgsecret` configurado no firmware: `auth = HMAC-SHA256(secret,
  reqId+"|"+changesJson)` truncado a 16 hex, calculado no navegador via
  `SubtleCrypto` (por isso exige contexto seguro — https ou localhost). O
  segredo em si nunca trafega. **Leitura não exige segredo.**
  `rdzConfigSecret` mora em `AppSettings` (`app/lib/settings.ts`).
- `app/lib/rdzConfig.ts` — schema/parsing de `RdzConfig` (mapa chave→valor,
  tudo string, espelhando `config_list[]` em `RX_FSK/RX_FSK.ino`); tipos por
  campo (int, string de tamanho N, lista, double) vivem em
  `rdzConfigSections.ts`, que também é onde uma chave de config nova do
  firmware precisa ser registrada pra aparecer no editor (ex.: `ota.auto`).
- `MultiFreqConfigEditor.tsx`: seção "Várias frequências" (campos `rx.alternate`,
  `rx.altframes`, `rx.altscan`, `rx.landlock`) — modo ficar na primeira /
  revezar por tempo / por quadros, prévia do revezamento e trava de pouso. Ver
  `docs/MULTI_QRG_GUIDE.md` no repo do firmware.
- `PowerConfigEditor.tsx` é uma UI dedicada só pros campos `power.*` (seção
  "Energia") dentro do editor completo: presets, prévia do dia por nível,
  estimativa de autonomia com calibração, lançamentos, bateria — ver
  `docs/POWER_MODES_GUIDE.md` no repo do firmware pro que cada campo faz.
  `ota.auto` fica na seção própria "Firmware / auto-OTA".

#### Editor visual de telas OLED (`OledScreenEditor.tsx`)

Mesmo padrão de fila em 3 partes acima, mas em `/api/receiver-screens/*` e
carregando o texto bruto de `screens1.txt` (não um mapa chave→valor) — ver
`useScreensConfig.ts`.

- `app/lib/oledScreenParser.ts` — parser de `screens*.txt`, portado de
  `Display::initFromFile`/`parseDispElement` (`RX_FSK/src/Display.cpp`).
  Entende posição (`linha,coluna[,largura]=conteúdo`), fonte grande/pequena
  (1º char maiúsculo/minúsculo), e o código do item + sub-código/sufixo.
  Simulação visual só — largura negativa (justificado à direita, só em TFT)
  e `scale=`/`color=` não são tratados.
- `app/lib/oledScreenSerializer.ts` — inverso: reconstrói só o bloco `@label`
  editado dentro do arquivo completo, preservando os demais blocos
  byte-a-byte.
- `app/lib/oledRenderer.ts` — desenha um preview de cada item com dados mock
  (`oledMockData.ts`), incluindo o caso especial do campo `k`/`K`
  (Killtimer): sub-código `s` = segundos até o próximo deep sleep
  (`sleepCountdownS` no firmware, ver `sleep.cpp`), `l`/`b`/`c` = timers de
  RS41 (lançamento/estouro/contagem) — nada a ver com sleep. Formato:
  `4`=h:mm, `6`=h:mm:ss, `m`=min:seg, outro=segundos crus.
- Grid 16×8 (OLED SSD1306 — `OLED_COLS`/`OLED_ROWS` em `oledRenderer.ts`),
  drag-and-drop com fallback por clique (adiciona na 1ª célula livre) e
  teclado (setas movem, Delete remove) — o drag-and-drop HTML5 nem sempre
  funciona em touch/todo navegador.

#### Diagnóstico de recepção por ângulo de elevação (`ReceptionQualityPanel.tsx`)

Seção "Qualidade de recepção": quanto de cada voo recente o receptor do usuário
ouviu **em cada faixa de ângulo de elevação**, com as outras estações que
ouviram a mesma sonda ao lado. Existe porque contagem de pacotes sozinha não
diagnostica nada — o ângulo separa problema de antena de problema de sinal.

- `app/lib/receptionAnalysis.ts` (puro) — `analyzeReception(frames, rxLat,
  rxLon, rxAltM, myCallsign)`. Faixas 0-15/15-30/30-45/45-60/60-90°, elevação
  com desconto da curvatura da Terra. `diagnose()` procura o **teto de
  elevação** (última faixa bem ouvida com tudo acima ruim) em vez de usar um
  corte fixo: voos que derivam rápido nunca chegam a ângulos altos e um corte
  fixo os classificava como "fraco em geral".
- `fetchSondeHubRawFrames(serial)` (`sondehub.ts`) — `GET /sonde/{serial}` sem
  descartar `uploader_callsign`/`rssi` (o que `fetchLiveTrajectory` faz). A
  rota redireciona pro histórico do voo inteiro, **guardado por meses** (voos
  de janeiro/2026 conferidos em setembro) — não é só a janela ao vivo.
- `useReceptionQuality` (`app/meu-receptor/hooks/`) — lista as sondas recentes
  num raio de 300 km **mais** todas as do registro de sondas (R2) em que o
  callsign do usuário aparece entre os receptores; guarda o relatório já
  calculado em `localStorage` (`sondas_reception_v1_*`), porque os quadros
  crus de um voo passam de 1 MB.
- ⚠️ **O SondeHub deduplica telemetria**: cada quadro fica atribuído a um único
  uploader (quem subiu primeiro), então contagem de quadros por estação é um
  limite inferior e não serve pra comparar recepção. Por isso a cobertura é
  medida **por minuto** (o minuto é seu se ao menos um dos ~60 quadros dele veio
  do seu callsign). Não troque isso por contagem de quadros.
- Caso real que originou o painel (PU7IOL, 2026-09): teto entre 15° e 60° em
  todos os voos da semana — ground plane vertical tem nulo no zênite, enquanto
  a estação vizinha (PU7KZI, Eggbeater-UHF) acompanhava até 32 km de altitude.
  Nos dias em que a sonda derivava longe e baixa o PU7IOL tinha RSSI melhor que
  o vizinho: não era sensibilidade, era geometria.

#### Auto-OTA (`FirmwareOtaPanel.tsx`)

O app funciona como servidor de atualização do próprio receptor
(`RX_FSK/src/conn-ota.cpp` no firmware, `checkAutoOta`) — publique um
`firmware.bin` aqui, o receptor baixa sozinho na primeira oportunidade de
contato (desde `dev20260915.5`: logo que o WiFi conecta e a cada 10 min,
**mesmo com sonda em voo**; só não com bateria abaixo de `power.vcrit`).

- `GET/POST/DELETE /api/firmware/[receiver]/upload` — `POST` publica
  (`writeFirmwareBinary`, R2: `sondas/firmware/{key}/{meta.json,firmware.bin}`);
  `GET` retorna `{meta, installed}` (publicado vs. o que o receptor reportou
  ter, via `fw.version` em `/api/receiver-report`); `DELETE` despublica
  (`deleteFirmware` — apaga `meta.json` **antes** do `firmware.bin`, porque é
  o meta que faz `/version` responder 200 e disparar o download; na ordem
  inversa uma falha no meio deixaria o receptor tentando baixar um binário
  já inexistente).
- `GET /api/firmware/[receiver]/version` — texto puro, o que o firmware
  compara contra `version_id` local. `GET /api/firmware/[receiver]/ino` — o
  binário em si.
- ⚠️ **Invariante crítica, já causou incidente real**: o firmware atualiza
  quando a versão publicada é **DIFERENTE** da instalada, não "mais nova".
  Publicar por engano um `.bin` antigo faz o receptor se **reverter** para
  ele a cada boot, desfazendo qualquer gravação por USB — e como
  `checkAutoOta()` roda dentro do `sleepLoop()` do firmware, isso também
  atrasa o receptor dormir. Ver `docs/AUTO_OTA_GUIDE.md` no repo do firmware
  pra a história completa e os três mecanismos de proteção (`ota.auto` no
  firmware, "Despublicar" aqui, disciplina de bump de versão).

### Avisos no Telegram (`/telegram`)

Tudo mora no R2 (nada em localStorage): `sondas/telegram-settings.json`
(token, chat, liga/desliga de cada aviso, `watchedStationIds`,
`stationRadiusKm`), `sondas/telegram-geofences.json` (áreas de interesse
desenhadas), `sondas/telegram-notify-state.json` (dedup de lançamento/pouso) e
`sondas/telegram-receiver-alert-state.json` (nível offline/bateria por
receptor). O token nunca volta pro navegador.

- **Lançamento/pouso sem app aberto**: o cron `/api/poll` (cron-job.org, ~1
  min) chama `notifyRecentEvents` em `liveFlightsCache.ts` pra cada estação em
  `watchedStationIds` (padrão: só a 82599). Vale qualquer sonda do feed
  (SondeHub/radiosondy.info) dentro do raio da estação (`stationRadiusKm`,
  padrão 300 km, 10–1000) — não depende de qual receptor a captou. Só eventos
  recentes (lançamento: último sinal < 20 min; pouso: < 3 h).
- **Regra única de envio**: `notifyFlightEvent` (`telegramEvents.ts`), usada
  também por `/api/telegram-notify` (detector do navegador,
  `useLaunchLandingWatcher`). O dedup `markNotifiedIfNew` (por sonda+evento,
  24 h) impede mensagem dupla entre cron e abas.
- **Alertas do receptor** (`receiverAlerts.ts`): só mandam quando o NÍVEL muda.
  O estado é gravado antes do envio; se o envio falha, ele é desfeito pra o
  próximo ping tentar de novo. Resultado do último ciclo em
  `lastPoll.receiverAlerts` de `/api/sonde-registry/status`.
- **Mapa de Áreas de interesse** (`GeofenceMap.tsx`): além das áreas (laranja),
  desenha todas as estações; clique liga/desliga o monitoramento (ignorado
  enquanto se desenha/edita) e as monitoradas ganham círculo ciano sem
  preenchimento com o raio de alcance. Áreas salvam na hora; estações/raios só
  nos botões Salvar (o das configurações e o "Salvar estações" da própria seção — ambos gravam o mesmo JSON).

#### Destino, modelos e mapas das mensagens

- `chatId` pode ser o ID de uma conversa privada ou de um grupo. Para grupo,
  adicione o bot e envie uma mensagem; `POST /api/telegram-detect-chat` lê os
  updates recentes do bot e devolve o chat encontrado. O token permanece no
  servidor e nunca é devolvido pelo `GET /api/telegram-settings`.
- Há seis modelos em `messageTemplates`: `launch`, `landing`,
  `receiverOffline`, `receiverOnline`, `lowBattery` e `batteryOk`. Os padrões
  ficam em `DEFAULT_MESSAGE_TEMPLATES` (`telegramMessage.ts`); configurações
  sem modelo salvo continuam usando esses padrões. A tela `/telegram` compõe
  modelos com badges arrastáveis, prévia com valores de exemplo, botão para
  restaurar todos os padrões e teste individual por modelo. O teste de
  lançamento/pouso usa o mapa; alertas do receptor são somente texto.
- `enabled` é a chave geral. As seis ativações individuais ficam nos cartões
  dos modelos e são independentes: `notifyLaunch`, `notifyLanding`,
  `notifyReceiverOffline`, `notifyReceiverOnline`, `notifyLowBattery` e
  `notifyBatteryOk`. Os limites de offline/bateria e o escopo dos pousos ficam
  nos ajustes do modelo correspondente. Offline/online e bateria baixa/normal
  compartilham a mesma detecção de estado, mas podem enviar cada mensagem de
  transição separadamente.
- Não há um painel separado "Meu receptor" em `/telegram`: controles de
  receptor offline/online e bateria ficam nos respectivos modelos. Em
  "Estações monitoradas", a linha logo abaixo da instrução para salvar lista
  cada estação marcada com ID e raio configurado; o botão "Salvar estações"
  persiste a seleção e os raios.
- Tokens e geração de texto ficam centralizados em `telegramMessage.ts`.
  Conteúdo dinâmico passa por escape HTML; o texto fixo do modelo aceita a
  formatação HTML compatível com Telegram. Não montar uma segunda versão da
  mensagem nas rotas de teste.
- `staticMap.ts` monta a imagem com tiles do OpenStreetMap. O rótulo do pouso
  usa `município-UF` (por exemplo `Natal-RN`), fica no canto inferior direito,
  em uma única linha e reduz a fonte para caber no mapa. Pousos identificados
  no mar usam zoom 3. A identificação geográfica é melhor esforço via
  Nominatim; não bloquear a mensagem se a busca falhar.
- Pedidos de tiles compartilham um limite de duas requisições simultâneas por
  processo e tentam novamente em falhas transitórias, alternando subdomínios.
  Se um tile que aparece no recorte ainda faltar, `renderStaticMapPng` retorna
  `null`; o evento envia texto sem foto em vez de uma imagem com quadros cinza.
  Preserve esse fallback e o User-Agent ao alterar o renderer.

### Páginas

- `app/page.tsx` — redireciona pra `/painel`.
- `app/painel/page.tsx` — painel de controle de missão (grade 3-6-3): TopStatusBar (relógios UTC/GMT-3, contagem regressiva do ciclo sinótico, selo de status), LivePanel (sondas de hoje + lançamentos recentes), MissionMap (pousos do mês + sondas ao vivo + trajetória do voo selecionado + posição de perseguição), TelemetryPanel, ConfidencePanel (selos de fonte W/R/S), ChasePanel (geolocalização, distância/rumo, links de navegação Maps/Waze).
- `app/analytics/page.tsx` — cartões de métricas de voo, mapa de calor de pousos (círculos nativos do Leaflet), rosa de deriva (8 octantes), comparação entre estações (até 3).
- `app/configuracoes/page.tsx` — seletor de estação, preferência de auto-refresh, e "Dados & Armazenamento" (LocalCachePanel + R2Panel, movidos pra cá do antigo painel de cache do histórico; o botão HardDrive do histórico linka pra `/configuracoes#dados`).
- `app/historico/page.tsx` — visão histórica principal, e também o lar do status ao vivo:
  - O card "Ao vivo" renderiza incondicionalmente como a primeira coisa da página (não depende dos dados do ano terem carregado), fazendo polling de `fetchTodayFlights()` a cada 20s — mas só pra estação atualmente selecionada, e só se ela tiver `radiosondyStartplace` conhecido (`hasRadiosondyCoverage`). Mostra status por sonda (vermelho = `isLive`, ou seja ainda em voo; verde = pousada; amarelo = sinal perdido — ver `flightStatus` abaixo), altitude, número da sonda, e horário do último report convertido pra GMT-3 em 24h (`formatGmt3`), mais um timestamp de "última checagem".
  - Abaixo disso: gráfico de barras anual (Recharts) de lançamentos por mês, alimentado tanto pelo servidor (`/api/sounding?action=year&station=...`) quanto pelo cache do cliente (`app/lib/cache.ts`).
  - Clicar num horário de lançamento na grade mês-por-dia seleciona ele (`selectedLaunch`) e abre `LaunchMap`; horários já sabidamente sem correspondência no radiosondy.info (`radiosondyMatch === 'no'` ou descoberto antes via o callback `onResult` de `LaunchMap` em `noMatchLaunches`) renderizam esmaecidos em vez de âmbar/índigo, com um `title` explicativo.
- `app/historico/LaunchMap.tsx` — mapa Leaflet renderizando posições de recuperação do radiosondy.info pra um lançamento passado; recebe a `station` atual como prop pra resolver seu `radiosondyStartplace`.
- `app/configuracoes/page.tsx` — busca/seleção de estação (sem diferenciar acentos, via `searchStations`) e configurações de exibição (intervalo de auto-refresh). Não tem mais um ajuste de período parcial de extração — a extração sempre cobre o dia inteiro.
- `app/api/cache/route.ts` — endpoint fino de status/info; a mutação do cache de fato acontece do lado do cliente via `localStorage` (essa rota só confirma a intenção pros fluxos de UI).
- `app/meu-receptor/page.tsx` — dono do próprio rdzTTGOsonde: seletor de receptor (múltiplos cadastrados), config remota completa, editor de telas OLED, publicação de firmware, histórico de bateria/energia. Ver seção dedicada "Meu Receptor" acima — arquitetura própria, não compartilha nada com o resto do app além de `settings.ts`/`receiverKey.ts`.

### Registro permanente de sondas no R2 (`app/lib/sondeRegistry*.ts`)

Tudo que qualquer fonte já disse sobre uma sonda fica guardado pra sempre em
`sondas/sondes/{ano}.json` (`{ year, updatedAt, records: {serial: SondeRecord} }`),
mesclado de forma **aditiva** (`mergeSondeRecords`: nunca apaga um dado por
falta dele na outra cópia; 1º quadro = o mais antigo, último quadro/posição/
receptor = o mais recente, status FOUND > LOST > UNKNOWN, receptores = união).
As fontes esquecem ou falham — o registro não; com o tempo ele fica mais
completo que qualquer fonte sozinha, e é **ele que completa todos os mapas**.

- **Fontes** (`sondeSources.ts`, só servidor):
  - `radiosondy.info/sonde_archive.php` — status, 1º/último quadro, lista
    `Receivers:`, local de lançamento, tipo, frequência, altitude máx., e a
    tabela "Status Changes" (quem achou, se FOUND). Exige User-Agent de
    navegador (403 sem) e responde **302 pra sonda desconhecida**.
  - `radiosondy.info/zip_download.php` (botão "Get Data", POST) — zip com um
    CSV de **uma linha por quadro, com a estação que o recebeu**: dá a
    contagem por receptor e **de quem foi o último sinal** mesmo pra voos
    antigos. ~1 MB (quase tudo PNG); descompactado sem dependência
    (`unzipEntry`, node:zlib).
  - SondeHub `/sonde/{serial}` — voo inteiro com o uploader de cada quadro
    (deduplicado: contagens são mínimas). Primeiro quadro só vale como
    "lançamento" se estava abaixo de 3 km (W3770721 começava a 11,8 km).
  - SondeHub `/recovered` — quem recuperou fisicamente (`fetchRecoveryDirect`).
- **Rotas**: `GET /api/sonde-registry?year=&station=|serials=` (leitura),
  `POST /api/sonde-registry` (o navegador manda o que viu nas fontes leves —
  validado por `sanitizeRecord`; fontes pesadas nunca vêm do navegador) e
  `POST /api/sonde-registry/enrich` (até 6 serials; o servidor consulta as
  fontes pesadas e grava). Núcleo compartilhado em `sondeRegistryServer.ts`.
- **Gravação concorrente**: `updateSondeRegistry` (blobStore) faz
  leitura-mescla-gravação com `If-Match` no ETag (`If-None-Match: *` quando o
  arquivo não existe) e tenta de novo em 412 — sem isso duas abas/requisições
  perdiam dados uma da outra.
- **Só o trecho principal do voo** (`mainFlightSegment`, `sondeSources.ts`):
  as fontes guardam quadros soltos de muito depois (V5041139 voou em 11/2025 e
  U0460617 em 2022, mas o SondeHub tem quadros delas em 2026 — sonda achada e
  religada). Tudo (1º/último quadro, receptores, último sinal, dados de voo) é
  calculado só no bloco contínuo com a maior altitude.
- **O registro fica no ano onde já mora** (`findRecordsWithYear`/`saveRecords`
  com `yearOf`): sem isso a W3770290 (lançada 31/12/2025 23:38 UTC) era gravada
  em 2025 pelo enriquecimento e a cópia de 2026 era reconsultada a cada ping.
- **`enrichVersion`** (`ENRICH_VERSION` em `sondeRegistry.ts`): quando o app
  passa a extrair algo novo das fontes, suba a versão — registros antigos são
  relidos UMA vez, sem esperar a regra de 24 h.
- **Quando reconsultar** (`needsEnrichment`): voo nas últimas 6 h, a cada 10
  min; voo encerrado e completo, nunca mais; fonte que já disse "não tenho"
  num voo de mais de 7 dias, nunca mais; relato de recuperação, a cada 6 h
  por 30 dias enquanto não for FOUND. O navegador ainda limita uma tentativa
  por serial a cada 10 min (`serialsNeedingEnrichment`).
- **Sem ninguém com o app aberto**: `/api/poll` (pingado a cada poucos
  minutos pelo cron-job.org) roda `backfillRegistry(4)` em paralelo com o
  cache de voos ao vivo — semeia o registro com as posições de lançamento do
  YearStore que ele ainda não tem e enriquece as 4 sondas mais recentes que
  ainda valem consulta.
- **Navegador** (`sondeRegistryClient.ts`): cache em memória + localStorage
  (`sondas_registry_v1`); `useSondeRegistry(station, years, serials)` carrega
  o ano do R2 e pede enriquecimento (ordem de `serials` = prioridade: sondas
  de hoje e mais recentes primeiro). `reportSondes` agrupa e não repete (no
  máx. 1 envio por serial por minuto; falha de envio libera o reenvio).
- **Nos mapas**: `mergeWithRegistry(points, records, include)` —
  o registro entra como fonte própria (`'registry'`, sondas que as fontes não
  devolvem mais continuam no mapa) e completa os pontos existentes
  (`applyRegistryToPoints`). Só vira ponto novo o registro com
  `stations` contendo a estação do mapa (a estação é carimbada por quem
  reporta/enriquece), nunca por adivinhação geográfica.
- **Popups de mapa** (`app/lib/mapPopups.ts` + estilos `.mp-*` no fim de
  `globals.css`): cartão escuro com ícones (paths do lucide em SVG inline) pra
  sonda (`sondePopupHtml`, via `sondePointPopup`), estação receptora
  (`stationPopupHtml`), local de lançamento (`launchSitePopupHtml`) e
  marcadores auxiliares (`simplePopupHtml`: estouro, "Você", mapa de calor).
  **Todo `bindPopup` passa `POPUP_OPTIONS`**: é a `className: 'mp-popup'` que
  dá especificidade pro tema vencer o CSS do Leaflet (carregado depois do
  nosso — sem ela o cartão sai branco com texto claro) e o `maxHeight` que
  faz o cartão rolar por dentro em mapas baixos. Não crie popup próprio num
  mapa; complete este módulo.
- **Mapa do lançamento** (`LaunchMap`): todo marcador usa `bindSonde` — o
  popup é calculado ao abrir (`bestPoint`: ponto da fonte + mesmo serial nos
  pontos do mês + registro), então nunca mostra menos que o painel (bug real:
  W0521239 em 17/09 aparecia só com "Status: UNKNOWN"). Clicar numa sonda
  troca o cabeçalho pros dados dela (lançamento, recepção, último sinal), com
  botão pra voltar ao lançamento aberto.

- **Tela cheia** (mapa do ano e mapa do lançamento): `useFullscreen(ref,
  onChange)` (`app/lib/useFullscreen.ts`) usa a Fullscreen API no bloco
  inteiro (cabeçalho + mapa) e, onde ela não existe pra elementos comuns
  (iPhone), cai num modo CSS `fixed inset-0` com Esc e rolagem da página
  travada. `onChange` chama `map.invalidateSize()` — sem isso o Leaflet
  continua desenhando no tamanho antigo.

### Estações receptoras (`app/lib/receiverStations*.ts`)

Posição, antena, software e último contato de cada estação que sobe
telemetria pro SondeHub, em `sondas/receiver-stations.json` (mesma gravação
condicional com ETag do registro). Fontes: `uploader_position` de cada quadro
do `/sonde/{serial}` (lido no enriquecimento — cobre estações que já não estão
ativas, ex.: SMOLDER/2022) e `/listeners/telemetry?duration=1d` (estações
ativas; ~400 KB do mundo todo, então o cron só consulta a cada 6 h e só guarda
quem aparece como receptor no registro). `stationsCaptured` no SondeRecord
faz registros antigos relerem o SondeHub uma vez pra capturar as posições.
- `GET /api/receiver-stations`; no navegador `useReceiverStations()`
  (cache + releitura quando o registro muda).
- `drawReceiverStations` (`receiverStationsLayer.ts`) desenha, em todos os
  mapas, as estações que receberam alguma sonda visível
  (`receptorsFromPoints`) + o meu receptor sempre. Mesmo ícone de antena:
  vermelho = meu, verde-água = demais; estações no mesmo lugar (~50 m) viram
  um marcador só com os popups empilhados.

### Painéis recolhíveis em "Meu receptor"

`CollapsibleSection id` (página) + `PanelTitle` (no lugar do `h2` de cada
painel) — clicar no título recolhe; a escolha fica em `localStorage`
(`sondas_meu_receptor_collapsed`). Recolhido, o CSS
(`.collapsible-section[data-collapsed="true"]`, com `:has()`) esconde tudo do
painel menos a linha que contém o título — o painel em si não sabe que é
recolhível. Painel novo: use `PanelTitle` e envolva na página.

### Uma entrada de lançamento por sonda (`app/lib/sondeLaunches.ts`)

O histórico nasceu modelado pela Wyoming: dois horários nominais por dia
(00Z/12Z), cada um com no máximo **uma** sonda casada. Em Natal isso escondia
voos reais — 15/09/2026 teve 5 sondas no SondeHub e o app listava 2.

- `launchesWithSondes(launches, points, records)` — lançamentos da Wyoming com
  o registro aplicado (`applyRegistryToLaunches`: 1º quadro, receptores,
  último sinal, status) **mais uma entrada por sonda** que não casou com
  nenhum deles (`pointToLaunch`). `launchSortMs` ordena pelo 1º quadro.
  Hook: `useSondeLaunches(launches, points, records)`.
- **Exibição**: `launchDisplayTime(l)` (`launchUtils.ts`) devolve `{ time,
  exact }` — `firstFrameUtc` em GMT-3 quando existe, senão o `time_local`
  nominal com `~`. `Launch.time_local`/`time_utc` **continuam sendo a
  identidade** do lançamento (cache, merge, `radiosondyMatch`): nunca
  sobrescreva com o primeiro quadro.
- As entradas extras são **só exibição**: não entram no YearStore nem no cache
  local do ano, que seguem sendo a verdade da Wyoming.

### Mapa do /painel = mapa do histórico anual

`useYearSondePoints(station, year, launches)` (`app/historico/hooks/`) é a
coleta de todas as fontes de um ano inteiro (radiosondy.info de todos os
meses, SondeHub recente, arquivo S3 onde falta posição), antes escondida
dentro do `YearMap`. O `YearMap` e o `/painel` usam o MESMO hook, a MESMA base
de lançamentos (`useYearData`, cache-primeiro) e o MESMO registro — por isso
os dois mostram o mesmo conjunto (257 sondas de 2026 em Natal, conferido no
navegador). O `MissionMap` tem um filtro Mês/Ano próprio (padrão: Ano,
lembrado em `sondas_painel_map_period`). Bug real que isso corrigiu: o painel
usava só os lançamentos do mês (`positionedMonth`), uma sonda por slot
sinótico, com o horário nominal — e parecia "mostrar só as minhas".

### Recuperações do SondeHub (`app/lib/sondehubRecovery.ts`)

Posições vindas só de telemetria RF do SondeHub nascem `status: 'UNKNOWN'`.
`https://api.v2.sondehub.org/recovered?serial=X` diz se alguém registrou a
recuperação física (caso real: X2932841/X3043555, recuperadas por PS7BL em
09/09/2026, apareciam UNKNOWN). Vira FOUND (achada, usando as coordenadas do
relato) ou LOST (foi buscar e não achou); `planned` não muda nada.
- **Só consulta por serial.** A busca por área (`lat/lon/distance` +
  `datetime/duration`) é inconsistente — a mesma recuperação some ou aparece
  conforme a data de referência (testado em 2026-09-15). Não troque por ela.
- Cache em memória + `localStorage` (`sondas_recovery_v1`): achada 30 dias,
  não achada 6 h, sem relato 3 h.
- Aplicado em segundo plano, nunca bloqueando o desenho: `useSondePoints`
  (pontos do mês), `useRecoveredLaunches` (lançamentos; no /historico só
  consulta a rede pro mês aberto), `YearMap` (no fim) e o registro de sondas
  (`/api/poll` → `backfillRegistry`, a cada 6 h por 30 dias enquanto não for
  FOUND).
- `mergePair` (`launchData.ts`): para a mesma sonda, FOUND/LOST sobrevive a
  UNKNOWN da outra cópia, independente do rank da fonte.

### Mapa do /painel: desenho progressivo

`fetchMonthSondePoints` aceita `onProgress` e separa as duas buscas recentes do
SondeHub (`fetchSondeHubRecentFramesSplit`): o endpoint `/sondes/site/{id}` já
levou 14 s pra devolver `{}` (cache frio), enquanto a busca por raio responde
em <1 s. `useSondePoints` desenha cada fonte assim que chega, abre com o último
resultado salvo em `localStorage` (`sondas_points_v1_*`) e nunca encolhe a
lista por um parcial menor.

### Invariantes importantes a preservar ao mexer neste código

- A região é sempre `region=samer` pra toda estação da América do Sul (confirmado empiricamente, tanto em estações fonte `FM35`/legado quanto `BUFR`) — não reintroduza uma configuração de região por estação.
- O parâmetro `TO=` (dia) da Wyoming precisa ser um dia-do-mês real (ex.: nunca `31` num mês de 30 dias) ou dá 400 — ver o cálculo de `lastDay` em `fetchSounding`. A Wyoming também é instável de uma segunda forma: a *mesma* requisição pode, de forma não-determinística, omitir a observação mais recente perto de um limite de mês (observado diretamente: requisições idênticas com `TO=3023` retornaram 8 vs. 9 registros em chamadas repetidas) — isso é instabilidade do lado do servidor, não um bug no nosso parsing, e se autocorrige em produção porque o merge de `syncMonth` é aditivo e persistido em Blob (nunca sobrescreve com menos dados); *não* se autocorrige localmente sem credenciais de Blob, já que cada requisição reinicia de um store vazio.
- Não busque meses inteiros a cada requisição — sempre passe pelo padrão incremental "busca a partir do último dia armazenado" do `syncMonth`.
- O cache em memória do servidor, o cache localStorage do cliente e o Blob store são três camadas independentes; uma correção numa não se propaga pras outras.
- O feed ao vivo do radiosondy.info (`export_map.php?live_map=1`) retorna timestamps `report` com um `z` minúsculo no final (ex.: `"2026-06-23 12:57:32z"`) — acrescentar outro `Z` pro `Date` parsear produz uma data inválida silenciosamente. Sempre remova o `z`/`Z` existente antes de reacrescentar um (ver o padrão correto em `gmt3DateStr`/`formatGmt3`).
- `TodayFlight.isLive === false` significa só "parou de transmitir", **não** "pousou" — a sonda some do SondeHub quando desce abaixo do horizonte dos receptores, às vezes ainda a km do chão (caso real: W3770310, último frame a 1.249 m caindo a 6 m/s). Nunca rotule `!isLive` direto como "Pousada": use `flightStatus()`/`FLIGHT_STATUS_LABEL` (`app/lib/radiosondy.ts`), que só diz pousada com evidência (recuperação no radiosondy.info, último frame < 500 m ou velocidade vertical ~0) e cai em "Sinal perdido" no resto. Não troque isso por um limiar só de altitude absoluta — estações altas (La Paz ~4.000 m) quebrariam.
- O horário mostrado de um lançamento vem de `launchDisplayTime()`, não de `l.time_local` direto — ver "Uma entrada de lançamento por sonda". `time_local`/`time_utc` são identidade interna; sobrescrevê-los com o horário real quebra caches, merges e `radiosondyMatch`.
- `Launch` mora em `app/lib/types.ts` (import compartilhado) — ao adicionar um campo, deixe-o opcional pra que os YearStores já persistidos no R2 continuem válidos.
- Não amplie `MAX_MATCH_WINDOW_MS` (`app/lib/radiosondy.ts`, atualmente 4h) sem reverificar contra dados reais do radiosondy.info — uma janela larga demais produz silenciosamente matches *errados mas plausíveis* (roubando a recuperação do próximo lançamento) em vez de um honesto "sem match".
- O auto-OTA do firmware (`/api/firmware/[receiver]/upload`) atualiza quando a versão é **DIFERENTE**, não "mais nova" — nunca deixe um `.bin` desatualizado publicado depois de uma correção no firmware, ou o receptor se reverte pra ele a cada boot. Ver `docs/AUTO_OTA_GUIDE.md` no repo do firmware.
- MQTT sumiu completamente deste projeto — `app/lib/mqtt.ts` e as chaves de config `mqtt.*` do firmware (`mqtt.prefix`, `mqtt.siteurl`, `mqtt.cfgsecret`) são só nomes históricos, tudo é HTTP direto. Não reintroduza uma dependência de broker nem assuma semântica de mensagem retida (retained).
- `receiverKey(prefix)` é a única forma correta de derivar um caminho no R2 ou uma chave de localStorage a partir do `mqtt.prefix` de um receptor — nunca reimplemente essa normalização na mão, e nunca compare strings de `prefix` cruas entre receptores (diferenças de espaço/maiúsculas que `receiverKey` colapsaria).
