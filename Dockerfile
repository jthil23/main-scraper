# ── Stage 1: Builder ──────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Install all dependencies (including devDeps for TypeScript compiler)
COPY package.json package-lock.json ./
RUN npm ci

# Compile TypeScript using production config (no sourcemaps/declarations)
COPY tsconfig.json tsconfig.prod.json ./
COPY src/ ./src/
RUN npm run build -- --project tsconfig.prod.json

# ── Stage 2: Runner ───────────────────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app

# Install production dependencies only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

CMD ["node", "dist/index.js"]
