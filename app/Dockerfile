# syntax=docker/dockerfile:1
#
# Memories app server. Multi-stage build on Debian slim (glibc) — far more
# reliable than alpine/musl for the native modules this app uses: canvas,
# sharp and bcrypt. Secrets are NEVER copied in (see .dockerignore); the real
# .env / .env.notification are mounted at runtime by docker-compose.

############################  build toolchain  ############################
# Shared base that has everything needed to COMPILE the native modules.
FROM node:20-bookworm-slim AS build-base
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential \
      python3 \
      pkg-config \
      libcairo2-dev \
      libpango1.0-dev \
      libjpeg-dev \
      libgif-dev \
      librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

############################  full deps (incl dev)  #######################
# Used only to build the app (needs vite, tailwind, dotenv-cli, etc.).
FROM build-base AS deps
COPY package.json package-lock.json .npmrc ./
RUN npm ci

############################  production deps  ############################
# Slim node_modules that ship in the final image.
FROM build-base AS prod-deps
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev

############################  build the app  #############################
FROM build-base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

############################  runtime image  ############################
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    npm_config_update_notifier=false \
    npm_config_fund=false
# Only the shared libraries canvas needs at run time (sharp bundles its own
# libvips, bcrypt has no runtime system deps).
RUN apt-get update && apt-get install -y --no-install-recommends \
      libcairo2 \
      libpango-1.0-0 \
      libpangocairo-1.0-0 \
      libjpeg62-turbo \
      libgif7 \
      librsvg2-2 \
      wget \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Production node_modules + the built output + just the files the server needs.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY package.json package-lock.json .npmrc ./
COPY server ./server
COPY public ./public

# Drop privileges to the unprivileged "node" user that ships with the image.
RUN chown -R node:node /app
USER node

EXPOSE 3000

# `npm run start` → dotenv-cli loads the mounted .env / .env.notification, then
# boots the express + React Router server (server/startWithPreload.mjs).
CMD ["npm", "run", "start"]
