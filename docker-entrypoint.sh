#!/bin/sh
set -e

# Migrations, not `push`: push decides what to do by diffing against the live
# database, and any diff that drops a populated table or column stops on a
# confirmation prompt that a container cannot answer — whereupon it exits 0
# having applied nothing, including the unrelated creates in the same diff.
# `migrate` runs a fixed statement list, never prompts, and exits non-zero on
# failure, so `set -e` is enough to keep a broken schema from serving traffic.
bunx drizzle-kit migrate

exec bun .output/server/index.mjs
