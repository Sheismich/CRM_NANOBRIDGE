# Build multi-stage: node:20-bookworm-slim (glibc, no alpine/musl) porque
# argon2 compila un binario nativo -- alpine complica esa compilación sin
# beneficio real de tamaño para este caso.

FROM node:20-bookworm-slim AS deps
WORKDIR /app
# argon2 compila un binario nativo vía node-gyp si no encuentra un prebuild
# para esta combinación exacta de plataforma/Node -- python3/make/g++ son el
# fallback para que esa compilación funcione en vez de tronar (confirmado
# con un build local: sin esto, "npm ci" falla buscando Python).
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

# Cloud Run inyecta PORT (normalmente 8080) -- env.ts ya lo lee vía
# process.env.PORT, sin código extra que agregar aquí.
EXPOSE 8080
CMD ["node", "dist/main.js"]
