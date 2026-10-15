#!/bin/sh
# Cron diário do app Sondas (substitui o cron da Vercel).
# crontab -e:   CRON_TZ=UTC
#               30 6 * * * /home/ubuntu/sondas-app/poll-cron.sh
D=/home/ubuntu/sondas-app
S=$(grep ^CRON_SECRET= "$D/.env" | cut -d= -f2-)
curl -s -m 280 -H "Authorization: Bearer $S" http://127.0.0.1:3002/api/poll \
  -o "$D/poll-last.json" -w "%{http_code}\n" >> "$D/poll.log" 2>&1
