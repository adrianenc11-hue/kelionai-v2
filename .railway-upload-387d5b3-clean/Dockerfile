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
ENV DB_PATH=/data/kelion.db

RUN mkdir -p /data

EXPOSE 8080

CMD ["node", "server/src/index.js"]
