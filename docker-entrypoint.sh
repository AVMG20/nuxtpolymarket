#!/bin/sh
set -e

bunx drizzle-kit push --force

exec bun .output/server/index.mjs
