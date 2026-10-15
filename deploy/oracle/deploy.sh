#!/usr/bin/env bash
# Publica uma versão nova na VM. Rode a partir da pasta sondas/ (Git Bash).
# A VM tem 1 GB: compila aqui e só instala dependências lá.
set -euo pipefail
HOST=${HOST:-ubuntu@136.248.78.217}
KEY=${KEY:-$HOME/.ssh/solplanet_oci}
npx next build
tar --exclude=.next/cache -czf /tmp/sondas-app.tgz .next public package.json package-lock.json next.config.js
scp -i "$KEY" /tmp/sondas-app.tgz deploy/oracle/Dockerfile deploy/oracle/docker-compose.yml deploy/oracle/poll-cron.sh "$HOST":~/sondas-app/
ssh -i "$KEY" "$HOST" 'cd ~/sondas-app && tar xzf sondas-app.tgz && rm sondas-app.tgz && chmod 700 poll-cron.sh \
  && sudo nice -n 15 docker compose build && sudo docker compose up -d --force-recreate'
