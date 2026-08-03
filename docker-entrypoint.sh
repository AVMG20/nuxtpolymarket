#!/bin/sh
set -e

# drizzle-kit exits 0 when it abandons a push it cannot ask about — a rename
# prompt has nowhere to appear in a container — so the exit code proves nothing
# and only the output says whether the schema landed. Booting on an unapplied
# push serves new code against an old database, which surfaces as a game bug.
output=$(bunx drizzle-kit push --force 2>&1)
echo "$output"
case "$output" in
    *'Changes applied'* | *'No changes detected'*) ;;
    *)
        echo 'drizzle-kit push did not apply the schema — refusing to start' >&2
        exit 1
        ;;
esac

exec bun .output/server/index.mjs
