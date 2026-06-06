# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS build
WORKDIR /app
ARG PUBLIC_APP_NAME
ARG DATABASE_URL
ARG ORIGIN
ARG BETTER_AUTH_SECRET
ENV PUBLIC_APP_NAME=${PUBLIC_APP_NAME}
ENV DATABASE_URL=${DATABASE_URL}
ENV ORIGIN=${ORIGIN}
ENV BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM base AS prod-deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3016

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/package.json ./package.json

EXPOSE 3016
RUN mkdir -p /data && chown -R node:node /data
USER node
CMD ["node", "build"]
