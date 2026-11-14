# The web server as one container: the built pages and the site data they load, plus the small
# server in server/ (pages, tiles, video, voice, rooms, status). The co-pilot, plans and the events
# worker have their own images (copilot/Dockerfile, plans/Dockerfile, events-worker/Dockerfile).
# Build from this folder:  docker build -t clps-web .

# ---- build: compile the pages and bundle the server ----
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm run build:server

# ---- run: only what the server needs ----
FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
# Not root: the server only reads files and listens on a high port.
USER node
ENV PORT=8080
EXPOSE 8080
CMD ["node", "dist-server/index.js"]
