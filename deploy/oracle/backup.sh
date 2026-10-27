#!/bin/sh
# Backup diário dos dados do app (volume ~/sondas-app/data): 14 diários e 12
# semanais (domingo) em ~/backups, e a mesma cópia no Object Storage da Oracle
# (bucket de ~/sondas-app/backup.conf) com a mesma retenção. Qualquer falha
# avisa no Telegram PRIVADO (/api/system-alert). Ver docs/ORACLE.md.
# crontab -e:   CRON_TZ=UTC
#               15 5 * * * /home/ubuntu/sondas-app/backup.sh
D=/home/ubuntu/sondas-app
B=/home/ubuntu/backups
OCI=/home/ubuntu/oci-venv/bin/oci
CONF="$D/backup.conf"          # BUCKET=nome-do-bucket (sem isso, só o backup local)
S=$(grep ^CRON_SECRET= "$D/.env" | cut -d= -f2-)
KEEP_DAILY=14
KEEP_WEEKLY=12

fail() {
  echo "$1"
  curl -s -m 15 -H "Authorization: Bearer $S" -H "Content-Type: application/json" \
    -d "{\"text\":\"⚠️ Sondas: $1\"}" http://127.0.0.1:3002/api/system-alert -o /dev/null
  exit 1
}

mkdir -p "$B/daily" "$B/weekly"
[ -d "$D/data" ] || exit 0
DAY=$(date -u +%Y%m%d)
F="$B/daily/sondas-$DAY.tar.gz"
tar czf "$F.tmp" -C "$D" data && mv "$F.tmp" "$F" || { rm -f "$F.tmp"; fail "backup local falhou (tar)"; }
# Confere que o arquivo abre e tem conteúdo antes de apagar os antigos.
[ "$(tar tzf "$F" | wc -l)" -gt 1 ] || fail "backup local vazio"
WEEKLY=0
[ "$(date -u +%u)" = 7 ] && { cp "$F" "$B/weekly/sondas-$DAY.tar.gz"; WEEKLY=1; }
ls -1t "$B"/daily/sondas-*.tar.gz  | tail -n +$((KEEP_DAILY + 1))  | xargs -r rm -f
ls -1t "$B"/weekly/sondas-*.tar.gz | tail -n +$((KEEP_WEEKLY + 1)) | xargs -r rm -f

# Cópia fora da VM (Object Storage, autenticação por instance principal).
[ -x "$OCI" ] && [ -f "$CONF" ] || exit 0
BUCKET=$(grep ^BUCKET= "$CONF" | cut -d= -f2-)
[ -n "$BUCKET" ] || exit 0
NS=$($OCI os ns get --auth instance_principal --query data --raw-output 2>/dev/null) \
  || fail "backup externo: não consegui o namespace do Object Storage (política/grupo dinâmico?)"
put() {
  $OCI os object put --auth instance_principal -ns "$NS" -bn "$BUCKET" --name "$1" --file "$2" --force >/dev/null 2>&1
}
put "daily/sondas-$DAY.tar.gz" "$F" || fail "backup externo: falha ao enviar para o bucket $BUCKET"
[ "$WEEKLY" = 1 ] && { put "weekly/sondas-$DAY.tar.gz" "$F" || fail "backup externo: falha ao enviar o semanal"; }
# Retenção no bucket: apaga o que passar do limite (nomes têm a data, ordenam).
prune() {
  $OCI os object list --auth instance_principal -ns "$NS" -bn "$BUCKET" --prefix "$1/" --all 2>/dev/null \
    | python3 -c 'import json,sys
d=json.load(sys.stdin).get("data",[]); keep=int(sys.argv[1])
for n in sorted(o["name"] for o in d)[:-keep]: print(n)' "$2" \
    | while read -r name; do
        $OCI os object delete --auth instance_principal -ns "$NS" -bn "$BUCKET" --object-name "$name" --force >/dev/null 2>&1
      done
}
prune daily "$KEEP_DAILY"
prune weekly "$KEEP_WEEKLY"
