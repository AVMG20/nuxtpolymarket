# Holdfast — handoff notes

Real-time castle-defence RTS at `/holdfast`. Raiders attack your keep in escalating waves. You build an economy, walls, gates and towers, and command packs of soldiers. Survive to **25:00** to win. The **Bloodmoon** at 20:00 is meant to end almost every run before that. No coins or gems are involved yet. There is a per-map survival leaderboard.

This file is the full context for picking the work up again. Work lives on branch `feature/holdfast`. Several parallel work streams were stopped mid-task on 2026-09-24, and the **Status** section says exactly where each one stopped.

---

## 1. What the user asked for (the brief, in order)

1. **Base game.** An active RTS in which a camp or castle gets attacked by AI.
   - Place packs of archers and warriors from a bottom toolbar.
   - Three difficulties, each with a different keep position and more attack lanes.
   - The camera can move. Runs last 10–20 minutes, and reaching 25 minutes counts as a win.
2. **Look and feel.** Voxel or low-poly style, smooth UX above all. Placing units shows rings where they'll spawn plus ghost soldiers.
3. **Economy.**
   - Gold is the main resource. Wood is needed for buildings and walls. Wood becomes stone through the Stonemason. Crystals come from the Crystal Mine and pay for upgrades.
   - You start with one income building.
   - Every extra building of the same type costs more, so upgrading is encouraged over spamming.
   - The core tension is greed (income and upgrades) against defence (units and walls).
4. **Walls, gates and buildings.** All of them can be placed, upgraded and destroyed. Enemies arrive in packs of 6 or more and grow over time.
5. **Controls.** Packs can be moved and have their own AI: they engage enemies near their post and reposition. There is **no pause**, only 2x speed. Leaderboard: yes.
6. **Later feedback, in order:**
   - More build space.
   - Start with a basic base with pre-placed gates. Players rarely build gates themselves, so the starting ring has them.
   - Show the map-edge margin as unbuildable.
   - Resources sit above the build bar.
   - **Walls like Age of Empires IV:** wide walkways with archers standing on them, a crenellated outer parapet, towers where walls turn or end, gatehouses, a team-coloured band. Warriors must NOT walk over walls. Friendly units pass through gates, enemies don't. Archers can get onto walls and stay there.
   - Raider AI must path to gaps instead of grinding against walls.
   - Graphics: "stunning Steam / Age of Empires", cleaner and more detailed, **less mobile-like**, more flying arrows, more effects and sounds — "the wow factor".
   - More dopamine and a semi-fast pace. Be bold.
   - **New units:** a stronger warrior (**knight**) and a siege unit (**catapult**). Barracks and range stay simple but carry the upgrades for them, and enemies get these units too.
   - **Towers** buildable from the start and upgradable, with more range and impressive bolts. Placing a tower shows its range.
   - **Archers (rangers)** shoot further, for nice range shootouts.
   - **Enemy battering ram and siege tower:** the tower docks at a wall and lets raiders onto the walkway.
7. The user liked the placing feel ("works great") and the live demo battle behind the menu.

Reference images the user shared are stored in `C:\Users\ArnoV\.t3\userdata\attachments\` (local to their machine):
- AoE4 wall with a walkway and archers: `...-df6c2df9-...png`
- AoE4 gatehouse and river: `...-b974676e-...png`
- Tabletop wall and gate sets: `...-595fca55-...png`, `...-cfc3dd9d-...png`
- Others: `...-9fbeaad8-...png`, `...-8b51d2f0-...png`

---

## 2. How to run / test

- `bun run dev`, then open `/holdfast`. You must be signed in: `start-run` and `finish-run` need auth. Without a session the game falls back to an offline seed and shows a warning.
- `bunx vitest run test/holdfast`: sim, meta, run and leaderboard DB tests, and model tests. DB tests need the compose Postgres and `DATABASE_URL` pointing at localhost.
- `bun scripts/holdfast-balance.ts 6` plays every difficulty with an idle player and three bot strategies, and prints median survival.
  - There is no `balance:holdfast` package script yet; add one next to the other `balance:*` scripts.
- A dev-only console handle exists during a run: `window.__holdfast = { sim, renderer, speed }`.
- **Headless visual harness** (outside the repo, at `C:\Users\ArnoV\hf-audit\`):
  - It uses puppeteer-core with the local Chrome and SwiftShader, so it's slow but accurate.
  - It signs in as the local test user `holdfast-audit@local.test` / `holdfast-audit-pw-1` (created in the **local** DB only).
  - Run `node quick.mjs <outdir> easy|normal|hard [script.js]`. The optional script runs with `page`, `shot(name)` and `wait(ms)` in scope.
  - Useful scripts: `base.js` (builds every building type), `fight2.js` (close-up melee), `lanes.js` (wave route preview), `stress.js` (a 1,000-unit Bloodmoon, with perf numbers), `lobby.mjs <out> all|lobby|end`.
  - The t3 browser-preview MCP host was unavailable in this session, so this harness was used instead.

---

## 3. Architecture

### Shared simulation (`shared/utils/holdfast/`): headless, deterministic
- `config.ts`: **every number**: resources, buildings (sizes, hp per level, costs, compounding `scale`, upgrade costs, production, attacks, keep-level gates), units, upgrades, difficulties (keep position, lanes and their open times, growth), wave timing, Bloodmoon.
- `sim.ts`: `HoldfastSim`. A fixed 20 Hz `step()` driven by the seeded rng (`rng.ts`).
  - Player actions are methods that validate and return `{ ok, reason }`, so the UI greys things out with the same rules. The main ones:
    - `previewBuilding`/`placeBuilding`, `previewSegments`/`placeSegments` (wall and gate lines), `lineCells`
    - `previewDeploy`/`deployPack`, `previewMove`/`movePack`
    - `upgradeBuilding`, `upgradeConnected` (a whole wall run), `repairBuilding`, `sellBuilding`
    - `buyUpgrade`, `reinforcePack`, `disbandPack`, `surrender`
  - The UI and renderer consume the `events` array (`SimEvent`).
  - Starting base: keep, one gold mine, and an octagonal wooden wall ring (`buildStartingWalls`) with gates where roads cross.
  - Walkability:
    - Enemies can't enter structures.
    - Friendlies pass gates; **only archers** may stand on walls (`friendlyWalkable(i, kind)`).
    - Archers dropped near a wall snap onto it (`snapToWall`) and stay there (`wallBound`).
  - `wallFacing(b)` gives each wall's outward direction; the parapet and archer offset use it.
- `grid.ts`: terrain generation (roads from every lane to the keep, tree and rock clumps), a Dijkstra **flow field** to the keep, and A* for friendly moves.
  - Structures cost `2 + hp/22` to path through, so raiders prefer detours to gaps and bash through only when a detour is long.
  - `CORNER_OPEN` forbids cutting diagonally between two blocked cells. This was a real bug: raiders piled up forever at diagonal wall corners.
  - Distances are **Float64**. Float32 rounding made Dijkstra re-expand ~100 million times and cost seconds.
- `bot.ts`: scripted player for balance and tests. `simulateRun()`.
- `meta.ts`: server-shared: difficulties, `HOLDFAST_WIN_MS`, speed cap, plausibility check, stats sanitiser.

### Server
- `holdfast_runs` table (`server/database/schema.ts`, migration `drizzle/0048_dapper_richard_fisk.sql`).
- `server/utils/holdfast.ts` and `server/api/holdfast/`:
  - `start-run` issues a seed.
  - `finish-run` does lock-then-conditional-update, clamps survival time to real elapsed time × 2, and returns best and rank.
  - `leaderboard` gives the best run per user per difficulty.
  - `state` gives the player's bests.
- A mid-run unmount sends `finish-run` via `sendBeacon`.

### Client (`app/utils/holdfast/`, `app/components/holdfast/`)
- `renderer.ts` (`HoldfastRenderer`): three.js scene. It reads the sim and interpolates between ticks. Everything numerous is instanced: units as parts, walls, arrows, bars, rings, ghosts, grass and particles.
  - Ghost previews: building ghost with footprint tiles, wall line, deploy rings plus ghost soldiers, move rings, range ring, gold wall-spot markers for archers.
  - Territory and grid shader, with a red hatch over the unbuildable edge strip.
  - Lane beacons and a Bloodmoon colour shift.
  - Shadow camera follows the view. Adaptive pixel ratio, never below native at dpr 1.
- `camera.ts`: eased RTS rig.
  - Pan with WASD, arrows, drag, or screen edge in fullscreen. Wheel or pinch zooms toward the cursor.
  - Q/E rotate, Space centres the keep.
- `terrain-art.ts`: painted ground canvas, island top, layered cliffs, stylised sea shader. `ISLAND_MARGIN` is the forest rim.
- `post.ts`: EffectComposer with GTAO ambient occlusion (half-res), bloom, tilt-shift, colour grade and OutputPass. It has `setQuality()`, but the **renderer never calls it yet**; see TODO.
- `models.ts`: geometry builders with vertex colours: buildings per level, trees, rocks, decor, unit parts (warrior, archer, **knight parts**), `catapultGeometry`, `ramGeometry`, `siegeTowerGeometry`, `boltGeometry`, `boulderGeometry`, arrows and more.
- `wall-kit.ts`: modular wall pieces.
  - Pieces: hub, straight and diagonal arms with the parapet facing out, towers at corners and ends, stairs, gatehouse.
  - Three tiers: wood, stone, fortified. `WALL_HEIGHT` (the walkway) is 1.35, in `sim.ts`.
- `grass.ts`: instanced grass clumps with a wind vertex shader, hidden under buildings.
- `volley.ts`: two or three cosmetic arrows escort every real arrow, plus motion streaks.
- `remains.ts`: corpses topple and sink, arrows stay stuck, buildings crumble.
- `lane-paths.ts`: red chevrons along the next wave's flow-field route.
- `fx.ts`: pooled particles and ring shockwaves. The renderer has `particles` plus an additive `glow` system for sparks, fire and embers.
- `audio.ts`: fully synthesised Web Audio: sound effects with rate limiting and a voice cap, adaptive music, and ambience (wind, birds, battle din). New sounds were added and some are not yet triggered; see TODO.
- `minimap.ts`, `ui.ts` (toolbar table, resource meta, short names), `format.ts`.
- `HoldfastGame.client.vue` is the orchestrator.
  - Lobby with an **attract mode**: a live bot battle renders behind the menu.
  - Run lifecycle, main loop (`advance()` keeps simulating while the tab is hidden, so there's no pause exploit), input, tools, events to sound, banners, off-screen indicators, income floaters.
  - HUD: top wave clock and keep HP, and a resource strip above the toolbar.
  - Dev handle `window.__holdfast`.
- `HoldfastLobby/End/Leaderboard.vue` are custom dark-glass menus. `HoldfastToolbar/Selection/Cost.vue` are the in-game HUD.
- Registered in the nav (`app/layouts/default.vue`), on the index games list, in global search, and in the changelog (`content/changelog/2026-09-24.md`).

---

## 4. Status at hand-off (2026-09-24)

`bun run typecheck` is clean. `bunx vitest run test/holdfast` passes (43 tests). Full `bun run test` had a single failure: `test/meadowbrawl/full-run.spec.ts`, a pre-existing random-build flake unrelated to Holdfast that passes on rerun.

Five parallel work streams were **stopped mid-task** when the user asked to wrap up.

| Stream | State |
|---|---|
| Sim, AI, mechanics (`shared/utils/holdfast/*`) | **Implemented:** unit kinds `knight`, `catapult`, `ram`, `siegetower`; `unitUnlocked()`; upgrades `knightArmor` and `catapultPayload`; `Arrow.projectile` (`'arrow' \| 'bolt' \| 'boulder'`) with splash; events `bounty`, `wave-cleared`, `streak`, `loot-*`, `rally`, `ram-hit`, `tower-docked`, `impact`; loot carts; rally ability; faster pace; starting ring capped at 2 gates per road crossing. **Balance was not finished; see below.** Re-read `sim.ts` and `config.ts` for the exact API before wiring. |
| Models (`models.ts`) | More detailed buildings and units; knight parts; catapult, ram, siege tower, bolt and boulder geometry. The ram was being trimmed; its test budget was raised to 1,400 tris. |
| Terrain and post (`terrain-art.ts`, `post.ts`) | Richer painted ground, cliffs and sea; GTAO and bloom; colour grade. The class section was being finished. `paintGround` is slow: seconds in SwiftShader, probably 0.3–1 s on real hardware. |
| Walls (`wall-kit.ts` plus `syncSegments` in `renderer.ts`) | Towers, stairs, diagonal pieces and gatehouses exist. It was doing visual QA. |
| HUD (`HoldfastToolbar/Selection/Cost.vue`, HUD markup and style in `HoldfastGame.client.vue`) | New framed command bar, wave clock and resource strip. It was taking screenshots at several resolutions. |

**Latest balance** (`bun scripts/holdfast-balance.ts 4`, median survival): **currently far too hard**. The sim stream was mid-tuning after adding faster pacing and new enemy units.

| Map | Idle | Units only | Balanced bot | Greedy |
|---|---|---|---|---|
| Easy | 2:27 | 12:39 | 10:28 | 10:00 |
| Normal | 2:24 | 7:53 | 10:08 | 8:09 |
| Hard | 2:18 | 4:12 | 6:46 | 4:44 |

Targets:
- Idle player dies around 3–4 min.
- A decent player survives about 15–18 min on Normal, 20+ on Easy and 11–14 on Hard.
- 25:00 is possible but rare on Easy.

The bot also needs to use knights, catapults and towers well.

---

## 5. TODO (prioritised)

### Must do next
1. **Rebalance**, per the targets above. Make the bot play like a decent human first: stone walls, archers on walls, warriors at gates, towers, upgrades, knights and catapults.
2. **Render the new unit kinds.** `syncUnits` in `renderer.ts` only knows warrior vs "everything else", which is drawn as an archer, so the new kinds currently look like archers.
   - Knights: instance the knight parts.
   - Catapults, rams and siege towers are few, so render them as per-unit groups. Animate the catapult arm on `lastAttackAt`, swing the ram's log on a hit, and lower the siege tower's drawbridge by `deploy`, 0..1.
   - Tint cloth parts in the team colour.
3. **Render the new projectiles.** `Arrow.projectile === 'boulder'` should be a spinning `boulderGeometry` on a high arc with a dust and shockwave impact and camera shake on the `impact` event. `'bolt'` should use `boltGeometry`, bigger, with a streak. `volley.ts` escorts should only apply to arrows.
4. **Show the reward events.** They are the user's "dopamine" ask, and the sounds already exist in `audio.ts` (`coin`, `wave-cleared`, `streak`, `loot`, `rally`, `impact`):
   - `bounty`: coins pop from the kill and fly to the gold counter.
   - `wave-cleared`: a big banner and fanfare; "Perfect defence" when applicable.
   - `streak`: an on-screen counter.
   - `loot-spawned` / `loot-collected`: a cart or chest model with a beacon, collected when units walk near it.
   - `rally`: an ability button with a cooldown, plus a horn.
   - `ram-hit` / `tower-docked`: shake, dust and a warning banner ("Siege tower at the north wall!").
5. **Toolbar and UI for the new content.**
   - Add knights and catapults to `TOOLBAR` in `ui.ts`: hotkeys, locked state via `unitUnlocked`, detail cards. Hotkeys need a rethink; numbers are running out.
   - Selection panel support for the new units.
   - Show tower range when placing (this works for any building with `attack`) and in the selection panel. Show the tower upgrade path.
6. **Call `post.setQuality()`** from the renderer's `adaptQuality`: drop AO, then bloom, on slow GPUs. Add a graphics-quality toggle in the HUD.
7. **Performance pass on a real mid-range GPU at 1080p** with ~800 units in the Bloodmoon. Watch AO cost, grass count (`PER_TILE`), shadows at 2048, and the volley arrow count.
8. Move `paintGround` off the main thread (worker or OffscreenCanvas) or cache it, so starting a run doesn't hitch.

### Should do
- Enemy AI polish: packs focus-fire one wall segment; archers target defenders on walls; funnel through breaches; flanking and feints on Hard. Some of this was in progress in the sim stream; verify it.
- Friendly AI: warriors hold gate chokepoints in a line; archers avoid overkill; optional retreat or rally.
- Unit models are now less chibi; check that `UNIT_SCALE` (1.3) in `renderer.ts` still reads well, and check the anchors for sword, shield and bow.
- Gatehouse and wall QA: diagonal runs, gates in diagonal walls, stairs, towers at wall ends; check wall-spot markers line up with the new walkway.
- Onboarding: first-run objective hints ("Build a Lumber Camp", "Put archers on your walls") and a how-to-play refresh for the new units.
- Mobile and touch: the tap-to-preview then confirm flow exists but hasn't been tested on a real device.
- Sound: mixing pass; spatialise more; add unit-specific sounds (knight clank, catapult creak, ram thud, siege-tower rumble).
- Cloud shadows, birds, smoke columns and a day-to-dusk light change toward the Bloodmoon, for atmosphere.

### Later: economy integration (not in scope yet)
- The user wanted a fun game first; no real balances or permanent upgrades yet. `finish-run` is where coin rewards would go later, following the CLAUDE.md concurrency rules.

---

## 6. Gotchas and decisions

- **Remote DB migration.** During development, an agent ran `bun run db:migrate` while `.env` pointed at a remote database (`161.97.132.99:4528`). It applied `0048_dapper_richard_fisk.sql` (a new `holdfast_runs` table plus indexes) there. It only adds things. **Decide whether to keep it or drop it**; migration numbering on that DB now includes 0048. `.env` currently points at localhost.
- `.tmp/` in the repo root is scratch (dev log, edit scripts, debug scripts). It is not committed and is safe to delete.
- Other scratch outside the repo:
  - `C:\Users\ArnoV\hf-audit` (the harness and screenshots).
  - `C:\Users\ArnoV\hf-audit\backup-menu` (pre-redesign copies of the menu components).
  - The models agent's preview in `.tmp/hf-preview/`.
- Randomness: the sim uses its own seeded rng on purpose (deterministic replays and balance runs; Holdfast pays nothing). Cosmetic effects use `Math.random()`. The server seed comes from `randomInt`.
- The sim is deliberately free of three.js, so the balance script and tests run in plain Bun.
- The flow field recomputes only when structures change (`flowDirty`). Keep it that way for performance.
- The renderer only reads the sim and never mutates it. All player actions go through sim methods that return `{ ok, reason }`.
