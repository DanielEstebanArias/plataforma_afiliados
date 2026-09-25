FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY tests ./tests
RUN npm run build && npm prune --omit=dev
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production SECURE_COOKIES=true
RUN apt-get update && apt-get install -y --no-install-recommends openssl postgresql-client && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package*.json ./
COPY affiliates/server.cjs ./affiliates/server.cjs
COPY affiliates/web ./affiliates/web
COPY prisma ./prisma
COPY deploy/railway ./deploy/railway
USER node
EXPOSE 8080
CMD ["node", "dist/src/affiliates/production.js"]
