FROM node:20-slim AS base

# Native build tools for better-sqlite3 + Chromium system dependencies for Playwright
RUN apt-get update && apt-get install -y \
    python3 make g++ \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 \
    libpango-1.0-0 libcairo2 libasound2 libxshmfence1 libx11-xcb1 \
    fonts-liberation wget ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install root (frontend) dependencies
COPY package.json package-lock.json ./
RUN npm install

# Install server dependencies
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm install --omit=dev

# Download Chromium browser for Playwright
RUN cd server && npx playwright install chromium

# Copy source and build frontend
COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=8080
# DB lives on the Railway persistent volume. We standardise on
# /app/server/data/kelion.db because that is the path RAILWAY_SETUP.md
# instructs operators to mount the volume at; keeping Dockerfile and
# docs aligned stops the SQLite file from landing on ephemeral disk
# (which silently wipes credits + memories on every redeploy).
ENV DB_PATH=/app/server/data/kelion.db

RUN mkdir -p /app/server/data

EXPOSE 8080

CMD ["node", "server/src/index.js"]
