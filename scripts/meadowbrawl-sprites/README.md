# Meadowbrawl sprite baker

Renders the game's character sprite sheets from CC0 KayKit glTF packs using
three.js inside headless Chromium, so the output is exactly what a browser's
WebGL would draw.

1. Download and extract the packs into one directory (all from
   https://kaylousberg.itch.io, free tiers, CC0): `kaykit-adventurers`,
   `kaykit-skeletons`, `kaykit-character-animations`, `fantasy-weapons-bits`.
   The folder names inside the zips are what `spec.ts` references.
2. In that directory, `bun add playwright-core` (the baker resolves it from
   there so the project's own dependencies stay untouched) and make sure a
   Chromium binary is available (`CHROMIUM=/path/to/chrome` if it is not the
   Playwright default).
3. `bun scripts/meadowbrawl-sprites/bake.ts <that directory> [sheet]`

Output goes to `public/meadowbrawl/sprites/<sheet>.webp` plus `atlas.json`.
Each sheet is one row per animation; a row holds `frames × 5` cells for the
five baked facings (E, NE, N, SE, S). West-side facings are mirrored at draw
time, which keeps the sheets at 5/8 of the size.
