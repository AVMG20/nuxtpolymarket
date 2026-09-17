#!/usr/bin/env bash
# Upserts the preview comment on a pull request. Body comes in on stdin.
# Usage: pr-preview-comment.sh <pr> [--edit-only]
set -euo pipefail

pr=$1
mode=${2:-}
marker='<!-- coolify-preview -->'
body="$marker"$'\n'"$(cat)"

id=$(gh api "repos/$GITHUB_REPOSITORY/issues/$pr/comments" --paginate \
    --jq ".[] | select(.body | contains(\"$marker\")) | .id" | head -1)

if [ -n "$id" ]; then
    gh api -X PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$id" -f body="$body" >/dev/null
elif [ "$mode" != --edit-only ]; then
    gh api -X POST "repos/$GITHUB_REPOSITORY/issues/$pr/comments" -f body="$body" >/dev/null
fi
