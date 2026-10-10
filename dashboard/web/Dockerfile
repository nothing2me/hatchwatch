FROM node:24-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Prisma generate needs a syntactically valid URL at build time only; the real one comes from Compose.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npm run build
ENV NODE_ENV=production
EXPOSE 3000
# exec hands PID 1 to next start (not npm, which does not forward signals), so SIGTERM from `docker compose stop`
# reaches the server and the phone recorder can close its open segments.
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx prisma/seed.ts && exec ./node_modules/.bin/next start -p 3000"]
