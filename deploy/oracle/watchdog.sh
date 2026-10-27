#!/bin/sh
# Vigia do app: avisa no Telegram PRIVADO (adminChatId, nunca o grupo) quando
#  1. o /api/poll para de rodar (ou o app não responde) e quando volta;
#  2. o armazenamento falha (erros de leitura/escrita seguidos nos logs) e quando
#     volta ao normal;
#  3. o disco da VM passa de 90% (e quando volta abaixo).
# Roda fora do app de propósito: se o app cair, só um processo externo avisa.
# crontab -e:   CRON_TZ=UTC
#               */5 * * * * /home/ubuntu/sondas-app/watchdog.sh
D=/home/ubuntu/sondas-app
CONF="$D/watchdog.conf"      # BOT_TOKEN=... / ADMIN_CHAT=... (cópia local)
LOG="$D/watchdog.log"
MAX_MIN=7                    # sem poll há mais que isso = parado
MAX_ERR=5                    # erros de armazenamento nos últimos 10 min = falha
MAX_DISK=90                  # % de uso do disco
S=$(grep ^CRON_SECRET= "$D/.env" | cut -d= -f2-)
URL=http://127.0.0.1:3002

# Renova a cópia local do token/chat com o app no ar (best effort).
CFG=$(curl -s -m 15 -H "Authorization: Bearer $S" "$URL/api/system-alert")
T=$(echo "$CFG" | sed -n 's/.*"botToken":"\([^"]*\)".*/\1/p')
C=$(echo "$CFG" | sed -n 's/.*"adminChatId":"\([^"]*\)".*/\1/p')
if [ -n "$T" ] && [ -n "$C" ]; then
  printf 'BOT_TOKEN=%s\nADMIN_CHAT=%s\n' "$T" "$C" > "$CONF"
  chmod 600 "$CONF"
fi
[ -f "$CONF" ] || exit 0    # alertas do sistema ainda não configurados
BOT_TOKEN=$(grep ^BOT_TOKEN= "$CONF" | cut -d= -f2-)
ADMIN_CHAT=$(grep ^ADMIN_CHAT= "$CONF" | cut -d= -f2-)

# Guarda só o fim do log (evento por linha, com data).
[ -f "$LOG" ] && [ "$(stat -c%s "$LOG")" -gt 200000 ] && tail -n 500 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
note() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $1" >> "$LOG"; }

send() {
  curl -s -m 20 "https://api.telegram.org/bot$BOT_TOKEN/sendMessage" \
    --data-urlencode "chat_id=$ADMIN_CHAT" --data-urlencode "text=$1" -o /dev/null
}

# Alterna um alerta pela transição: $1=nome (arquivo de estado), $2=1 se com
# problema agora, $3=texto de quando o problema começa, $4=texto de quando passa.
transition() {
  ST="$D/watchdog.$1.state"
  if [ "$2" = 1 ]; then
    if [ ! -f "$ST" ]; then echo down > "$ST"; note "$1: PROBLEMA"; send "$3"; fi
  else
    if [ -f "$ST" ]; then rm -f "$ST"; note "$1: normalizado"; send "$4"; fi
  fi
}

# 1. Idade do último poll (sem resposta = app fora do ar).
STATUS=$(curl -s -m 15 "$URL/api/sonde-registry/status")
LAST=$(echo "$STATUS" | sed -n 's/.*"lastRunAt":\([0-9]*\).*/\1/p')
NOW=$(date +%s)
if [ -n "$LAST" ]; then AGE_MIN=$(( (NOW - LAST / 1000) / 60 )); REASON=""
else AGE_MIN=9999; REASON=" (o app nao respondeu)"; fi
if [ "$AGE_MIN" -eq 9999 ]; then M="sem informacao"; else M="${AGE_MIN} min"; fi
BAD=0; [ "$AGE_MIN" -gt "$MAX_MIN" ] && BAD=1
transition poll "$BAD" \
  "⚠️ Sondas: o poll (avisos de lancamento/pouso) esta parado ha ${M}${REASON}. Nenhum aviso de sonda sera enviado ate voltar." \
  "✅ Sondas: o poll voltou a rodar. Os avisos de sonda estao normais."

# 2. Erros de armazenamento recentes nos logs do container (só linhas de erro de
#    leitura/escrita do blobStore, que começam com "[R2]").
ERRS=$(docker logs --since 10m sondas-sondas-1 2>&1 | grep -c '^\[R2\].*falhou')
BAD=0; [ "${ERRS:-0}" -ge "$MAX_ERR" ] && BAD=1
transition storage "$BAD" \
  "⚠️ Sondas: o armazenamento esta com falhas (${ERRS} erros de leitura/gravacao nos ultimos 10 min). Pode haver perda de dados; veja os logs do container." \
  "✅ Sondas: o armazenamento voltou ao normal."

# 3. Espaço em disco.
USED=$(df -P / | awk 'NR==2 {gsub("%","",$5); print $5}')
BAD=0; [ "${USED:-0}" -ge "$MAX_DISK" ] && BAD=1
transition disk "$BAD" \
  "⚠️ Sondas: o disco da VM esta com ${USED}% de uso." \
  "✅ Sondas: o disco da VM voltou abaixo de ${MAX_DISK}%."
