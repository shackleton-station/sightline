# The co-pilot service as its own container: one bundled file, the site data its tools read, and two
# hashes. Built from the web/ folder, because that is where the code it shares with the site lives:
#
#   docker build -f copilot/Dockerfile --build-arg VERSION=$(git rev-parse --short HEAD) -t copilot .
#
# What goes in: copilot/ (this service), shared/ (the folder every service's image copies: tracing,
# rate limits, the read-only data tools), src/lib/ and src/data/ (the page's own calculations, which
# the tools and the prompts reuse), and public/data (the pipeline's JSON).
# Not the pages, not server/, not the terrain tiles: the light grid's months are read from the bucket.
#
# Two hashes are worked out here and reported at /api/chat/status. The data version (a hash of
# public/data) is the one every service reports, so a deploy can check they all carry the same data.
# The code version (a hash of the files the co-pilot's handlers are built from) keys the answer cache
# with it, so an answer never outlives the code or the data that worked it out.

# ---- build: bundle the service and hash the data and the code ----
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY shared ./shared
COPY copilot ./copilot
COPY src/lib ./src/lib
COPY src/data ./src/data
COPY scripts/data-version.mjs ./scripts/data-version.mjs
COPY scripts/copilot-version.mjs ./scripts/copilot-version.mjs
COPY public/data ./public/data
# One file with its libraries inside, so the image below needs no node_modules. And a second small
# program, the Redis Cluster drill (copilot/clusterDrill.ts): it is run by hand, from inside the
# network, as a Cloud Run job on this image, and the service never loads it.
RUN npm run build:copilot \
  && npm run build:cluster-drill \
  && node scripts/data-version.mjs public/data > dist-copilot/data-version.json \
  && node scripts/copilot-version.mjs > dist-copilot/copilot-version.json

# ---- run: the bundle, the drill, the data, and the two hashes ----
FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/dist-copilot/index.cjs /app/dist-copilot/cluster-drill.cjs /app/dist-copilot/data-version.json /app/dist-copilot/copilot-version.json ./
# The same files the data hash above was taken from.
COPY --from=build /app/public/data ./data
# The commit this image was built from; the service reports it at /api/chat/status.
ARG VERSION=dev
ENV SERVICE_VERSION=$VERSION
# Not root: the service only reads files, listens on a high port and calls Google's APIs.
USER node
ENV PORT=8080
EXPOSE 8080
CMD ["node", "index.cjs"]
