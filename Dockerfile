FROM oven/bun:1.3.10-alpine AS builder

WORKDIR /app

# The Nitro bundling step is memory-hungry, and under Bun's runtime it balloons
# until the process is killed. Node completes the same step within a heap we can
# cap explicitly, so the build runs on Node while the output still runs on Bun.
RUN apk add --no-cache nodejs

# Only the manifest gates this layer, so dependency install survives source
# edits. --ignore-scripts skips the postinstall `nuxt prepare`, which has no
# app code to work with at this point and is redone by `nuxt build` anyway.
COPY package.json bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --ignore-scripts

COPY . .

# Node sizes its default heap from host RAM, which lands too small on modest
# build machines. Pin it: this build needs ~6 GB.
ENV NODE_OPTIONS=--max-old-space-size=6072
RUN node node_modules/nuxt/bin/nuxt.mjs build


FROM oven/bun:1.3.10-alpine

WORKDIR /app

# Migrations run at container start, not image build: at build time they would
# need a live database reachable from `docker build`, and a cached layer would
# silently skip them against a fresh database. Only the migration toolchain is
# installed here; versions track package.json.
RUN bun add drizzle-kit@^0.31.10 drizzle-orm@^0.45.1 pg@^8.20.0 dotenv@^17

COPY drizzle.config.ts ./
COPY drizzle ./drizzle
COPY server/database/schema.ts ./server/database/schema.ts
COPY scripts/ensure-preview-db.ts ./scripts/ensure-preview-db.ts
COPY --chmod=755 docker-entrypoint.sh ./
COPY --from=builder /app/.output ./.output

ENV PORT=3000
ENV NODE_ENV=production

EXPOSE 3000

USER bun

ENTRYPOINT ["/app/docker-entrypoint.sh"]
