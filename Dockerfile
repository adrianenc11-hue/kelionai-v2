FROM node:22-slim AS base
RUN npm install -g pnpm@10.4.1
WORKDIR /app

# Install dependencies
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

# Build frontend + server
RUN pnpm run build

# Production
ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/index.js"]
