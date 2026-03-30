# ═══════════════════════════════════════════════════════════════
# KelionAI v3.3 — Multi-stage Docker Build
# Stage 1: Install deps → Stage 2: Copy app → Runtime
# ═══════════════════════════════════════════════════════════════

# ── Stage 1: Dependencies ──
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts --legacy-peer-deps && npm cache clean --force

# ── Stage 2: Runtime ──
FROM node:20-alpine AS runtime
WORKDIR /app

# Security: non-root user
RUN addgroup -S kelion && adduser -S kelion -G kelion

# Runtime deps
RUN apk add --no-cache dumb-init curl && rm -rf /var/cache/apk/*

# Copy deps
COPY --from=deps /app/node_modules ./node_modules

# Copy app (ARG bust forces rebuild when code changes)
ARG CACHE_BUST=1
COPY package.json ./
COPY server/ ./server/
COPY app/ ./app/
COPY config/ ./config/
COPY scripts/ ./scripts/
COPY public/ ./public/

# Copy config
COPY .env.example .env.example

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:${PORT:-3000}/api/health || exit 1

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Security: non-root user with minimal write permissions
RUN chown -R kelion:kelion /app && \
    chmod -R a-w /app && \
    mkdir -p /tmp/kelion && chown kelion:kelion /tmp/kelion

USER kelion
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server/index.js"]
