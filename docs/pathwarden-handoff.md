# Pathwarden handoff

Last updated: 2026-07-27

## Current objective

Continue improving Pathwarden’s visual quality and game behavior, using Rogue Tower as visual inspiration and Playwright screenshots for every geometry-sensitive change.

The current objective is a human-style ten-round play-and-polish loop: placement
must agree with what the board communicates, progression must remain clear, and
screenshots must be rejected for any obvious anchoring, road, fog, or combat
artifact.

## Room world and active-run persistence

The room-world branch now precomputes the complete Realm map as a versioned,
seeded plan. Room footprints, road links, terrain features, buildable cells,
frontiers, enemy routes, and revealed geometry all derive from that plan.
Runtime expansion only claims existing connections; it does not generate or
repair geometry.

The room grammar includes compact straights, corners, U-bends, switchbacks,
T-junctions, crossroads, road islands, bridges, mountain passes, valleys,
lakeshores, and forest roads. The required main route deliberately introduces
junction rooms while optional branches persist as additional future routes.
Room placement is retried as a whole when graph validation fails.

An active run is created when the player calls wave 1. The database stores the
immutable map plan separately from revisioned engine state, with one active run
per player. Autosaves use optimistic revisions; a stale tab stops saving after
a conflict instead of overwriting newer progress. Navigation preserves the
run, reload restores exact combat and strategic state, and settlement removes
the active run atomically.

Paid abandonment is available only after a run has started and only in
strategic phases. The server rejects abandonment during combat, debits Gems or
the current Coin quote transactionally, removes the active run in the same
transaction, and refreshes the client session afterward.

## Work completed

Primary implementation:

- `app/utils/pathwarden-engine.ts`
- `app/components/games/PathwardenGame.client.vue`

Visual QA checklist:

- `docs/pathwarden-visual-qa.md`

Implemented game features include:

- Isometric terrain and road rendering.
- Persistent road exits with mist boundaries.
- Multi-exit enemy spawning with individual routes to the castle.
- Edge-scroll camera with content-derived bounds.
- Camera-aware placement, dragging, projectiles, and hit testing.
- Direct expansion-marker hit testing.
- Gold hover state on expansion markers without an underlying hover diamond.
- Drag-to-move and drag-to-fuse towers.
- Building statistics and salvage.
- Animated enemies, projectiles, ambient actors, patrols, peddlers, birds, cats, and construction crews.
- Construction crews use weighted grid pathfinding, prefer roads, avoid towers/scenery, and participate in painter-depth ordering.
- Placement blocking now follows only visible facts: current roads, scenery,
  occupied cells, the castle silhouette, and active/immediate frontier
  clearance. Hidden future plans do not make empty grass mysteriously reject a
  build.
- Tower pointer hit testing uses the lower 58% of the sprite, preventing tall
  artwork from stealing clicks on neighboring empty tiles.
- Selected-building statistics are in the sidebar rather than over the board.
- Frontier choices are automatically framed after each wave.
- Repeated tower copies use escalating Aether costs. Each tower records actual
  investment, fusion combines investment, and dismantling returns 50%.
- The old full-width wave overlay is now a compact 1.4-second top ribbon.
- Adversarial interaction hardening prevents construction-inflation resets via
  fusion or salvage, duplicate wave starts, combat dismantling, and enemies
  moving behind the open Reliquary.
- Relic ranks are capped to prevent exponential single-stat stacking.
- Fused level-two and level-three defenses now retain useful power instead of
  being dramatically weaker than their component towers.
- Every permanent mist mouth remains an enemy spawn route after expansion round
  seven. Wave intelligence uses the exact same route set.
- Added persistent local Realm progression with five difficulty tiers. Clearing
  all 12 waves unlocks the next Realm; enemy health, speed, bounty, and score
  scale with Realm.
- Added per-defense First, Strong, and Fast target priorities, next-wave enemy
  and exit intelligence, and flawless-wave score challenges.
- Fixed checkpoint/flawless callouts to stay in screen space while the camera is
  panned.

## Fixed expansion plan

The latest work replaced runtime road generation with an initialization-time plan:

- `plannedSections` stores immutable precomputed road sections.
- `claimedSections` tracks selected sections.
- `precalculateExpansionPlan(7)` runs in the engine constructor.
- `activatePlannedChoices(source)` exposes preplanned children.
- `refreshChoiceAnchors()` updates marker locations without changing road geometry.
- `extendPath()` commits an existing planned section and never regenerates it.
- All planned cells are reserved against tower placement.
- Old on-the-fly `createPathChoices()` and `extendChoicesIntoMist()` methods were removed.
- Development bridge action `claimFrontier` was added for seven-round plan testing.

The seven-round automated test succeeded:

- At least seven sections were preplanned.
- Planned cells did not overlap.
- Seven sections were claimed successfully.
- The serialized plan was unchanged after all seven claims.

Latest seven-round screenshot:

- `/tmp/pathwarden-seven-round-plan.png`

The screenshot still contains transient relic-selection particles/range circles because it was taken immediately after the seventh relic choice. Capture a clean delayed screenshot next time.

## Sun Mortar changes

The mortar weapon was rebuilt in `drawTowerWeapon()`:

- Weapon anchor moved higher to the roof center.
- Centered raised turntable.
- Visible cylindrical base.
- Raised trunnions.
- Elevated barrel drawn in screen space.
- Barrel highlight and dark muzzle opening.
- Recoil moves only the barrel, not the turntable.

This code passes ESLint and Nuxt type checking, but the final multi-angle Playwright visual inspection was interrupted before completion.

## Ten-round audit

The latest full Playwright run completed wave 10 with real canvas/DOM clicks:

- no console errors or script observations;
- every intended placement succeeded, including the formerly blocked tile next
  to a tall Winter Spire;
- all seven planned road sections were claimed;
- `roadValidation.valid` remained true;
- every frontier marker activated on the first click;
- lives remained intact with a varied 18-tower build.

The later adversarial suite additionally completed:

- a funded exploit-oriented ten-wave Realm 1 run;
- a funded ten-wave Realm 2 run after engagement changes;
- a ten-wave Realm 2 run verifying all three permanent exits;
- two unfunded human-style ten-wave Realm 1 runs after the final spawn and
  callout fixes.

The final unfunded run ended at wave 10 with 25 hearts, 16 defenses, 800 Aether,
10 flawless waves, three observed permanent exits, no console errors, no test
observations, and a valid road graph.

Milestone captures are `/tmp/pathwarden-r1-planning.png` through
`/tmp/pathwarden-r10-combat.png`, plus
`/tmp/pathwarden-after-ten-rounds.png`. The round-10 frames show continuous
roads, concealed mist endpoints, centered tower bases and weapons, visible
mortar arcs, and the compact wave ribbon.

## Validation status

Final room-world verification passed under resource-limited cgroups:

- Focused ESLint and Nuxt typecheck.
- Twelve room-template/map-plan tests, including the 1,000-world deterministic
  corpus and every supported room transform.
- Four expanded visual seeds with valid graphs, compact room progression,
  persistent exits, bridges, road islands, T-junctions, and crossroads.
- Original-resolution desktop and responsive captures, pointer zoom,
  progressive edge scrolling, and first-click expansion after pan and zoom.
- A live three-wave run after the room/persistence changes with 20/20 keep
  health, ordinary wave/relic controls, and a valid graph. The established
  ten-wave ordinary and adversarial combat audits remain valid because the
  branch does not change tower combat mechanics.
- Exact save/reload and navigation restoration, two-writer optimistic locking,
  a full Nuxt server restart, and queued offline-save recovery.
- Successful Coin and Gem abandonment with exact debit and atomic run removal;
  combat abandonment rejection; capped checkpoint cash-out; zero-reward defeat;
  timed victory settlement and Realm unlock.
- Unsupported save-version fixture rejection.

The durable `pathwarden-room-world-generation` plan is complete.

## Important visual invariants

- A road’s geometry never changes after initialization.
- Selecting one expansion cannot remove, reroute, cover, or disconnect another.
- Active roads remain visible over revealed terrain.
- Road junctions have no exposed caps, seams, grass wedges, or doubled borders.
- Mist endpoints terminate at the terrain boundary and are concealed by fog.
- Buildings use their tile center as the ground contact point.
- Roof weapons pivot at the roof center.
- Ambient actors and enemies follow navigated routes rather than straight-line shortcuts.
- Procedural systems must be inspected across multiple randomized layouts.

## Working tree

The room-world implementation is committed on
`feature/pathwarden-room-world-generation`. Playwright output and standalone QA
captures are intentionally untracked; preserve them unless the user asks to
remove them.
# 2026-07-25 visual inspection framework

- Pathwarden now has a development-only `toggleVisualGuides` bridge action.
  It overlays shared renderer geometry: tile center, building ground contact,
  weapon pivot, muzzle, sprite bounds, planned road graph, and predicted mortar
  trajectory.
- `getDebugState()` exposes `roadValidation`, tower geometry, and live projectile
  arc metrics. QA should fail when `roadValidation.valid` is false or a mortar
  at mid-flight is not visibly above its straight origin-to-target line.
- Seven-round road plans are regenerated until they satisfy graph invariants:
  connected parentage, no overlap, strictly outward cells, and no side adjacency
  to unrelated roads. This rejects the observed hairpin/U-turn and overwritten
  neighbour-road cases before play starts.
- Sun Mortar projectiles now spawn at the same computed muzzle used by the
  renderer and travel along a timed ballistic arc.
- Static verification passed: ESLint and Nuxt typecheck.
- Browser automation was rerun successfully after visual-inspection permission
  was granted: four randomized layouts, two centered Sun Mortars, live combat,
  and seven sequential expansions passed. The measured mortar was 71–80 px
  above its linear origin-to-target path in the sampled mid-flight frames.
- Future expansion endpoints now reserve a one-tile clearance ring against
  building, dragging, and scenery. The keep has a two-cell construction buffer.
- Exhausted terminal roads receive the same seamless road-to-mist continuation
  as active frontier exits instead of exposing a flat beige cut.

# 2026-07-25 buildability, perimeter fog, and Reliquary

- Future road centerlines remain reserved, but construction-clearance rings now
  cover only active frontier sections and their immediate children. Browser QA
  reports 15 legal starting cells and successfully placed three towers.
- Castle blocking uses its projected screen silhouette plus a one-cell gate
  apron instead of consuming a blunt 5×5 square.
- Every revealed terrain boundary now receives fog, not only road mouths.
- Added six persistent Pathwarden boosts bought with global Coins or Gems:
  Bulwark, Artificer, Mistglass Lens, Aether Reservoir, Banner of Resolve, and
  Verdant Bounty. Purchases are transactional and row-locked.
- Generated the transparent low-poly boost sheet at
  `public/games/pathwarden/boosts.png` using the built-in image generator and
  local chroma-key removal.
- Browser QA passed: 15 buildable cells, three placed towers, six rendered
  boosts, valid road plan, and no runtime errors.
