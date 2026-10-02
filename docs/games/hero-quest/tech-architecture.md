# Tech & Data Architecture

Status: **Locked** — decisions confirmed, ready to reference for implementation planning. Structure and integration path confirmed against the polynux platform doc (`idle-game-architecture.md`, 2026-08-01) and `package.json` v1.2.0. All three flagged design consequences are resolved: Manual mode removed (§9.2), Battle Speed scoped to wave-grinding + bosses/Raids but not Arena (§9.3), and Gold decoupled from the exponential curve via `gold-economy.md` (§9.1). Cross-doc edit lists for all three are below. **Arena, previously anticipated-but-undesigned (§4d), is now fully resolved — see `arena.md` (Locked); schema (§3) and API surface (§5) updated to match.**

**The game's real name is Hero Quest.** Code-level naming convention, applied throughout this doc: **`hq`** as the short prefix for database tables and shop-style identifiers (`hqState`, `hqCollection`, …), and **`hero-quest`** (kebab-case) for directories, routes, and file names (`shared/utils/hero-quest/`, `server/api/hero-quest/`). This mirrors the platform's existing convention of a short code alongside other verticals' `xeno`/`colony` namespacing. *(If a different prefix is preferred — e.g. spelling out `heroQuest` in full — every occurrence below is a mechanical find-replace on `hq`/`hero-quest`, nothing structural depends on the specific string chosen.)*

## Structure recap

- Hero Quest integrates into **polynux** as an **idle-game vertical slice** — own tables, own `server/api/hero-quest/` namespace, own composable, never touching `GAMES_REGISTRY`. Nuxt 4 + Vue + Bun + Postgres/Drizzle + vitest, all inherited.
- **Server-authoritative — locked per your call.** Gold and Gems are shared balances across all polynux games, so the server never trusts client-claimed earnings or outcomes. All combat resolution (farming, bosses, Arena) happens server-side; the client renders animation driven by shared, deterministic sim code.
- **Lazy settle, no background workers** — the platform's core idle mechanic (`settleColony` pattern) maps directly onto the rate-based snapshot offline calc already locked in `idle-mechanics.md` §4. One settle function serves both "offline" and "online" accrual (Section 4).
- **Arena is anticipated in the schema from day one** (defense loadout as a separately-readable field, seeded-replay fight resolution) even though its full design doc comes later.

---

## 1. Integration Path — Idle-Game Vertical Slice

Follows the platform doc's slice layout exactly:

| Layer | Location | Contents |
|---|---|---|
| Pure logic | `shared/utils/hero-quest/` | Content modules, constants registry, stat pipeline, combat/settle math (Section 2) |
| Tables | `server/database/schema.ts` | `hqState` + child tables (Section 3) |
| Domain | `server/utils/hero-quest.ts` | `getHqState`, `ensureHqState`, `settleHq`, serializers |
| API | `server/api/hero-quest/` | `state.get.ts`, `init.post.ts`, mutations per subsystem (Section 5) |
| Composable | `app/composables/useHeroQuest.ts` | One `useFetch` + `call` helper, per convention |
| Pages | `app/pages/hero-quest/` + `app/components/hero-quest/` | Tab-per-page, Canvas 2D battle stage as an extracted component (Section 7) |

Cross-cutting registration checklist (nav `idleGameItems`, platform leaderboard aggregate, AI guard/tools/executors, landing card, changelog, `test/hero-quest/`) is inherited verbatim from the platform doc — no Hero-Quest-specific deviation. Proposed leaderboard aggregates: **prestige count**, **Global Power Number** (Section 8), and **total gacha levels** (sum across all 4 gachas) — same "a few progression scalars" spirit as Colony's `habitatLevel` + research sum.

Per the platform doc's scaffolding order, the schema's settle contract gets documented in a block comment above `hqState`, same as Colony's.

---

## 2. Shared Logic — `shared/utils/hero-quest/`

Directory from day one (this game is Xeno-sized or bigger, not Colony-sized). Rules inherited: no DB access, no auth, no `#server` imports, runs in the browser, 4-space indent, no semicolons. Both sides import it — the client renders costs and animations without round-trips, the server stays sole authority on applying anything.

```
shared/utils/hero-quest/
  constants.ts        — the tuning registry: every named constant from every design doc
  content/
    classes.ts        — 16 class nodes, stat spreads, skill definitions
    gear.ts           — 36 Forge pieces (6 slots × 6 rarities), slot→stat map
    champions.ts      — 48 Champions, 28-ability pool, archetype tables
    skills.ts         — 36 Training Grounds skills
    artifacts.ts      — 48 Artifacts, 33-effect pool
    traits.ts         — 8 stats × 9 grades value tables, 5 Sets, grade weights
    worlds.ts         — 10 worlds × stage definitions, enemy rosters
    raids.ts          — 5 raids, fight types, per-raid curve constants
    holidays.ts       — holiday calendar (fixed dates + Lunar New Year lookup), gift bundles
    arena.ts          — Arena Shop price list, season length, rank-reward table
    gacha.ts          — drop-rate table, level thresholds, dupe/craft tables
    shop.ts           — prestige-shop tracks (costs, caps, levels)
  stats.ts            — the stat pipeline: (content, playerState) → final party stats
                        // 6 stats, identical for Hero and Champions: PWR/SPD/LCK/IMP/VIT/DEF (+HP, +EVA)
  combat.ts           — damage/mitigation/crit/evasion formulas, DPS derivation
  settle.ts           — rate-based accrual math (kills, Gold, XP, stage advancement)
  fight.ts            — seeded tick-simulation for boss & Arena fights (Section 4)
  numbers.ts          — break_eternity wrappers, string (de)serialization, display formatting
```

**As built (2026-09-15)** the directory also holds `status.ts` (the status registry), `effects.ts` (ability effect descriptors), `modifiers.ts` (the one passive-modifier vocabulary for Gear/Skills/Artifacts), `projection.ts` (abilities averaged into the idle rate), `gacha.ts` and **`explain.ts`** — which re-walks the stat pipeline and records each step, pricing every source in stages of enemy curve. Both the sim's `--report=stats` and the in-game stat panel render it, so the two can never describe the pipeline differently. `traits.ts`, `raids.ts`, `holidays.ts` and `arena.ts` are Phase 4 and do not exist yet. Two client-only pure modules sit in `app/utils/`: `hero-quest-battle.ts` (the battle-screen projection, §7) and `hero-quest-auto-boss.ts` (§4b).

**Content format: TypeScript const modules — closed** (was the last open fork). No external pipeline exists, the repo is fully typed, and Claude Code edits TS directly; `nuxt typecheck` becomes half the content validation for free. Every entity gets a **stable string ID** (`champ_kaira`, `skill_coin_toss`, `world_the_void`); DB rows and loadouts reference IDs only, never indices.

**Constants registry:** every "tunable starting point" across the design docs lives in `constants.ts` as a named export — `ENEMY_PRESTIGE_BASE = 5`, `K`, `critChancePerPoint`, `MAX_EVASION`, `BASE_KILL_COUNT`, `DUPE_GOLDEN = 1.618`, Battle Speed price anchors, shop cost bases, `BASE_OFFLINE_EFFICIENCY`, all of it. Nothing numeric hardcoded at call sites. This is what makes the balance scripts (Section 6) and playtest tuning one-file edits.

**Invariant tests, not boot asserts:** the design docs' structural invariants (each drop-rate row sums to 100%, ability reuse ≤ 3 per archetype, effect-line count matches rarity, every loadout-referenced ID exists) run as vitest specs in `test/hero-quest/content.spec.ts`. They fail in CI at authoring time — strictly better than failing at boot.

**Big numbers:** `break_eternity.js` (new dependency — the only one this game adds). All combat-scale values (enemy multipliers, stats, damage, HP) are Decimal-typed end to end through `stats.ts`/`combat.ts`/`settle.ts`. Persisted as **`text` columns** — Postgres `numeric` cannot represent `5^1000`, and there's no reason to try when the DB never does math on these values; all math happens in TS. **Void Shards is also `text`/Decimal**, not a plain integer as originally assumed — its `100 × 2^prestige` payout overflows a 64-bit bigint around prestige ~56, which an infinite-prestige game will reach. Safely plain integers: gacha levels, star/level, slot counts, shop levels, prestige count, Seal/Essence balances. **Gold lives on the shared `user.balance` (`numeric(19,4)`, ~10¹⁵ ceiling) and is intentionally kept off the exponential curve — see `gold-economy.md` (Locked), resolving what was flag §9.1.**

---

## 3. Database Schema — `server/database/schema.ts`

Every table `hq`-prefixed, every table keyed on `userId` with an explicit index, per convention.

**`hqState`** — the singleton row per user. Holds the settle clock and all scalar progression:

| Column group | Fields |
|---|---|
| Settle | `lastSettledAt` (the settle clock), **`createdAt`** (account age for the Gold tenure ceiling, `gold-economy.md` §3a — written once, never updated), `speedBoostMultiplier` + `speedBoostExpiresAt` (Battle Speed window, Section 4 — **Phase 4, not yet in the schema**) |
| Run position | `prestige`, `world`, `stage`, `killCount` (whole kills within current stage), **`killFraction`** (double, `[0, 1)` — the part-kill a settle could not bank, carried into the next window, `idle-mechanics.md` §4), `atBossGate` (parked at an unengaged Stage 5/10), `runCleared` |
| Hero | `heroNodeId`, `heroLevel`, `heroXp` (text/Decimal), `seenNodeIds` (jsonb string array, 16 max) — no Auto/Manual field: **Manual mode is removed from the game entirely** (see §9.2). **`heroLevel`/`heroXp` persist across prestige** (`core-progression-and-prestige.md` §3, revised) — the text/Decimal typing on `heroXp` was already correct and is now load-bearing, since XP accumulates forever rather than resetting each run |
| Gacha (×4) | **As built:** `gachaLevels` and `gachaProgress`, each a jsonb map keyed by `system`, rather than eight columns. Free pulls (session-1 playtest): `freePullsUsedToday` (per-system jsonb), `freePullDate`, `freePullClaimedAt` (per-system jsonb) |
| Currencies (custom) | `voidShards` (**text/Decimal** — `2^prestige` overflows bigint); pull currencies `forgeSeals`/`guildSeals`/`skillSeals`/`excavationSeals`; crafting currencies `gearEssence`/`championEssence`/`skillEssence`/`artifactEssence`; `traitGems` (`traits.md`, `economy-and-currencies.md` §8) — all integer. Raid Keys live on `hqRaidState`; Arena Medals below. Gold/Gems stay in the shared user balance and are only touched via `server/utils/balance.ts` |
| Loadout | `partyChampionIds`, `equippedSkillIds`, `equippedArtifactIds`, `equippedGear` (jsonb — slot → itemId, `gear-equipment.md` §3), `formation` (jsonb — slot → row assignments) |
| Arena — see `arena.md` (Locked) | `defenseLoadout` (jsonb: champion IDs + skill IDs + artifact IDs + **equipped Gear** + formation — corrected to match `loadouts.md` §1's full 5-component capture, snapshotted separately from the live loadout so attack/defense diverge by design, `arena.md` §1), `defenseGpn` (text/Decimal, denormalized, recomputed only when `defenseLoadout` is saved — not on every settle, since it's static between edits, `arena.md` §2), `arenaRating` (numeric, default 1000, floor 0, indexed for leaderboard reads, `arena.md` §4), `arenaMedals` (integer balance, persists across prestige and season resets, `arena.md` §5/§7), `arenaAttemptsUsedToday`/`arenaExtraAttemptsPurchasedToday`/`arenaAttemptDate` (daily non-banking reset, mirrors the Seal-ladder pattern below, `arena.md` §3), `currentSeasonId`/`seasonStartedAt` (2-week cadence, `arena.md` §7), `globalPowerNumber` (text/Decimal, denormalized for leaderboard reads — recomputed on every settle) |
| Seal grants | ~~`lastSealGrantAt`~~ (the daily free time-gated grant — **column dropped 2026-09-16**, `open-items.md` #29); `sealLadderPurchasedToday` **as a per-gacha jsonb map** (`{gear, champion, skill, artifact} → count`) + `sealLadderDate` (the Gold-purchase daily ladder, `gold-economy.md` §7 — four independent counters, one shared reset date) |

**`hqCollection`** — one table for all **four** gachas rather than four structurally identical ones, since the shared-gacha doc makes them deliberately parallel:

```
(userId, system ['gear'|'champion'|'skill'|'artifact'], contentId, star, level, dupeProgress)
unique on (userId, system, contentId), index on userId
```

Rows are counters-plus-progression keyed on `(userId, …, contentId)` — the platform's `colony_items_unique` pattern.

**Locked: single table.** `contentId` stays an unconstrained string rather than a foreign key — it's validated at the application layer against whichever `content/*.ts` module `system` points to, since the four systems' content lives in separate modules (`content/gear.ts`, `content/champions.ts`, …) rather than a single content table. `applyDupe()`, `levelUp()`, and `craft()` are each written once against `(userId, system, contentId)` and called with a `system` argument, rather than duplicated per gacha — the whole point of keeping this single, given `gacha-shared-system.md` locks one dupe formula and one leveling curve for all four.

**`hqShopUpgrades`** — `(userId, upgradeId, level)`, unique on `(userId, upgradeId)`. Covers **every** purchasable track in the game regardless of which currency pays for it — no new table needed for any of them, just more `upgradeId` values:

| Track | Levels | Currency |
|---|---|---|
| Champion / Skill / Artifact slots (2→5) | 3 each, 9 total | Void Shards |
| Offline Efficiency (50→100%) | 5 | Void Shards |
| Offline Cap (8→72h) | 32 | Void Shards |
| Kill-count reduction, boss-timer extension | TBD | Void Shards |
| Raid Key daily-grant rate, one track per raid | 5 tracks | Void Shards |
| `loadoutSlots` (2→10) | 8 | **Gems** (`loadouts.md` §3) |
| `traitSaveSlots` (1→4) | 3 | **Gems** (`traits.md` §6) |

Gear has **no** slot track — all 6 Forge slots are available from account start (`gear-equipment.md` §1).

**`hqRaidState`** — one row per `(userId, raidId)`, covering all 5 raids uniformly (`raid-system.md`, Locked):

```
(userId, raidId ['guild'|'trainingGrounds'|'digSite'|'forge'|'trait'], highestLevelCleared, keyBalance, lastKeyGrantAt)
unique on (userId, raidId), index on userId
```

- `highestLevelCleared` — plain integer, safe as a counter (unlike `raidDifficulty`'s *output*, the level number itself never needs Decimal treatment — only the resulting stat value does, and that's computed on demand, not stored). For `raidId = 'trait'` — the only `rampaging_boss` raid — this same column doubles as best-level-reached; no special-casing needed, `raid-system.md` §7 already defines that raid's "level" as its best-ever result.
- `keyBalance` — integer. `lastKeyGrantAt` — the time-gated-grant pattern `hqState.lastSealGrantAt` used to implement (that column is gone, `open-items.md` #29; the pattern is still the one to copy for Keys): elapsed days since last grant computed and applied (capped at the per-raid bank cap, 21 baseline) lazily at read/claim time, no cron.
- Raid-clear rewards (Seals or Trait Gems) write straight into the existing per-currency balances (`hqState.guildSeals` etc., `economy-and-currencies.md` §9) — this table only tracks raid-specific progress and Keys, no duplicate reward-side schema.

**`hqLoadouts`** — saved Loadout presets (`loadouts.md` §1, §3), one row per saved slot:

```
(userId, slotIndex, name, partyChampionIds, formation, equippedSkillIds, equippedArtifactIds, equippedGear)
unique on (userId, slotIndex), index on userId
```

Same column shape as `hqState`'s live Loadout group, just per-slot instead of singular. Slot *count* needs no schema — it reads `hqShopUpgrades` at `upgradeId = 'loadoutSlots'`. Two small additions to `hqState` go with it: `raidLoadoutPreferences` (jsonb, **5-entry** map `raidId → slotIndex`, one per raid including `trait`) and `preRaidSnapshot` (jsonb, transient — holds the live state to restore on raid exit, `loadouts.md` §4).

**`hqTraitSlots`** — the 5 live trait slots (`traits.md` §1–2), fixed count, no unlock track:

```
(userId, slotIndex [0..4], stat, grade, setId, locked)
unique on (userId, slotIndex), index on userId
```

`stat` is one of 8, `grade` one of F..SSS, `setId` one of 5 — all content-enum strings, values resolved from `content/traits.ts` at read time rather than stored (so a tuning change to a grade's magnitude doesn't need a migration). `locked` is the free/unlimited protect-from-reroll flag.

**`hqTraitSaveSlots`** — stored trait boards (`traits.md` §6):

```
(userId, saveSlotIndex [0..3], name, snapshot jsonb)
unique on (userId, saveSlotIndex), index on userId
```

Slot count reads `hqShopUpgrades` at `upgradeId = 'traitSaveSlots'` (Gems-priced, 1→4). Store and load each cost 100 Trait Gems, debited from `hqState.traitGems` — both are claim-then-reward mutations like any other spend.

**`hqHolidayClaims`** — one row per claimed holiday gift (`holiday-events.md` §2):

```
(userId, holidayId, year, claimedAt)
unique on (userId, holidayId, year), index on userId
```

The unique constraint **is** the once-per-holiday-per-year enforcement — an insert conflict is the rejection, no read-then-check race. Claim windows are resolved in UTC against `content/holidays.ts` (which carries fixed `MM-DD` dates plus the Lunar New Year lookup table); no retroactive catch-up means a closed window simply never becomes claimable, requiring no stored state of its own.

**`hqFights`** — resolved boss/Arena fight log: `(id, userId, kind ['boss'|'arena'], seed, contextJson, outcome, resolvedAt)`, index on userId. Exists for three reasons: the client fetches seed + context to replay the animation (Section 4), Arena needs an attack history/anti-abuse record, and it's a free audit trail for the shared-economy trust model.

**`hqArenaLog`** — the player-facing Arena battle log (`arena.md` §8), a separate concern from `hqFights` above (that one's for replay/audit; this one's for the UI history list):

```
(userId, opponentUserId, role ['attacker'|'defender'], won, ratingChange, medalsEarned, isDummy, createdAt)
index on userId, capped/pruned to the last 20 rows per user at write time
```

`opponentUserId` is nullable for Training Dummy entries (`isDummy = true`, `arena.md` §2a) — a dummy fight only ever writes the attacker-side row, since there's no real opponent to log a defender-side entry against.

**`hqArenaLeaderboard` — no new table needed.** Rank queries read `hqState.arenaRating` directly (indexed, per §3 above), same denormalized-column pattern as the GPN leaderboard (Section 1) rather than a separate materialized ranking table.

**Prestige reset** is a domain-layer function, not schema: **it zeroes the run-position group only** — `world`, `stage`, `killCount`, `atBossGate`, plus any run-scoped buffs — per the locked persistence table (`core-progression-and-prestige.md` §3, revised). **`heroLevel` and `heroXp` are explicitly NOT reset** (Hero level persists across prestige and across class switches), and neither is `heroNodeId`/`seenNodeIds` beyond the player's own class pick at the prestige screen. Everything else — collections, currencies, shop, gacha levels, raid state, arena state, loadouts, traits — survives by simply not being written. In practice the reset writes four columns and increments `prestige`.

---

## 4. Server Authority Model — Settle, Bosses, Arena

### 4a. `settleHq` — the lazy settle

Direct instantiation of the `settleColony` contract: **no cron, no interval, no background worker.** Called from `state.get.ts` and from every mutation that depends on accrued progress.

1. Open `db.transaction`; `onConflictDoNothing()` insert then `select … for('update')` on the `hqState` row — the row lock is the mutex; concurrent settles cannot double-pay.
2. `elapsedMs = now - lastSettledAt`; early-return if `≤ 0`.
3. Apply the **Battle Speed window** where it's in scope — wave-stage kill-count accrual (regular waves 1–4, elite waves 6–9) and, when live, boss/super-boss engagement (Section 4c) — never Arena (overlap of `[lastSettledAt, now]` with `[…, speedBoostExpiresAt]` × multiplier, online and offline alike for wave accrual, see below), then classify the chunk as **online or offline** to apply offline efficiency and the offline cap where due.
4. Run `shared/utils/hero-quest/settle.ts`: party DPS from the stat pipeline → `secondsPerKill` at the current stage → kills accrued → stage advancement through wave stages → **stop at boss gates** (Stage 5/10 never auto-resolves; surplus redirects to re-farming Stage 4/9, exactly per `idle-mechanics.md` §5, including the parked-at-boss retroactive case).
5. Credit Gold/XP via `server/utils/balance.ts` (`credit(…, 'hero-quest', tx)`) with the tx passed while the lock is held — never `user.balance` directly. Write new `lastSettledAt`, `killCount`, **`killFraction`** (the carried part-kill), stage position.

**As built, two inputs are derived here rather than stored:** account age (`tenureDaysOf(state)` = `lastSettledAt − createdAt`, in days, taken at the window's start) feeds Gold's tenure ceiling, and the `killFraction` read from the row goes in as `SettleInput.killFraction`. `settleHq` also returns the shop levels and collections it read under the lock, so `state.get.ts` and `stats.get.ts` reuse them instead of querying twice.

⚠ **The database connection is pinned to UTC** (`server/database/index.ts`, `-c timezone=UTC`). Every timestamp here is `timestamp without time zone`; Postgres writes a `defaultNow()` column in the session's time zone while the driver reads naive values back as UTC. On a non-UTC machine a freshly founded `hq_state` row read back with its settle clock *in the future*, every settle took the `elapsedMs ≤ 0` early return before writing, and a new run accrued nothing for exactly the UTC offset while the client's projection walked forward and snapped back on every refresh. Do not drop the pin.

The settle math is a **pure function** in `shared/` — `(stateSnapshot, content, elapsedEffectiveSeconds) → {kills, gold, xp, landingStage, remainder}` — deterministic (crit averaged, per the locked idle doc), so `test/hero-quest/settle.spec.ts` asserts exact outputs for known snapshots, and the client can run the identical function locally to animate accrual between server refreshes without ever being trusted.

### 4b. Online vs offline — the presence threshold, and Battle Speed's scope

Lazy settle erases the app-open/app-closed distinction that offline efficiency (50–100%) and the offline cap depend on. Restored with one rule:

- The open client refreshes state on an interval (piggybacking the composable's existing refresh; ~60s).
- **Per settle: `elapsedMs ≤ ONLINE_THRESHOLD_MS` (constant, ~2–3× the refresh interval) → online chunk** at full rate. **Longer gap → offline chunk** — offline efficiency and offline cap apply.

Presence is *demonstrated* by the request pattern, not asserted by the client. Cost: a closed app is indistinguishable from a dead network, which is the correct failure direction (degrades to offline rules, never inflates).

**Automatic boss engagement (2026-08-18).** The client calls `boss/engage.post.ts` on its own while `document.visibilityState` reads `visible` (`useHqAutoBoss`, decision logic pure and specced in `app/utils/hero-quest-auto-boss.ts`). Nothing server-side changed for it: the route still settles, re-checks the position under the row lock (`resolveBossEngage`) and rejects anything not parked at a gate — or parked at the final gate of an already-cleared run, where a win does not move the run and the gate check alone would allow endless re-fights. What changed is that **the 400 "not at a boss gate" is now a routine response** — the client projects kills fractionally and the settle floors them, so it can arrive a beat early. The client waits `AUTO_ENGAGE_GRACE_KILLS` (one kill, clamped to 1–10s) to make that rare and retries after `AUTO_ENGAGE_RETRY_SECONDS` to make it harmless. **Do not soften that rejection** — it is the check that stops a client's optimism from moving the run. A hidden tab never engages, so bosses still require presence (`idle-mechanics.md` §2, §5).

**Battle Speed — revised once more per your latest call.** The purchased window is pure wall-clock (`speedBoostExpiresAt`) and applies everywhere **except Arena**:

- **In scope:** wave-stage kill-count accrual (Stage 1–4, 6–9) — online and offline, unchanged from before — **and boss/super-boss fights (Stage 5, 10)**, live only, since bosses never resolve offline regardless. **Once Raids exist, they're in scope too** (Section 4c note below).
- **Out of scope: Arena only.**

**Two different mechanisms depending on what's being boosted, worth being explicit about since they behave differently:**

- **Wave-grinding:** the multiplier changes real economic throughput — genuinely more kills, and therefore more Gold/XP, per unit of real time, online or offline. This is the "afk grinding" case and the one with actual reward consequences, which is why the offline-efficiency interaction below matters for it specifically.
- **Boss/super-boss fights:** the fight is a deterministic seeded sim of a *fixed* 30 sim-second duration (Section 4c) — an active boost doesn't change how much combat happens or the outcome, only how fast the client plays it back. Under 10x, that 30-second timer resolves in 3 real seconds on screen; under 1x (no boost), it plays at full length. **This makes boss fights economically inert to Battle Speed** — no reward scales with it, it purely saves the player's real-world watch time. Worth knowing going in: this is a materially different value proposition for the same currency than the wave-grinding case, and probably worth different in-game framing ("watch it faster" vs. "earn more").

**Online**, wave-grinding's kill-rate ticks faster on the dilated clock, and an engaged boss fight's client animation compresses. **Offline**, the settle multiplies the boosted overlap's effective seconds *within the wave-farming portion* of elapsed time before efficiency is applied — bosses still never engage offline (`idle-mechanics.md` §5 unchanged), so there's no offline boss case to define.

**Confirming your offline-efficiency point — yes, that's exactly right, and it's worth stating as the concrete number.** Because the offline formula applies speed and efficiency multiplicatively (boosted seconds × multiplier × efficiency), popping a boost and then going offline **never loses value relative to not having the boost**, but it does forfeit half its potential compared to spending it live, at the current `BASE_OFFLINE_EFFICIENCY = 50%` starting point:

| Scenario | Effective seconds for X elapsed, fully inside a 2x boost window |
|---|---|
| Live (online), boost active | X × 2 (full value — dilated clock, no efficiency tax) |
| Offline, boost active, 50% efficiency | X × 2 × 0.5 = X × 1 (half the boost's potential realized) |
| Offline, no boost, 50% efficiency | X × 1 × 0.5 = X × 0.5 (baseline) |

So early-game, popping a boost then closing the app is a real (if not total) waste — you get double the unboosted-offline rate, but only half of what the same purchase would've delivered live. As the Offline Efficiency prestige-shop track climbs toward its 100% cap, that gap closes entirely — a maxed-efficiency player loses nothing by spending a boost offline. **This is an intentional early-game incentive to be present for a purchased boost, not a bug to design around** — same shape as the boss-gate presence requirement, just softer (a tax, not a hard block). Worth surfacing in the UI (a "you'll only get half value offline" hint when a boost is active and efficiency is below 100%) rather than leaving it as a silent trap — a UX note for the eventual client-design pass, not a mechanic change.

This deletes the earlier presence-gating of Battle Speed for wave-grinding, and reinstates the idle doc's original "boss timer compresses too" framing for live boss fights — the only real change from that doc's original design is (1) offline now gets the wave-grinding multiplier where it didn't before, and (2) Arena is carved out as a new, narrower exception than "everything except grinding." Doc consequences flagged in §9.

### 4c. Boss fights — seeded server resolution, client replay

Bosses can't be lazily settled (locked: offline never engages a boss) and shouldn't be client-resolved (shared economy). The pattern:

1. Client calls `boss/engage.post.ts`. Server settles first (so the fight uses current state), verifies the run is actually parked at a boss gate, generates a **random seed**, and runs `shared/utils/hero-quest/fight.ts`: a deterministic tick-simulation of a fixed 30 sim-second fight — real seeded crit rolls, cooldowns, boss ATK vs party mitigation/HP, timer — entirely server-side. Bounded work: 30 sim-seconds at a fixed tick rate, sub-millisecond in practice, unaffected by any Battle Speed tier (the server always computes the full 30-sim-second outcome; speed only changes client playback pacing, per §4b).
2. Outcome (win → advance / super-boss clear → Void Shard payout via the locked formula; lose → fall back a stage) is applied in the same transaction. Seed + context snapshot + outcome are written to `hqFights`.
3. Response returns the seed and snapshot, plus whatever Battle Speed tier was active at engage time. The client runs the *identical* `fight.ts` with the same seed and animates the exact authoritative fight, blow for blow, played back at the boosted rate if one was active — "the client technically just shows an animation," literally, now including its pacing. No divergence possible, because it's the same pure function in `shared/`.

Note this deliberately upgrades boss fights from the offline calc's averaged-crit model to real seeded RNG — fights get authentic crit variance while staying fully deterministic and replayable. Wave farming stays averaged (it's a rate, not a fight).

**Raids: resolved, see `raid-system.md` (Locked).** Confirmed to reuse this exact pattern — seeded server-resolved tick-sim, client replay, Battle Speed applying to playback pacing only, same as bosses. Live-engagement-only, exactly like bosses (`raid-system.md` §5) — the offline question this section originally flagged as open is closed: no offline-raid case exists to define, same reasoning as bosses. Quick-clear (`raid-system.md` §4) turned out to be its own dedicated reward-grant path rather than a Battle Speed side-effect — it bypasses `fight.ts` entirely instead of running a fast-forwarded fight. New schema (`hqRaidState`, above) and API routes (`raid/engage.post.ts`, `raid/quick-clear.post.ts`, Section 5) follow directly from that doc.

### 4d. Arena — same machinery, two snapshots, no Battle Speed

**RESOLVED: see `arena.md` (Locked).** Arena resolution is `fight.ts` again with a second party: `(attackerSnapshot, defenderDefenseLoadout, seed) → outcome`. **Battle Speed is excluded here specifically, unlike bosses/Raids** — my read on why, worth naming even though it doesn't change the implementation: Arena is asynchronous, and the defender is never online to have any relationship to the attacker's boost at all. Even though structurally a boost still wouldn't change the deterministic outcome (same argument as bosses — it's playback pacing, not extra combat), letting a live attacker's paid multiplier touch a fight that resolves against another real player's data is an easy thing to *perceive* as a PvP advantage regardless of what it technically does under the hood. Keeping it a flat, simple exclusion sidesteps that question entirely rather than relying on players trusting "it's cosmetic, I promise." Defender's `defenseLoadout` + collection rows are read server-side; the defender is never online for it (asynchronous, per the backlog).

**Matchmaking now runs on a dedicated Defense GPN** (`arena.md` §2), computed off `defenseLoadout` and denormalized to `defenseGpn` rather than reusing the defender's live `globalPowerNumber` — this closes the fairness gap this section originally flagged as open. Candidate selection returns 3 opponents within a GPN band of the attacker's live GPN; if fewer than 3 real candidates exist, the shortfall is filled by a guaranteed-win **Training Dummy** (`arena.md` §2a) rather than widening the band — a dummy fight never touches `arenaRating`, only pays flat Medals, so it can't be used to farm the ladder.

Rewards, attempts, seasons, rating, the Arena Shop, the battle log, and the separate Arena leaderboard are all designed and locked in `arena.md` — no longer future work. The schema above (§3) and this fight engine were the only pieces this doc needed to anticipate in advance, and both held up unchanged except for the `defenseLoadout`/Gear correction and the new Arena-specific columns/tables now listed in §3.

---

## 5. API Surface — `server/api/hero-quest/`

One file per verb, directory per subsystem, `requireUserId(event)` at the top of every handler, claim-then-reward on every mutation (the atomic conditional decrement is the mutex; lock-then-read where old values are needed; never CAS on a timestamp):

```
state.get.ts                      init.post.ts
boss/engage.post.ts               prestige/execute.post.ts
prestige/pick-class.post.ts       prestige/shop-buy.post.ts
gacha/pull.post.ts                gacha/craft.post.ts        (system in body: gear|champion|skill|artifact)
gacha/buy-seals.post.ts           loadout/set.post.ts        (live equip: party/skills/artifacts/gear/formation)
loadout/save.post.ts              loadout/apply.post.ts
loadout/set-raid-preference.post.ts
trait/roll.post.ts                trait/lock.post.ts         (toggle, free)
trait/save.post.ts                trait/load.post.ts         (100 Trait Gems each)
holiday/claim.post.ts             speed/buy.post.ts
seals/claim-daily.post.ts
raid/engage.post.ts               raid/quick-clear.post.ts   (raidId in body, both routes)
arena/defense-set.post.ts         arena/attack.post.ts       (attack accepts a dummy target sentinel per arena.md §2a)
arena/candidates.get.ts           arena/refresh-candidates.post.ts   (3-candidate list, dummy-filled as needed; refresh = 10 Gems)
arena/buy-attempt.post.ts         arena/shop-buy.post.ts     (arena.md §3, §6)
arena/log.get.ts                  arena/leaderboard.get.ts   (arena-specific; distinct from the platform leaderboard.get.ts below)
fights/[id].get.ts                leaderboard.get.ts
```

**Built as of 2026-09-15:** `state.get.ts`, `init.post.ts`, **`stats.get.ts`** (new — settles, then returns `explainStats` for the stat breakdown panel), `boss/engage.post.ts`, `prestige/{execute,pick-class,shop-buy}.post.ts`, `gacha/{pull,craft,buy-seals}.post.ts` (free pulls are a payment branch inside `pull`, not a route), `loadout/{set,save,apply}.post.ts`, and the development-only harness `dev/{grant,reset,set,skip,unlock}.post.ts` (gated on `import.meta.dev`, 404 in production builds, `open-items.md` #19). Everything else in the list above is Phase 4.

Canonical claim-then-reward examples in this game: `gacha/pull.post.ts` decrements Seals with `gte(seals, cost)` in the `where` before rolling; `gacha/buy-seals.post.ts` reads/increments `sealLadderPurchasedToday[gacha]` (resetting the whole map first if `sealLadderDate` isn't today) to compute that gacha's current rung price per its own growth rate (`gold-economy.md` §7 — Champions and Artifacts share a rate, Skills uses a steeper one, but each still has its own independent counter), then debits that amount via `balance.ts` inside the same tx before crediting a Seal — the ladder-read and the debit must share one transaction so concurrent purchases can't both claim the same cheap rung; `prestige/execute.post.ts` lock-then-reads to verify World 10/Stage 10 super boss is actually cleared before paying Void Shards; `raid/engage.post.ts` and `raid/quick-clear.post.ts` both lock-then-read `hqRaidState` first — for the three win-gated fight types the Key debit happens only after a win is confirmed (engage) or immediately (quick-clear, since a "cleared" flag is a guaranteed win by construction); for Trait Raid's `rampaging_boss` type, `engage.post.ts` debits the Key unconditionally up front, before running `fight.ts`, since there's no win outcome to gate the debit on. **No separate `raid/claim-keys.post.ts`** — the daily Key grant applies lazily, computed from `lastKeyGrantAt` at the moment either route runs, mirroring the settle-lazy pattern rather than `seals/claim-daily.post.ts`'s dedicated-claim pattern; flagging this as a design choice worth confirming rather than a locked call, since the Seal precedent went the other way.

**`state.get.ts` contract** (two consumers — composable and the AI agent's executor overview, so derived display values, not raw rows):
- settles first, always — reads see a settled world
- returns computed values: final party stats, current-stage `secondsPerKill`, boss readiness, all shop next-level costs, gacha next-threshold progress, dupe costs for owned items, Battle Speed prices, `globalPowerNumber`, per-raid Key balances + frontier level (`hqRaidState`, ×5)
- Decimals serialized as strings; display formatting client-side via `numbers.ts`
- `serverNow: Date.now()` for drift-free client interpolation of accrual and Battle Speed countdowns
- `initialized: false` with the same payload shape when un-inited; `init.post.ts` explicit
- serializers in `server/utils/hero-quest.ts` (`serializeCollection`, `serializeLoadout`, `serializeRun`, `serializeShop`), fan-out reads via `Promise.all`

---

## 6. Testing & Balance Tooling

- `test/hero-quest/content.spec.ts` — the invariant suite (Section 2)
- `test/hero-quest/settle.spec.ts` — exact-output assertions on the pure settle function, including boss-gate redirect, offline cap/efficiency, online-threshold classification, Battle Speed overlap
- `test/hero-quest/fight.spec.ts` — seeded fights are reproducible (same seed → same outcome), boundary cases (timer expiry, party wipe, the `MIN_DAMAGE` mitigation floor, evasion at 0 and at `MAX_EVASION`), live buff/debuff statuses
- Also built: `settle-carry.spec.ts` (part-kill carry), `settle-reuse.spec.ts`, `campaign.spec.ts`, `projection.spec.ts`, `explain.spec.ts`, `battle-readout.spec.ts`, `auto-boss.spec.ts`, `concurrency.spec.ts`, and `test/economy/cross-game.spec.ts` (the tenure-ceiling staleness guard)
- `test/hero-quest/gacha.spec.ts` — pull distribution over large N against the drop table, dupe/star/craft accounting, no-Seal-loss under concurrent-pull simulation
- `scripts/hero-quest-balance.ts` (+ `balance:hero-quest` in package.json, mirroring `balance:xeno`/`balance:colony` (other verticals' scripts)) — imports `constants.ts` and prints projection tables: time-to-boss per world/prestige at given party strength, offline earnings curves, pulls-to-max timelines, Void Shard income vs shop cost curves. The tuning-pass workhorse.

---

## 7. Client — Composable, Pages, Battle stage

- **`useHeroQuest.ts`** per the platform shape: one keyed `useFetch`, computed-per-field with fallbacks, private `call` helper (POST → toast → `refresh()`), money-moving actions also `await fetchSession()`. Pages contain zero fetch logic.
- **Pages:** `hero-quest.vue` thin tab-strip parent; tabs: `index` (the battle — run position, party, live accrual), `forge`, `guild`, `training-grounds`, `dig-site` (one page per gacha, or one `gacha` page with sub-tabs — presentation choice), `raids` (5 raid ladders, Key balances, engage/quick-clear), `traits` (5 slots, roll/lock, save slots), `prestige` (shop + class picker), `arena` (`arena.md`, Locked — its own candidate list, defense-loadout editor, shop, log, and leaderboard sub-views), `encyclopedia`, `leaderboard`. Loadout management is a modal/panel rather than its own tab, since it's invoked from wherever equipping happens. `forge` (Gear, `gear-equipment.md`, Locked) sits **1st** per that doc's revised placement call — ahead of Guild, Training Grounds, and Dig-site. Encyclopedia + own leaderboard tab are platform-mandatory for idle games and this game's content (48 Champions + 48 Artifacts + 36 Skills + 36 Gear = 168 collectibles, plus 16 class nodes and the trait tables) is unusually encyclopedia-shaped anyway.
- **Battle presentation:** `app/components/hero-quest/BattleCanvas.vue` — a Canvas 2D scene, not Pixi (2026-10-02, the user's call, `build-log.md` #34): the art composes indexed 320×180 frames in software and `canvas.ts` blits them at an integer scale, so a GPU scene graph would only wrap our own baked frames. Strictly presentation: between refreshes it runs the shared settle math client-side to animate predicted accrual, and for boss/Arena fights it replays the server's seeded fight verbatim (Section 4c). It renders, it never decides. Start with a modest scene (sprites, HP bars, floating damage numbers via the existing `HarvestFloat`-style pattern); the event-driven replay design means scene ambition can grow later without touching sim or server.
- **Art comes from code, not image files** (2026-10-02, `build-log.md` #33). The scene imports the procedural drawers (`app/utils/hero-quest-art/`) and bakes each strip to frames the first time it is needed, then blits it; no PNG is fetched and none is committed. Three rules carry over from the art page's live stage (`demo.ts`), where they were measured: **bake ahead** (a raid or boss strip costs 3.5–4.4 ms a frame, a whole raid boss ~1.5 s, so bake during the stage before the gate or the entry, inside a per-tick budget or a worker, never on engage), **crop and release** (crop each strip to its drawn box, and drop a fight's frames when it ends), and **keep effects live** (projectiles, particles and shake run at 60 Hz through `clock.smooth`, which baked strips cannot). Everything else is cheap: the median asset frame draws in 0.024 ms. Load the drawers per group with dynamic imports; all of them are 224 KB gzipped, against 17 MB of PNGs.

**As built (2026-10-02) — the stage.** `BattleCanvas.vue` runs the art page's engine (`BattleDemo`, `demo.ts`) in run mode: `setupRun(party, feed)` builds it for the fielded party and the world, `feedRun(feed)` hands it `liveRun` every frame, and `run-director.ts` decides when each body drops (the front one, when `killsFloat` crosses its kill) and what its numbers say (the real per-enemy HP split over the hits landed, crits at the Hero's real chance and multiplier, each body's numbers summing to its HP; specced in `stage-director.spec.ts`). A stage clear carries the last body over, a walled restart fells the party, a gate holds the boss and escort in a standoff, and a jump (new world, prestige, a tab back from hidden) rebuilds rather than replays. The engine loads on mount as its own chunk. `BattleView.vue`'s bars stay under it, reading the same `killsFloat`. The party casts its real kits: the hero payload's `kits` (`projection.partyKits`) gives each unit's abilities on the cooldowns `runFight` uses, and each fires the moment it comes due. Boss fights play on the same stage: `playFight` acts out the server's log, cut into beats by `fight-script.ts` so each swing lands on its logged moment, and `BossFightPanel.vue` replaces the bars underneath while it plays. The engage response carries `partyIds` and `partyMaxHps` for that. `BossFightModal.vue` is retired.

**As built (2026-09-15) — placeholder chrome, no Pixi scene yet.** Tabs are `index` (battle), `gacha` (a 2×2 of pull cards), `collections/{gear,champions,skills,artifacts}`, `loadouts`, `prestige`, `wiki/{index,combat,economy,gacha,content}`, and `dev` in development builds — the four per-gacha tabs collapsed into Gacha + Collections on a playtest call (`open-items.md` #20). The battle screen is `BattleView.vue` + `BossFightModal.vue`, driven by:

- **`app/utils/hero-quest-battle.ts`** — `projectRun` walks the run forward from the last payload (kills, stage, world, Gold, XP, level) using the same pure helpers `settle()` uses, and `battleReadout` turns the landing position into bars, including live hero and pack HP. `secondsPerKill` and `killsBeforeWipe` are **held** for the whole projection, as `settle()` holds them; position-only quantities (pack size, per-enemy HP) are recomputed at the projected position. The projection starts from the served `killFraction`, or the current enemy's HP bar would rewind by up to one body on every payload. Nothing projected is ever sent back. Specced in `battle-readout.spec.ts`.
- **`useHqLiveRun`** (the ticker driving the projection), **`useHqAutoBoss`** (§4b), **`useHqClock`** (one shared ticker for free-pull countdowns).
- **`StatBreakdown.vue`** — where every stat comes from, reading `stats.get.ts`.

---

## 8. Global Power Number

**As built (2026-09-15):** `shared/utils/hero-quest/power.ts`, serialized on the hero payload and **computed on read rather than stored** on `hqState` — no reader of a stored value exists yet. See `global-power-number.md` *As built* and `open-items.md` #28.

**RESOLVED: see `global-power-number.md` (Locked).** GPN is a pure function of the Hero + currently fielded Champions' actual current stats — `partyEffectiveDPS × partyEffectiveEHP`, where DPS reuses `idle-mechanics.md` §4's existing definition and EHP is a new GPN-specific formula (`HP × (1 + DEF / EHP_DEF_CONSTANT)`, distinct from combat's attacker-relative mitigation). No separate collection-breadth term — Champion collection already folds in via its passive Hero-buff (`champions-guild-gacha.md` §7), and Skill/Artifact collection folds in only to the extent those systems' *equipped* copies affect stats (neither has a passive-collection bonus today). Computed in `stats.ts`, recomputed and written to `hqState.globalPowerNumber` on every settle — unchanged. **Notable behavior change from earlier drafts: GPN is a live snapshot and can decrease** (e.g. benching a strong Champion or unequipping an Artifact), which is the intended, honest-for-Arena-fairness design. Uses: platform leaderboard aggregate (Section 1), Arena matchmaking (Section 4d — the attacker's live GPN, matched against a separate Defense GPN computed off defenders' `defenseLoadout`, resolving the divergence this section originally flagged; see `arena.md` §2), profile display (raw big-number notation, no compression). Mechanical uses beyond that stay deferred, per the backlog.

---

## 9. Flagged Design Consequences

**9.1 — RESOLVED: see `gold-economy.md` (Locked).** Gold is decoupled from `enemyMultiplier` entirely. *(Revised 2026-08-18: its curve is now `BASE_GOLD × min(1.017^n, tenureCeiling(accountAge))`, with the ceiling generated from Colony and Xeno at 0.85× — `gold-economy.md` §3a. The calendar-anchored prestige table and +2%/prestige crawl described in the rest of this paragraph's original form are superseded.)* A `MIN_SECONDS_PER_KILL` throughput floor makes Gold/hour bounded by construction on both axes (value-per-kill and kills-per-second), so worst-case income stays orders of magnitude under the `numeric(19,4)` ceiling regardless of stacked Gold% effects or Battle Speed. That doc also closes two knock-on breaks the bounded curve exposed: the flat 1,000,000-Gold Seal price (replaced by a daily escalating ladder) and the Gambler's Strike skill family (redesigned off a bounded wealth-factor rather than raw Gold, since the risk direction inverted from "trivializes combat" to "decays to irrelevance" once Gold plateaus). See `gold-economy.md` §11 for the full list of edits this requires in `gacha-shared-system.md`, `economy-and-currencies.md`, `skills-gacha.md`, `artifacts-dig-site-gacha.md`, `core-progression-and-prestige.md`, and `idle-mechanics.md`.

**9.2 — RESOLVED: Manual mode is removed from the game entirely.** Not demoted to presentation — deleted. Every skill in the game, Hero and Champion alike, always auto-casts the instant its cooldown completes; there is no toggle, no tap-to-fire, no ready-and-waiting state anywhere. This resolves the server-authority conflict at the root (there are no taps to be inputs to anything) and simplifies the whole stack: no `manualMode` state, no per-skill ready-glow UI, no as-if-Auto special-casing in settle or fight resolution — the game *is* Auto.

**9.3 — RESOLVED (revised twice): Battle Speed applies everywhere except Arena.** Final shape: wave-stage grinding gets a genuine throughput multiplier, online (dilated clock) and offline (multiplied effective seconds, superseding the idle doc's original "never offline" rule); boss/super-boss fights get the multiplier applied to client playback pacing only, since their sim outcome is fixed regardless of speed (this actually *reinstates* the idle doc's original "30-second timer resolves in 3 real seconds" framing rather than contradicting it); **Raids, now designed (`raid-system.md`, Locked), are confirmed to work the same way as bosses** — playback-pacing-only, live-engagement-only, no offline case. **Arena alone is excluded** — asynchronous PvP against another player's data, where letting a paid multiplier touch the fight is worth avoiding on optics even though it wouldn't change the deterministic outcome (§4d). Offline never engages a boss regardless of Battle Speed (`idle-mechanics.md` §5, unchanged), so no offline-boss case exists to define. The offline-efficiency interaction for wave-grinding (confirmed: an early-game offline-spent boost realizes only half its potential value versus spending it live, closing to zero loss as the Offline Efficiency shop track approaches 100%) is unchanged from the prior pass — see Section 4b.

### Cross-doc edits required — **ALL APPLIED**

| Doc | Section | Edit | Status |
|---|---|---|---|
| `classes-and-combat.md` | §3 "Manual cast toggle" | Delete the entire subsection; every skill on every unit always auto-casts. Remove the multi-ready visual-cue implementation note with it. | ✅ Applied — replaced with "Everything auto-casts — no manual mode" |
| `idle-mechanics.md` | §1 | Delete the Auto/Manual rows and the "Manual toggle offline resolution" paragraph; the system-allocation table collapses to "everything is idle-native." | ✅ Applied |
| `idle-mechanics.md` | §2 | Delete the "separate axis from the Hero's Auto/Manual toggle" bullet. | ✅ Applied |
| `idle-mechanics.md` | §3 | Extend the offline line: wave-stage offline accrual is now boosted (per §4b), bosses still never occur offline (§5). Add the Arena exclusion explicitly. | ✅ Applied — §3 now carries a full scope table, and §4's formula includes the `boostedSeconds` step |
| ~~`idle-mechanics.md` (or wherever Arena's own doc lands)~~ | — | **RESOLVED.** `arena.md` (Locked) cross-references this doc's §4d, which remains authoritative. | ✅ No edit needed |
| `skills-gacha.md` | §3, §5 | Remove references to Actives riding the Hero's Auto/Manual switch. | ✅ Applied — §3, §5, §7 and the structure recap all updated |

**Minor open items:** `ONLINE_THRESHOLD_MS` and refresh-interval values (tuning constants — now scoped to offline efficiency/cap classification only); whether boss fights' seeded-RNG crits (vs averaged) is the feel you want (§4c — I recommend seeded). ~~Single `hqCollection` table vs four per-system tables~~ **resolved: single table** (§3). ~~The game's actual name replacing `battler`~~ **resolved: Hero Quest** — applied throughout (`hq`/`hero-quest` naming, intro note above).

---

## Implementation Note

Everything above either instantiates a locked design doc into the platform's established conventions (lazy settle ↔ snapshot offline calc, claim-then-reward ↔ every currency mutation, `shared/` purity ↔ the headless-sim-core principle, `state.get.ts` dual-consumer contract) or closes a fork you resolved in this conversation (server-authoritative, Arena anticipated, TS content modules, Postgres/jsonb-adjacent save shape via the platform's normalized-tables convention instead).

Scaffolding order = the platform doc's 9 steps, with this game's step 1 being `shared/utils/hero-quest/` content + constants + settle math with its vitest suite — the balance scripts come alive at that point, before any table exists.

§9.1's resolution (`gold-economy.md`) is a dependency for the settle function's Gold-crediting line and for `gacha/buy-seals.post.ts`'s ladder logic — implement those against that doc's locked formulas rather than the flat-1M placeholder described in earlier drafts of this doc.
