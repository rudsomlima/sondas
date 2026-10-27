#!/bin/sh
# Cron do app Sondas: chama /api/poll (avisos do Telegram, registro de sondas).
# crontab -e:   CRON_TZ=UTC
#               */2 * * * * /home/ubuntu/sondas-app/poll-cron.sh
D=/home/ubuntu/sondas-app
S=$(grep ^CRON_SECRET= "$D/.env" | cut -d= -f2-)
L="$D/poll.log"
[ -f "$L" ] && [ "$(stat -c%s "$L")" -gt 1000000 ] && tail -n 2000 "$L" > "$L.tmp" && mv "$L.tmp" "$L"
C=$(curl -s -m 280 -H "Authorization: Bearer $S" http://127.0.0.1:3002/api/poll -o "$D/poll-last.json" -w "%{http_code}")
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $C" >> "$L"
