FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY package.json ./
COPY src ./src
COPY config ./config

RUN mkdir -p /app/data /app/logs

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-8787}/health >/dev/null || exit 1

CMD ["node", "src/server.mjs"]
