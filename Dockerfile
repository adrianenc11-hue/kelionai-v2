FROM node:20-slim AS base

# Install system dependencies for better-sqlite3 and other native modules
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy root manifests
COPY package.json package-lock.json ./

# Copy server manifests
COPY server/package.json server/package-lock.json ./server/

# Install root dependencies (frontend)
RUN npm install

# Install server dependencies
RUN cd server && npm install --omit=dev

# Copy all files
COPY . .

# Build the frontend
RUN npm run build

# Production Environment
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Start from the server directory
CMD ["npm", "run", "server:start"]
