FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json ./client/package.json
COPY server/package.json ./server/package.json
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run db:generate && mkdir -p /app/uploads/raw /app/uploads/media /app/.data && chown -R node:node /app/uploads /app/.data

FROM base AS worker
USER node
CMD ["npm", "run", "worker"]

FROM base AS runtime
RUN npm run build
USER node
EXPOSE 4000
CMD ["npm", "start"]
