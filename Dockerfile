# syntax=docker/dockerfile:1
# Multi-stage build: bouwt de client (Vite) en bundelt de server (esbuild), en
# levert een slanke runtime-image die de statische client én de WebSocket op één
# poort serveert. De server-bundel is self-contained (engine + ws + sirv erin),
# dus de runtime heeft GEEN node_modules nodig.

# --- build stage ---
FROM node:22-alpine AS build
WORKDIR /app

# Eerst alleen de manifests → betere layer-caching voor npm ci.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/client/package.json packages/client/
COPY packages/server/package.json packages/server/
RUN npm ci

# Daarna de broncode en bouwen.
COPY . .
RUN npm run build -w @kingen/client \
 && npm run build -w @kingen/server

# --- runtime stage ---
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    PUBLIC_DIR=/app/public
COPY --from=build /app/packages/server/dist/index.cjs ./index.cjs
COPY --from=build /app/packages/client/dist ./public
EXPOSE 8080
# Eenvoudige healthcheck op /health.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://localhost:8080/health || exit 1
CMD ["node", "index.cjs"]
