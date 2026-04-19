FROM node:20-slim AS base

# Native build tools for better-sqlite3
RUN apt-get update && apt-get install -y \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install root (frontend) dependencies
COPY package.json package-lock.json ./
RUN npm install

# Install server dependencies
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm install --omit=dev

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
