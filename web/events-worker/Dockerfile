# The events worker as its own container: one bundled file and nothing else.
# Built from the web/ folder, because that is where the code it shares with the site lives:
#
#   docker build -f events-worker/Dockerfile --build-arg VERSION=$(git rev-parse --short HEAD) -t events-worker .
#
# What goes in: events-worker/ (this service) and shared/ (the folder every service's image copies:
# tracing, the event's contract, the counters, Google token checks). Not the pages, not server/, not
# the site data: only a hash of the data, so the worker can report which data its commit carried.

# ---- build: bundle the worker and hash the site data ----
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY shared ./shared
COPY events-worker ./events-worker
COPY scripts/data-version.mjs ./scripts/data-version.mjs
COPY public/data ./public/data
# One file with its libraries inside, so the image below needs no node_modules.
RUN npm run build:worker && node scripts/data-version.mjs public/data > dist-worker/data-version.json

# ---- run: the bundle, and the data's hash ----
FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/dist-worker/index.cjs /app/dist-worker/data-version.json ./
# The commit this image was built from; the worker reports it at /status.
ARG VERSION=dev
ENV SERVICE_VERSION=$VERSION
# Not root: the worker only listens on a high port and calls Google's APIs.
USER node
ENV PORT=8080
EXPOSE 8080
CMD ["node", "index.cjs"]
