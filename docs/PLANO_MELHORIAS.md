# Plano de melhorias (iniciado em 2026-10-25)

Origem: o lançamento da W0530174 (23/10/2026, 14:49Z) não gerou aviso no
Telegram porque o `/api/poll` só rodava uma vez por dia (cron da VM
`30 6 * * *`) e `notifyRecentEvents` só considera lançamento com sinal < 20 min.

Marque cada item ao concluir. Depois de cada fase: `graphify update .` e
atualizar os docs citados.

## Fase 1: avisos do Telegram funcionando (urgente)

- [x] 1.1 Cron da VM a cada 2 min (`*/2 * * * *` em `poll-cron.sh`); decidir
      entre 1 e 2 min olhando `poll.log` e a duração do poll (~18 s).
- [x] 1.2 `poll-cron.sh`: log com data/hora, rotação do `poll.log` (hoje não
      tem carimbo), `curl --fail` e registro do código HTTP.
- [ ] 1.3 Confirmar `lastRunAt` de `/api/sonde-registry/status` avançando a
      cada 2 min e um lançamento real chegando ao grupo.
- [x] 1.4 Corrigir docs: `CLAUDE.md` (raiz e `sondas/`) e `docs/ORACLE.md`
      dizem "cron diário" / "cron-job.org"; `docs/TELEGRAM.md` idem.

## Fase 2: alerta de cron parado (só para o dono, nunca para o grupo)

- [x] 2.1 Novo campo `adminChatId` em `telegramTypes.ts` e
      `telegram-settings.json`: conversa PRIVADA do dono com o bot. Hoje
      `chatId` = grupo (-5255179541); o alerta de sistema não pode usar ele.
- [x] 2.2 Tela `/telegram`: campo "Conversa privada para alertas do sistema"
      com botão Detectar (reaproveitar `telegram-detect-chat`). Pré-requisito do
      usuário: abrir o bot e mandar `/start` no privado.
- [x] 2.3 Detector de poll parado: o cron grava `lastRunAt` (já existe em
      `lastPoll`). Como o próprio poll é o que parou, o vigia precisa ser outro
      processo: script `deploy/oracle/watchdog.sh` no cron da VM (a cada 5 min)
      que lê `/api/sonde-registry/status` e, se `lastRunAt` > 10 min, avisa via
      API do Telegram direto no `adminChatId`. Estado em arquivo local para
      avisar só na transição (parou → voltou), sem repetir.
- [x] 2.4 Aviso também quando voltar ao normal ("cron voltou após X min").
- [x] 2.5 Alertas de falha do R2/disco (muitos `InternalError` seguidos)
      entram no mesmo canal privado.
- [x] 2.6 (poll, armazenamento e disco validados com limite forçado; parada real de 14 min escapou entre dois ticks, por isso o limite caiu de 10 para 7 min) Teste: parar o cron de propósito, ver o aviso só no privado e nada
      no grupo; documentar em `docs/TELEGRAM.md` e `docs/ORACLE.md`.

## Fase 3: sair do R2 para disco local na VM

- [x] 3.1 `blobStore.ts` continua sendo a única porta; criar backend em disco
      (volume Docker `/data`, mesmos caminhos `sondas/...`) escolhido por
      variável de ambiente; sem credenciais R2 e sem `DATA_DIR` segue no-op.
- [x] 3.2 Manter a semântica de gravação condicional (ETag /
      `If-None-Match: *`) com trava de arquivo + escrita atômica (tmp+rename);
      cobrir `updateSondeRegistry`, `recordCollected` e a dedup do Telegram.
- [x] 3.3 Rotas e painéis que falam de R2: `R2Panel` e o painel de tráfego
      Cloudflare (`CLOUDFLARE_API_TOKEN`) deixam de fazer sentido; trocar por
      uso de disco ou esconder.
- [x] 3.4 Migração única: baixar o bucket (79 objetos, 1,74 MB) para o volume
      ANTES de trocar; conferir contagem e bytes; manter o bucket intacto por
      30 dias como reserva.
- [x] 3.5 Backup diário 14+12 local e no Object Storage da Oracle (bucket sondas-backups, instance principal); envio, download e restauração testados em 2026-10-25; falha avisa no Telegram privado
      Oracle (20 GB grátis): 14 diários + 12 semanais; teste de restauração
      real; falha de backup avisa no `adminChatId`.
- [x] 3.6 Docs: `ORACLE.md`, `CLAUDE.md` (seção blobStore), memória do projeto.

## Fase 4: otimizações do servidor

- [x] 4.1 (dispensável: o poll já faz 1 consulta do feed por execução e os navegadores consultam direto; nada a cachear) Cache de 20 a 30 s no servidor do feed ao vivo do radiosondy.info
      (~1 MB) e das consultas ao SondeHub, compartilhado entre abas e cron.
- [x] 4.2 Limite de memória e `restart: unless-stopped` no container do app
      (a VM divide recursos com o app solplanet).
- [x] 4.3 Medir antes/depois (tempo do poll, tráfego); registrar em `ORACLE.md`.

## Fase 5: aviso de lançamento em segundos pelo receptor

Antes: confirmar no firmware se o rdzTTGOsonde já envia ao SondeHub com o
callsign (a memória diz que sim); não duplicar isso.

- [x] 5.1 Investigar no repo do firmware o momento em que uma sonda nova é
      detectada e como o `receiver-report` poderia levar um evento
      "sonda nova ouvida" (serial, freq, lat/lon, alt).
- [x] 5.2 Rota nova (ou campo novo em `/api/receiver-report`) que chama
      `notifyFlightEvent` com o mesmo dedup (`markNotifiedIfNew`), para não
      duplicar com o cron.
- [x] 5.3 Firmware dev20261025.1 compilado e publicado em 2026-10-25 (992512 bytes, idêntico ao compilado); o receptor atualiza sozinho no próximo contato; conferir em Meu receptor que "instalado" virou dev20261025.1
      novo). Cuidado com a invariante do auto-OTA (versão DIFERENTE atualiza):
      só publicar `.bin` novo e correto. Pedir confirmação antes de publicar.
- [ ] 5.4 Comparar o atraso: aviso do receptor vs. aviso do cron.

## Fase 6: Qualidade de recepção (Meu receptor)

- [x] 6.1 Clicar numa estação da lista "Quem ouviu esta sonda" e ver a
      cobertura dela (mesma análise por faixa de elevação, por minuto, usando
      a posição em `receiver-stations`). Aviso na tela: altura da antena
      desconhecida e SondeHub deduplica (cobertura por minuto, nunca por
      contagem de quadros).
- [x] 6.2 Alcance por azimute (rosa dos ventos): distância máxima por direção.
- [x] 6.3 Distância máxima ouvida por voo e evolução no tempo.
- [x] 6.4 Altitude em que a sonda sumiu para cada estação.
- [x] 6.5 RSSI x distância com a curva esperada.
- [x] 6.6 Comparação lado a lado com uma vizinha no mesmo voo.
- [x] 6.7 Ranking das estações que mais ouvem sondas da região.
- [x] 6.8 Lógica pura em `receptionAnalysis.ts`; atualizar o trecho de
      "Diagnóstico de recepção" do `sondas/CLAUDE.md`.

## Regras para todas as fases

- Responder sempre em português.
- Nada de mudar o servidor, publicar firmware ou apagar dados sem confirmar
  o que for irreversível (migração mantém o R2 intacto).
- Alerta de sistema vai SÓ para `adminChatId`; mensagens de sonda vão para
  `chatId` (grupo).
- Depois de mexer no código: `graphify update .`.
