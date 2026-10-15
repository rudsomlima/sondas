FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY next.config.js ./
COPY public ./public
COPY .next ./.next
EXPOSE 3002
CMD ["npx","next","start","-p","3002"]
