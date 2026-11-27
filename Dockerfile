# syntax=docker/dockerfile:1.7

# The image holds no configuration: everything, ORIGIN included, is read from the environment when
# the container starts (see docs/self-hosting.md), so one image works for every server.

# The stages that install and build run on the platform doing the build, also when building for
# another: their output is the same everywhere. better-sqlite3, the one package with a native part,
# comes with its binaries for every platform.
FROM --platform=$BUILDPLATFORM node:26-trixie-slim AS base
# Node no longer comes with corepack, so install the pnpm version that packageManager in
# package.json names.
COPY package.json /tmp/package.json
RUN npm install --global "pnpm@$(node -p "require('/tmp/package.json').packageManager.split('@')[1]")" \
	&& rm /tmp/package.json

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The build loads the server code, which wants a database path and refuses Better Auth's default
# secret. Neither value ends up in the build: both are read again when the server starts.
RUN DATABASE_URL=:memory: BETTER_AUTH_SECRET=only-used-while-building-never-at-runtime pnpm build \
	&& mkdir /data

FROM base AS prod-deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

# No RUN in this stage, so building it for another platform needs no emulation.
FROM node:26-trixie-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3016

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/package.json ./package.json
# The database's directory, owned by the image's non-root user (uid 1000).
COPY --from=build --chown=node:node /data /data

EXPOSE 3016
USER node
CMD ["node", "build"]
