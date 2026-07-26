FROM oven/bun:1.3.10-alpine AS builder

WORKDIR /app

# Nuxt's Nitro bundling step cannot complete under Bun's runtime — rollup's
# module graph for this app exhausts memory and the process dies (SIGSEGV on
# the deploy host, OOM-kill locally). Node completes it, so the build runs on
# Node while the produced server still runs on Bun.
RUN apk add --no-cache nodejs

COPY package.json bun.lock* ./
COPY drizzle.config.ts ./
COPY server/database ./server/database
RUN bun install --frozen-lockfile
RUN bunx drizzle-kit push --force

COPY . .

# Node's default heap is sized from host RAM and is too small for the Nitro
# step on smaller build machines; pin it explicitly instead.
ENV NODE_OPTIONS=--max-old-space-size=4096
RUN node node_modules/nuxt/bin/nuxt.mjs build


FROM oven/bun:1.3.10-alpine

WORKDIR /app

COPY --from=builder /app/.output ./.output

ENV PORT=3000
ENV NODE_ENV=production

EXPOSE 3000

CMD ["bun", ".output/server/index.mjs"]