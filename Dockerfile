FROM node:22-slim AS base
RUN npm install -g pnpm@10.4.1
WORKDIR /app

# Install dependencies - patches needed for pnpm install
COPY package.json pnpm-lock.yaml ./
COPY patches/ ./patches/
RUN pnpm install --no-frozen-lockfile

# Copy source
COPY . .

# Build frontend + server
RUN pnpm run build

# Production
ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
