FROM node:24-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG LAN_HOST
ENV LAN_HOST=$LAN_HOST
# Prisma generate needs a syntactically valid URL at build time only; the real one comes from Compose.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npm run build
ENV NODE_ENV=production
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx prisma/seed.ts && npm run start"]
