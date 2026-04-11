FROM node:22-slim AS base

RUN npm install -g pnpm@10.4.1

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
COPY patches/ ./patches/

RUN pnpm install --no-frozen-lockfile

COPY . .

RUN pnpm run build

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "dist/index.js"]
