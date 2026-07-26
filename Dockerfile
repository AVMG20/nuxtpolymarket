FROM oven/bun:1.3.10-alpine AS builder

WORKDIR /app

# The Nitro bundling step is memory-hungry, and under Bun's runtime it balloons
# until the process is killed. Node completes the same step within a heap we can
# cap explicitly, so the build runs on Node while the output still runs on Bun.
RUN apk add --no-cache nodejs

COPY package.json bun.lock* ./
COPY drizzle.config.ts ./
COPY server/database ./server/database
RUN bun install --frozen-lockfile
RUN bunx drizzle-kit push --force

COPY . .

# Node sizes its default heap from host RAM, which lands too small on modest
# build machines. Pin it: 3 GB is enough for this build (measured ~4 GB peak
# RSS including Vite's native side) while leaving the box some headroom.
ENV NODE_OPTIONS=--max-old-space-size=3072
RUN node node_modules/nuxt/bin/nuxt.mjs build


FROM oven/bun:1.3.10-alpine

WORKDIR /app

COPY --from=builder /app/.output ./.output

ENV PORT=3000
ENV NODE_ENV=production

EXPOSE 3000

CMD ["bun", ".output/server/index.mjs"]