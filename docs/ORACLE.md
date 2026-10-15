# App Sondas na Oracle Cloud

Guia de operação do app hospedado na VM Oracle (desde 2026-10-15). Antes ele
rodava na Vercel, com um relay HTTP→HTTPS numa VM do Google Cloud.

## Por que migrou

O firmware do receptor (rdzTTGOsonde) não tem TLS e só fala `http://`. Por isso
os relatórios passavam por um relay (`sonda-relay`, GCP, IP `34.75.68.60`) que
refazia a chamada em HTTPS para `sondas.vercel.app`.

Em 2026-10-15 a Vercel passou a responder **403 com `x-vercel-mitigated:
challenge`** (página "Vercel Security Checkpoint") para o IP do relay. O
firmware não resolve esse desafio, então todo relatório era recusado: o painel
"Meu receptor" ficava parado, o IP local abria devagar e o receptor insistia a
cada 10 s. O plano gratuito da Vercel não tem "IP Bypass", e criar regra de
firewall pela CLI foi bloqueado. Solução: hospedar o app numa VM própria, onde o
firmware fala HTTP direto, sem relay e sem desafio.

## Como está montado

```
receptor (firmware)  --http-->  136.248.78.217:80  ┐
navegador            --https--> sondas-pu7iol.duckdns.org ┤  Caddy (container do solplanet)
                                                    ┘        │
                                                             ▼
                                              container "sondas" :3002  (Next.js)
                                                             │
                                                             ▼
                                                  Cloudflare R2, bucket "sondas"
```

| Item | Valor |
|---|---|
| VM | `solplanet-micro` (Oracle, E2.1.Micro, 1 GB RAM + 2 GB swap), Ubuntu 24.04 |
| IP público (fixo) | `136.248.78.217` |
| Acesso | `ssh -i ~/.ssh/solplanet_oci ubuntu@136.248.78.217` |
| Painel | `https://sondas-pu7iol.duckdns.org/painel` |
| Firmware (`mqtt.siteurl`) | `http://136.248.78.217` (sem `https`, sem barra final) |
| Pasta na VM | `~/sondas-app` |
| Container | `sondas-sondas-1` (limite 450 MB, porta 3002, também em `127.0.0.1:3002`) |
| Dados | R2 (mesmo bucket de antes; o histórico foi preservado) |

A VM **divide** a máquina com o app solplanet. O Caddy e a rede Docker
(`solplanet_default`) são do solplanet; o Sondas só acrescenta blocos ao
Caddyfile dele. Em `deploy/oracle/Caddyfile.sondas` estão os blocos.

## Variáveis de ambiente (`~/sondas-app/.env`, modo 600)

Modelo em `deploy/oracle/.env.example`.

- `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`:
  token de R2 com *Object Read & Write* só no bucket `sondas` (Cloudflare → R2 →
  Manage API tokens). O Access Key ID é o ID do token; o Secret é o SHA-256 do
  "Token value".
- `CLOUDFLARE_API_TOKEN`: opcional. Token só *Account › Account Analytics › Read*
  para o painel de métricas do R2 em Configurações. Sem ele só essa tela fica
  vazia.
- `CRON_SECRET`: protege `/api/poll`. **Se ficar vazio, a rota fica aberta**
  (a checagem é pulada). Gere um valor aleatório.

Armadilhas já encontradas:
- Valores **sem aspas**: o `env_file` do Docker guarda as aspas como parte do
  valor, e o app passa a "não achar" as credenciais.
- A Vercel marca esses segredos como sensíveis: `vercel env pull` traz valores
  **vazios**. Não dá para copiar da Vercel; crie tokens novos.

## Publicar uma versão nova

Na pasta `sondas/` (Git Bash):

```bash
./deploy/oracle/deploy.sh
```

Compila no PC (`next build`), envia `.next`, `public` e o `package*.json`, e na
VM instala as dependências (inclui o `sharp`, que depende do sistema) e recria o
container. Compilar na própria VM leva de 20 a 40 min e estoura a memória.

## Cron diário

`/api/poll` roda às 06:30 UTC pelo cron do usuário `ubuntu` na VM (era o cron da
Vercel). Script: `deploy/oracle/poll-cron.sh`; log em `~/sondas-app/poll.log`
(`200` = ok).

```
CRON_TZ=UTC
30 6 * * * /home/ubuntu/sondas-app/poll-cron.sh
```

## Recarregar o Caddy

O Caddyfile do solplanet é montado como **arquivo único**. Se o arquivo for
trocado por um editor, o container continua vendo a versão antiga e o
`caddy reload` responde "config is unchanged". Recrie o container (leva alguns
segundos; os certificados ficam em volume):

```bash
cd ~/solplanet/deploy/oracle
set -a; . ./.env; set +a
sudo -E docker compose -f docker-compose.yml -f docker-compose.image.yml \
  -f docker-compose.cost.yml up -d --no-deps --force-recreate caddy
```

(use só os `-f` que o `compose.sh` do solplanet incluiria para o seu `.env`).
Backups feitos na migração: `Caddyfile.bak-pre-sondas` e
`Caddyfile.bak-pre-duckdns`.

## Não repetir

- O serviço no compose **não pode se chamar `app`**: o Caddy do solplanet chega
  no app dele pelo apelido `app` na rede compartilhada e passaria a falar com o
  container errado.
- Memória: Sondas (~200 MB) + solplanet (~250 MB) numa máquina de 1 GB. Se um
  dos dois ficar lento, olhe `free -m`, `docker stats` e o swap.

## Diagnóstico rápido

```bash
# o receptor está falando com o servidor? (pacotes na porta 80 do IP dele)
sudo tcpdump -n -l -A -s 300 -i ens3 'tcp dst port 80 and src host <IP público do receptor>' \
  | grep -oE '(POST|GET) [^ ]+' | sort | uniq -c
```

Tráfego normal por ~40 s: vários `POST /api/receiver-report` e consultas
`GET /api/receiver-config/request`, `.../receiver-power/boost`,
`.../receiver-screens/request`. O Caddy só registra **erros**, então ausência de
log não prova ausência de tráfego.

Teste de ponta a ponta do relatório (use um prefixo de teste e JSON em arquivo;
no PowerShell 5.1 as aspas do `-d` são removidas):

```
curl --data-binary @t.json -H "Content-Type: application/json" \
  http://136.248.78.217/api/receiver-report      # esperado: 200
```

Idade do último relatório de um receptor:
`GET /api/receiver-live-status?receiver=<prefixo>` → `status.updatedAt` (ms).

## Vercel e relay (desligados)

- **Relay GCP `sonda-relay`**: VM **parada** (`TERMINATED`), IP reservado
  mantido. Religar: `gcloud compute instances start sonda-relay --zone=us-east1-b`.
  Pode ser apagada depois (`http-relay/` continua no repositório do app).
- **Vercel (`sondas`)**: mantida só como contingência, **sem cron**
  (`vercel.json` não tem mais `crons`, para não duplicar o `/api/poll` que roda
  na Oracle). Depois de alguns dias estável, pode ser apagada.
  Atenção: o código em produção na Vercel só perde o cron quando um novo deploy
  for publicado com este `vercel.json`.

## Pendências

- Apagar o prefixo de teste `zz-teste-claude` (lista de receptores conhecidos).
- Rotacionar os tokens do R2 e de métricas, pois foram colados em conversa.
- Atualizar `mqtt.siteurl` de qualquer outro receptor que ainda use o relay.
