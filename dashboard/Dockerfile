# NestTrace dashboard + camera relay as one container.
#   docker build -t nesttrace-dashboard .
#   docker run -p 5182:5182 -e NESTTRACE_ACCESS_KEY=... -v nesttrace-recordings:/app/recordings nesttrace-dashboard
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
ENV NODE_ENV=production PORT=5182 NESTTRACE_RECORDINGS_DIR=/app/recordings
COPY --from=build /app/dist ./dist
COPY server ./server
COPY package.json ./
RUN mkdir -p /app/recordings && chown node:node /app/recordings
# Keep footage on a volume so it survives container restarts and upgrades.
VOLUME /app/recordings
USER node
EXPOSE 5182
CMD ["node", "server/server.mjs"]
