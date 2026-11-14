# The plans service as its own container: one bundled file, and the site data it writes a plan's
# brief from. Built from the web/ folder, because that is where the code it shares with the site lives:
#
#   docker build -f plans/Dockerfile --build-arg VERSION=$(git rev-parse --short HEAD) -t plans .
#
# What goes in: plans/ (this service), shared/ (the folder every service's image copies: tracing,
# rate limits, the sign-in check, the read-only data tools), src/lib/ and src/data/ (the page's own
# calculations, which the data tools reuse), and public/data (the pipeline's JSON).
# Not the pages, not server/, not the terrain tiles.
#
# The image carries the whole of public/data, not only the files a brief reads. Every service that
# reads the site data carries the same folder and reports a hash of it, so "the same data
# everywhere" can be checked by comparing one value (scripts/data-version.mjs).

# ---- build: bundle the service and hash the site data ----
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY shared ./shared
COPY plans ./plans
COPY src/lib ./src/lib
COPY src/data ./src/data
COPY scripts/data-version.mjs ./scripts/data-version.mjs
COPY public/data ./public/data
# One file with its libraries inside, so the image below needs no node_modules.
RUN npm run build:plans && node scripts/data-version.mjs public/data > dist-plans/data-version.json

# ---- run: the bundle, the data, and the data's hash ----
FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/dist-plans/index.cjs /app/dist-plans/data-version.json ./
# The same files the hash above was taken from.
COPY --from=build /app/public/data ./data
# The commit this image was built from; the service reports it at /api/plans/status.
ARG VERSION=dev
ENV SERVICE_VERSION=$VERSION
# Not root: the service only reads files, listens on a high port and calls Google's APIs.
USER node
ENV PORT=8080
EXPOSE 8080
CMD ["node", "index.cjs"]
