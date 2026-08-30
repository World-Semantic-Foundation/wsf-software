# WSF Semantic Engine : Production Image
#
# Multi-stage build. The engine has zero runtime dependencies;
# TypeScript is required only at build time.

# ---------- Build stage ----------
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json tsconfig.json ./
RUN npm install --no-audit --no-fund

COPY src ./src
RUN npx tsc

# ---------- Runtime stage ----------
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
# Non-root runtime user
RUN addgroup -S wsf && adduser -S wsf -G wsf

COPY --from=build /app/dist ./dist
COPY package.json ./

USER wsf
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${WSF_PORT:-8080}${WSF_API_PREFIX:-/v1}/health" >/dev/null 2>&1 || exit 1

CMD ["node", "dist/server/main.js"]
