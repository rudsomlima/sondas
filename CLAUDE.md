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

### Sincronização em segundo plano com radiosondy.info (`app/api/radiosondy-sync/route.ts`)

Um Cron job da Vercel (ver `vercel.json`, atualmente `0 6 * * *`, sem autenticação) que pré-calcula, por lançamento, se existe correspondência no radiosondy.info — gravado de volta em cada `Launch.radiosondyMatch` (`'yes' | 'no' | undefined`) no year store persistido em Blob. Objetivos: evitar que o cliente faça isso reativamente a cada clique (que antes significava uma busca de vários segundos antes do mapa poder renderizar), e deixar a grade do calendário mostrar selos de "sem correspondência" antes mesmo do usuário abrir o mapa.

- Só processa estações com `radiosondyStartplace` conhecido e o ano atual.
- Nunca reconfere um lançamento que já tem `radiosondyMatch` definido (idempotente/retomável entre execuções do cron, caso uma delas estoure o tempo — `maxDuration = 60`).
- Busca `fetchRadiosondyFeatures` uma vez por (estação, mês) com lançamentos pendentes, não uma vez por lançamento.
- Busca o feed ao vivo (~1MB) no máximo uma vez por *execução inteira* (preguiçoso, só se algum lançamento pendente ainda estiver dentro da janela de match), compartilhado entre todas as estações/meses daquela execução.
- Lançamentos ainda dentro da janela de match sem resultado ainda ficam sem valor definido (reconferidos na próxima execução) em vez de marcados `'no'`, já que podem simplesmente ainda não ter sido processados.
- `LaunchMap.tsx` lê `launch.radiosondyMatch === 'no'` pra pular a busca no radiosondy.info por completo e ir direto pra um link de fallback pra página de sondagem da Wyoming daquele dia/hora exatos (`region=samer&TYPE=TEXT:LIST&FROM={DD}{HH}&TO={DD}{HH}&STNM={station}`) — prova de que um lançamento aconteceu mesmo sem posição rastreada.

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
  sleep de verdade (`reason` sem prefixo `listen`) de escuta estendida
  (`reason` começa com `listen_*` — acordado, aguardando lançamento
  atrasado, ver `DEEP_SLEEP_V2_GUIDE.md` no repo do firmware); tolerância de
  10 min sobre `sleepUntil` pro drift do RTC do TTGO.
- Hooks: `useReceiver.ts` (agregador principal, usado por `/meu-receptor` e
  `/painel`), `useReceiverStatus.ts`, `usePowerStateHistory.ts`,
  `useBatteryHistory.ts` — consumidos por `PowerTimeline.tsx`/
  `BatteryChart.tsx` (meu-receptor) e `ReceiverPanel.tsx` (painel).

#### Config remota completa (`FullConfigEditor.tsx`, `SleepConfigEditor.tsx`)

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
- `SleepConfigEditor.tsx` é uma UI dedicada só pros campos `sleep.*` (janelas
  de deep sleep) dentro do editor completo — ver
  `docs/DEEP_SLEEP_V2_GUIDE.md` no repo do firmware pro que cada campo faz.

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

#### Auto-OTA (`FirmwareOtaPanel.tsx`)

O app funciona como servidor de atualização do próprio receptor
(`RX_FSK/src/conn-ota.cpp` no firmware, `checkAutoOta`) — publique um
`firmware.bin` aqui, o receptor baixa sozinho no próximo wake elegível (sem
sonda em voo, bateria ok).

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

### Páginas

- `app/page.tsx` — redireciona pra `/painel`.
- `app/painel/page.tsx` — painel de controle de missão (grade 3-6-3): TopStatusBar (relógios UTC/GMT-3, contagem regressiva do ciclo sinótico, selo de status), LivePanel (sondas de hoje + lançamentos recentes), MissionMap (pousos do mês + sondas ao vivo + trajetória do voo selecionado + posição de perseguição), TelemetryPanel, ConfidencePanel (selos de fonte W/R/S), ChasePanel (geolocalização, distância/rumo, links de navegação Maps/Waze).
- `app/analytics/page.tsx` — cartões de métricas de voo, mapa de calor de pousos (círculos nativos do Leaflet), rosa de deriva (8 octantes), comparação entre estações (até 3).
- `app/configuracoes/page.tsx` — seletor de estação, preferência de auto-refresh, e "Dados & Armazenamento" (LocalCachePanel + R2Panel, movidos pra cá do antigo painel de cache do histórico; o botão HardDrive do histórico linka pra `/configuracoes#dados`).
- `app/historico/page.tsx` — visão histórica principal, e também o lar do status ao vivo:
  - O card "Ao vivo" renderiza incondicionalmente como a primeira coisa da página (não depende dos dados do ano terem carregado), fazendo polling de `fetchTodayFlights()` a cada 20s — mas só pra estação atualmente selecionada, e só se ela tiver `radiosondyStartplace` conhecido (`hasRadiosondyCoverage`). Mostra status por sonda (vermelho = `isLive`, ou seja ainda em voo; verde = pousada), altitude, número da sonda, e horário do último report convertido pra GMT-3 em 24h (`formatGmt3`), mais um timestamp de "última checagem".
  - Abaixo disso: gráfico de barras anual (Recharts) de lançamentos por mês, alimentado tanto pelo servidor (`/api/sounding?action=year&station=...`) quanto pelo cache do cliente (`app/lib/cache.ts`).
  - Clicar num horário de lançamento na grade mês-por-dia seleciona ele (`selectedLaunch`) e abre `LaunchMap`; horários já sabidamente sem correspondência no radiosondy.info (`radiosondyMatch === 'no'` ou descoberto antes via o callback `onResult` de `LaunchMap` em `noMatchLaunches`) renderizam esmaecidos em vez de âmbar/índigo, com um `title` explicativo.
- `app/historico/LaunchMap.tsx` — mapa Leaflet renderizando posições de recuperação do radiosondy.info pra um lançamento passado; recebe a `station` atual como prop pra resolver seu `radiosondyStartplace`.
- `app/configuracoes/page.tsx` — busca/seleção de estação (sem diferenciar acentos, via `searchStations`) e configurações de exibição (intervalo de auto-refresh). Não tem mais um ajuste de período parcial de extração — a extração sempre cobre o dia inteiro.
- `app/api/cache/route.ts` — endpoint fino de status/info; a mutação do cache de fato acontece do lado do cliente via `localStorage` (essa rota só confirma a intenção pros fluxos de UI).
- `app/meu-receptor/page.tsx` — dono do próprio rdzTTGOsonde: seletor de receptor (múltiplos cadastrados), config remota completa, editor de telas OLED, publicação de firmware, histórico de bateria/energia. Ver seção dedicada "Meu Receptor" acima — arquitetura própria, não compartilha nada com o resto do app além de `settings.ts`/`receiverKey.ts`.

### Invariantes importantes a preservar ao mexer neste código

- A região é sempre `region=samer` pra toda estação da América do Sul (confirmado empiricamente, tanto em estações fonte `FM35`/legado quanto `BUFR`) — não reintroduza uma configuração de região por estação.
- O parâmetro `TO=` (dia) da Wyoming precisa ser um dia-do-mês real (ex.: nunca `31` num mês de 30 dias) ou dá 400 — ver o cálculo de `lastDay` em `fetchSounding`. A Wyoming também é instável de uma segunda forma: a *mesma* requisição pode, de forma não-determinística, omitir a observação mais recente perto de um limite de mês (observado diretamente: requisições idênticas com `TO=3023` retornaram 8 vs. 9 registros em chamadas repetidas) — isso é instabilidade do lado do servidor, não um bug no nosso parsing, e se autocorrige em produção porque o merge de `syncMonth` é aditivo e persistido em Blob (nunca sobrescreve com menos dados); *não* se autocorrige localmente sem credenciais de Blob, já que cada requisição reinicia de um store vazio.
- Não busque meses inteiros a cada requisição — sempre passe pelo padrão incremental "busca a partir do último dia armazenado" do `syncMonth`.
- O cache em memória do servidor, o cache localStorage do cliente e o Blob store são três camadas independentes; uma correção numa não se propaga pras outras.
- O feed ao vivo do radiosondy.info (`export_map.php?live_map=1`) retorna timestamps `report` com um `z` minúsculo no final (ex.: `"2026-06-23 12:57:32z"`) — acrescentar outro `Z` pro `Date` parsear produz uma data inválida silenciosamente. Sempre remova o `z`/`Z` existente antes de reacrescentar um (ver o padrão correto em `gmt3DateStr`/`formatGmt3`).
- `Launch` mora em `app/lib/types.ts` (import compartilhado) — ao adicionar um campo, deixe-o opcional pra que os YearStores já persistidos no R2 continuem válidos.
- Não amplie `MAX_MATCH_WINDOW_MS` (`app/lib/radiosondy.ts`, atualmente 4h) sem reverificar contra dados reais do radiosondy.info — uma janela larga demais produz silenciosamente matches *errados mas plausíveis* (roubando a recuperação do próximo lançamento) em vez de um honesto "sem match".
- O auto-OTA do firmware (`/api/firmware/[receiver]/upload`) atualiza quando a versão é **DIFERENTE**, não "mais nova" — nunca deixe um `.bin` desatualizado publicado depois de uma correção no firmware, ou o receptor se reverte pra ele a cada boot. Ver `docs/AUTO_OTA_GUIDE.md` no repo do firmware.
- MQTT sumiu completamente deste projeto — `app/lib/mqtt.ts` e as chaves de config `mqtt.*` do firmware (`mqtt.prefix`, `mqtt.siteurl`, `mqtt.cfgsecret`) são só nomes históricos, tudo é HTTP direto. Não reintroduza uma dependência de broker nem assuma semântica de mensagem retida (retained).
- `receiverKey(prefix)` é a única forma correta de derivar um caminho no R2 ou uma chave de localStorage a partir do `mqtt.prefix` de um receptor — nunca reimplemente essa normalização na mão, e nunca compare strings de `prefix` cruas entre receptores (diferenças de espaço/maiúsculas que `receiverKey` colapsaria).
