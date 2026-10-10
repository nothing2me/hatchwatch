# NestTrace dashboard backend (live feed, nest log, phone camera relay) and
# the built dashboard as one container.
#   docker build -t nesttrace-dashboard .
#   docker run -p 5182:5182 -e NESTTRACE_ACCESS_KEY=... \
#     -v nesttrace-recordings:/app/recordings -v nesttrace-data:/app/server-data \
#     -v /path/to/artifacts/public:/app/artifacts/public:ro nesttrace-dashboard
# Put it behind HTTPS (a host like Render/Fly/Railway, Caddy, or a
# Cloudflare tunnel); phone browsers only open the camera on HTTPS pages.

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
# ffmpeg turns recorded segments into small, browser-playable .mp4 files.
RUN apk add --no-cache ffmpeg
WORKDIR /app
ENV NODE_ENV=production PORT=5182 \
    NESTTRACE_RECORDINGS_DIR=/app/recordings \
    NESTTRACE_DASHBOARD_DATA=/app/server-data \
    NESTTRACE_PUBLIC_ARTIFACTS=/app/artifacts/public
COPY --from=build /app/dist ./dist
COPY server ./server
# The backend reuses the beach layout, event wording and status rules from src/.
COPY src ./src
COPY package.json ./
RUN mkdir -p /app/recordings /app/server-data && chown node:node /app/recordings /app/server-data
# Keep footage and the nest log on volumes so they survive restarts and upgrades.
VOLUME /app/recordings
VOLUME /app/server-data
USER node
EXPOSE 5182
CMD ["node", "server/server.js", "--lan"]
