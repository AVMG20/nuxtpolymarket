FROM oven/bun:1.3.10-alpine AS builder

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

# ---

FROM oven/bun:1.3.10-alpine

WORKDIR /app

COPY --from=builder /app/.output ./.output

ENV PORT=3000
ENV NODE_ENV=production

EXPOSE 3000

CMD ["bun", ".output/server/index.mjs"]
