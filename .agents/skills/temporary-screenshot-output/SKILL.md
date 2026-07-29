---
name: temporary-screenshot-output
description: Keep temporary screenshots, Playwright captures, traces, videos, snapshots, and other visual-QA artifacts outside the Nuxtpolymarket repository. Use whenever capturing browser or canvas evidence, creating diagnostic images, or choosing an output path for transient Playwright artifacts in this project.
---

# Temporary Screenshot Output

Store transient visual-QA artifacts under `/tmp`, never in the repository.

## Output paths

- Use absolute, descriptive paths such as `/tmp/pathwarden-expanded-seed-42.png`.
- Send Playwright screenshots, traces, videos, downloaded snapshots, and related temporary output to `/tmp`.
- Put generated comparison images, crops, and diagnostic captures in `/tmp` as well.
- Inspect artifacts directly from `/tmp`; do not copy them into the worktree for convenience.

## Repository exceptions

Write an image or browser artifact into the repository only when the user explicitly asks to add a maintained fixture, baseline, product asset, or documentation image. Confirm the intended tracked location before creating it.

Do not delete pre-existing repository artifacts unless the user asks for cleanup.
