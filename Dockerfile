FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build
FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends chromium ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/portal ./portal
COPY --from=build --chown=node:node /app/affiliates/server.cjs ./affiliates/server.cjs
COPY --from=build --chown=node:node /app/affiliates/web ./affiliates/web
COPY --from=build --chown=node:node /app/package*.json ./
RUN mkdir -p /app/artifacts && chown node:node /app/artifacts
USER node
EXPOSE 3000
CMD ["node","dist/src/main.js"]
