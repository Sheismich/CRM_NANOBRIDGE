# Build multi-stage sobre node:22-bookworm-slim (glibc, no alpine/musl)
# porque argon2 compila un binario nativo -- alpine complica esa compilación
# sin beneficio real de tamaño para este caso.
#
# Node 22 (B10 del plan de fixes, 2-oct-2026): Node 20 dejó de recibir
# parches de seguridad en abril de 2026. La imagen va fijada por digest para
# que dos builds del mismo commit usen exactamente la misma base; para
# tomar parches nuevos de la imagen hay que actualizar el digest a mano (ver
# RUNBOOK_DEPLOY.md, "Actualizar la imagen base").
ARG NODE_IMAGE=node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
# argon2 compila un binario nativo vía node-gyp si no encuentra un prebuild
# para esta combinación exacta de plataforma/Node -- python3/make/g++ son el
# fallback para que esa compilación funcione en vez de tronar (confirmado
# con un build local: sin esto, "npm ci" falla buscando Python).
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM ${NODE_IMAGE} AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

# Sin root (B10): si alguien lograra ejecutar código dentro del contenedor,
# no podría modificar la app ni el sistema. Los archivos de /app quedan del
# dueño root y solo de lectura para este usuario; la app no escribe a disco
# en producción (STORAGE_DRIVER=gcs).
USER node

# Cloud Run inyecta PORT (normalmente 8080) -- env.ts ya lo lee vía
# process.env.PORT, sin código extra que agregar aquí.
EXPOSE 8080
CMD ["node", "dist/main.js"]
