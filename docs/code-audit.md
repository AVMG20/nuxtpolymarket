# Code audit — DRY / SOLID / maintainability

Working checklist from the full-codebase audit (2026-07-17). Temporary doc; delete when done.
Repo at time of audit: ~59k lines — 119 server TS files, 100 Vue components, 31 shared modules.

Legend: `[ ]` todo · `[x]` done · `[~]` in progress / partial

## A. Server — cross-cutting DRY

- [x] **A1 — `requireUserId(event)` helper.** The `getSession` + 401-throw block repeats in ~95
  handlers. Add `requireUserId` / nullable `getSessionUserId` (for the five leaderboards that only
  compute `isCurrentUser`) next to `auth` in `server/utils/auth.ts`, sweep all handlers.
  *Done: 99 handlers converted. `chat/ws.ts` (websocket, `request.headers` + user name) and
  `gem-market/state.get.ts` (reads `session.user.gems`) legitimately keep raw `getSession`.*
- [x] **A2 — one `DbExecutor` type, one tx convention.** Three copies of the same
  `Pick<typeof db, ...>` type (`BalanceExecutor` in balance.ts, `ColonyWriteTx` in colony.ts,
  `XenoExecutor` in xeno.ts) and two calling conventions (`tx?` optional-and-branch vs `tx = db`
  default). Export one `DbExecutor` from `server/database`. Delete the private `creditGems` in
  colony.ts in favour of the exported one in balance.ts; make `credit` return the new balance like
  `debit` does.
  *Done: `DbExecutor` exported from `server/database/index.ts`; balance/colony/xeno use it.
  `credit`/`debit` keep the optional-`tx?`-wraps-in-transaction shape (deliberate: the no-tx path
  must stay atomic across ledger insert + balance update); gem/rake helpers keep `tx = db`.*
- [x] **A3 — locked-state helpers per subsystem**, mirroring `getLockedBankState` (bank.ts): the
  lock + not-initialized-404 preamble is copied 5x across miner endpoints; pirates uses raw-SQL
  `FOR UPDATE` plus a second read (finish-run, upgrade) where drizzle `.for('update')` is one query.
  *Done: `getLockedMinerState` in new server/utils/miner.ts; `getLockedPirateState` in new
  server/utils/pirates.ts (single `.for('update')` query replaces raw SQL + second read).*
- [x] **A4 — parametrize near-identical endpoints.** Miner upgrade-rig/upgrade-vault (cost fn +
  column differ), catalyst/overclock (three identifiers differ) — see the `LEVEL_COLUMN` map in
  pirates/upgrade.post.ts for the shape. Blackjack settle logic duplicated between action.post.ts
  and play.post.ts; locked-balance read triplicated across the three blackjack endpoints.
  *Done: miner rig/vault/factory upgrades share `collectAndUpgradeCash`/`collectAndUpgradeGems`;
  catalyst/overclock share `upgradeGemShopTier` (state read moved inside the tx, redundant gems
  pre-check dropped — error message is now debitGems' generic "Not enough gems"). Blackjack
  endpoints share `lockUserBalance`/`readUserBalance`/`settleFinishedHand` (server/utils/blackjack.ts).*
- [x] **A5 — name the money constants.** Bet caps are magic numbers in five places
  (`100_000_000_000` x2, `1_000_000`, `100_000_000_000_000` x3) and have drifted once already.
  Also `toFixed(4)` x68 and `parseFloat(...balance...)` x42 → small `money.ts` helpers.
  *Done: `CASINO_MAX_BET`, `AI_CASINO_MAX_BET`, `BANK_MAX_AMOUNT` in shared/utils/limits.ts;
  all five magic-number sites swapped. toFixed(4)/parseFloat helper deferred (low value vs churn).*
- [x] **A6 — hack/ops/collect.post.ts transactional.** The `collected` claim flip is atomic but the
  reward roll, credits, item inserts, XP updates and the `reward` persist run on the pool — a
  mid-way failure leaves a claimed op with half-applied rewards. Wrap in one `db.transaction`.
  *Done: claim + payout share one transaction (failure rolls the claim back, op stays collectable);
  credits pass `tx`; in-tx `Promise.all`s sequentialized (single connection anyway).*
- [x] **A7 — extract `computeUserPower(agents, items)`.** The agentPower-from-equipped-gear
  computation is hand-copied in leaderboard.get.ts, hack/leaderboard.get.ts and hack/state.get.ts.
  *Done: `equippedAgentPower` in new server/utils/hack.ts, used by all three call sites;
  spec in test/hack/power.spec.ts.*

## B. Server — structure (SOLID)

- [x] **B1 — split `server/utils/ai.ts` (1,684 lines)** into `server/utils/ai/` along its five
  seams: OpenRouter transport/streaming, tool catalog, per-subsystem tool executors, conversation
  persistence, casino option validation. Its hand-written `XenoState`/`HackState`/`ColonyState`/
  `MinerState` interfaces mirror state-endpoint responses by hand — share DTO types instead.
  *Done: `tools` / `executors` / `casino` / `conversations` / `transport`, plus two files the five
  seams didn't anticipate — `helpers.ts` (`toolHeaders`, `getErrorMessage`) exists because putting
  `getErrorMessage` in transport would cycle (executors → transport for the helper, transport →
  executors for the dispatcher; hoisting hid this in the monolith), and `types.ts` for the shared
  `OpenRouterMessage` union. 41 specs in test/ai/ cover casino option validation + `toOpenAiMessages`.
  No barrel: `server/utils/` is auto-imported recursively, so an index re-exporting the modules made
  Nitro register all 6 symbols twice and pick a winner arbitrarily. The 3 real importers
  (chat.post, tools/execute.post, conversations/[id]/messages.get) import concrete modules instead.
  DTO sharing deliberately deferred — see follow-ups.*
- [x] **B2 — leaderboard.get.ts loads whole tables** (hackAgents, hackItems, aiMessages, xeno rows)
  and runs 9 per-user `filter()` passes in JS. Move counts to SQL `GROUP BY`; keep only the power
  computation in JS on pre-filtered rows.
  *Done: research sum + xeno species/grid/breeder + aiMessages counts are now SQL `GROUP BY`
  (role and typeId filters pushed into WHERE). hackAgents/hackItems stay in JS for
  `equippedAgentPower` but are column-trimmed and pre-grouped into Maps once instead of a
  `filter()` per user. Verified: every map lookup defaults (`?? 0` / `?? []`), so users with no
  rows still render zero; the `Set`-based species dedup was a no-op given
  `unique('xeno_plants_unlocked_unique').on(userId, typeId)`, so `count()` is equivalent.*
- [x] **B3 — slim fat state endpoints.** colony/state.get.ts is 381 lines of inline DTO assembly;
  move derivation into server/utils/colony.ts serializers shared with the leaderboard.
  *Done: endpoint 381 → 138 lines (auth → default DTO if uninitialized → settle → fetch → derive
  → serialize). `serializePlacedBugs`/`serializeBugInventory`/`serializeUpgradeTracks`/
  `serializeBuilder`/`serializeResearch`/`serializeSpeciesCatalog`/`foragedDisplay` exported from
  server/utils/colony.ts; 18 specs in test/colony/serializers.spec.ts. Response shape verified key
  by key against main on both the initialized and uninitialized branches — unchanged.*
- [x] **B4 — extract pure `settlePirateRun(state, report, now)`** from pirates/finish-run.post.ts
  (anti-cheat clamps, best-run tiebreaks, payout math become unit-testable).
  *Done: pure `settlePirateRun(state, report, now)` in server/utils/pirates.ts; handler is now
  auth + claim + persist. 19 regression tests in test/pirates/settle-run.spec.ts pin the
  anti-cheat clamps, completion bonus, tiebreaks (incl. the pre-existing "longer run always
  overwrites best-loot" quirk, now pinned deliberately).*
- [x] **B5 — `randomWeighted()` in shared/utils/random.ts.** Five hand-rolled `roll -= weight`
  loops: fireinthehole.ts, pirates.ts, hack-config.ts, xeno/hybrids.ts, miner-config.ts.
  *Done: `randomWeighted(items, weight, rng?)` in shared/utils/random.ts; all five loops
  converted (boundary unified to `< 0` + last-item fallback; verified against existing stubs).
  Spec in test/shared/random.spec.ts.*

## C. Client

- [~] **C1 — extract slot-game scaffolding (~12k lines across 6 components).** Aethergates,
  BookOfShadows, CandyMadness, FireInTheHole, Spinata, XenoSlot all repeat: balance ref + watch,
  winFlash, bet state, spin() → $fetch → settle, big-win overlay, buy-bonus modal, keyboard
  handler, pixi app lifecycle, float text. Extract `useSlotGame()` composable, pixi lifecycle
  helper, `<BigWinOverlay>` / `<BuyBonusModal>` components.
  *Phase 1 done: `useSlotGame` (bet/isSpinning/errorMsg/history + guard + POST; like `useCasinoGame`
  it never writes balance/history — but takes `spin(cost, options, onStart)` because buy-bonus costs
  a multiple of `bet`), `app/utils/slot-pixi.ts` (`Application` init + `safeDestroy` only — reels,
  atlases and `resizePixi` differ per game and stayed put), `<BigWinOverlay>` (backdrop div only,
  markup via slot). BookOfShadows migrated as the reference: 117 lines lighter.*
  *Correction to this audit line: there is NO buy-bonus modal in any of the six — every slot fires
  the spin straight from the button, and each button is custom-themed. `<BuyBonusModal>` was a
  phantom. The modal all six DO share is Auto Spin, so `<AutoSpinModal>` was extracted instead.*
  *Phase 2 (open): migrate the other five. Known non-fits — Spinata has no optimistic debit and its
  big-win is click-to-dismiss on a 4000ms timeout, so don't force `<BigWinOverlay>` on it; the
  overlay will need an `intensity?: number` prop back for the four that scale font size by tier
  (left out deliberately — BOS doesn't use it, so it lands with its first real caller).*
- [x] **C2 — `useCasinoGame(game)` + `<GameHelpModal>` + `<BetControls>`.** dice/limbo/wheel pages
  have line-identical script blocks; all five casino pages repeat the help modal + bet controls.
  *Done: `useCasinoGame` owns bet/isPlaying/isFetching/lastBet/errorMsg/history + the play-guard
  and POST; it deliberately does NOT commit balance/history — pages call `setBalance`/`pushHistory`
  at their own animation-completion point, preserving exact timing. `<GameHelpModal>` applied to
  all five casino pages, `<BetControls>` to dice/limbo/wheel (blackjack's near-identical inline
  block is a natural follow-up). dice/limbo/wheel scripts ~101 → ~60 lines each.*
- [x] **C3 — `balanceNum` in useAuth.** The `ref(parseFloat(user.value?.balance ?? '0'))` + watch
  idiom is pasted into essentially every game page and slot component.
  *Done: `balanceNum` computed added to useAuth; dice/limbo/wheel/blackjack/magichands dropped
  their ref+watch mirrors (setBalance writes user.value synchronously, so mirrors were redundant).*
- [x] **C4 — `toastApiError(e, fallback)` util.** `catch (e: any)` → toast pattern appears 41x.
  *Done: `apiErrorMessage(e, fallback)` in app/utils/toast-error.ts; 34 catch sites across 14
  pages converted, exact fallbacks preserved. ai.vue kept its own errorText (materially
  different shape: SSE hand-thrown Errors, shared fallback, description-rendered).*
- [x] **C5 — `<LeaderboardList>` component.** Five leaderboard pages (907 lines) share podium
  top-3 + ranked list, medal icons, rankBg, YOU badge. Also key rows by `rank`, not index.
  *Done: keys fixed (rows keyed by player name), plus five components — `LeaderboardMedal`,
  `LeaderboardSkeleton`, `LeaderboardYouBadge`, `LeaderboardPodiumRow`, `LeaderboardListRow`
  (~138 lines). colony + xeno fully unified onto podium/list rows; the table-based main page, the
  HackFrame-themed hack page and the UCard-based pirates page adopted only the pieces that fit
  (medal / skeleton / YOU badge) rather than forcing a prop explosion. Pages 907 → 851 lines.
  Noted for follow-up: leaderboard.vue and pirates/leaderboard.vue receive `isCurrentUser` from
  the API but render no highlight from it — a pre-existing gap, not introduced here.*
- [x] **C6 — split `app/utils/pirates-engine.ts` (3,388 lines)** into a `pirates-engine/` dir:
  entities/AI, spatial grid, sprites/rendering, combat, powerups. Framework-free, mechanical split.
  *Done, but NOT five-way. Clean DAG: `types`/`constants`/`math` (leaves) → `nav-grid`/`sprite-fx`
  → `pirate-game` → `index` barrel; no cycles; `app/composables/pirate-run.ts` untouched.
  `nav-grid.ts` was the real find — islands + blocked-grid + A* were touched by exactly 8 methods
  and nothing else, so they became `PirateNavGrid` owning both fields (island placement fell out as
  pure `generateIslandLayout`). `sprite-fx.ts` needed only a target Container, never game state.
  Entities/AI, combat and powerups deliberately NOT separated: they are mutually recursive through
  shared mutable state (killEnemy → spawnPowerUp → collectPowerUp → powerUpStack, read back by the
  cannon logic), so splitting them required exactly the injection layer this audit says to avoid.
  Class 3,388 → 2,610 lines. Zero new specs — nothing genuinely pure fell out; the A* and island
  layout are `Math.random`-driven and grid-shaped. Kept 4-space to match the source (see below).*

## Testing mandate

Every refactor item in this doc lands **with tests** that pin the behavior it touches, so the
refactors can't silently break things:

- Pure logic (gamelogic, config math, extracted helpers like `settlePirateRun`,
  `computeUserPower`, `randomWeighted`) gets unit specs in `test/` mirroring the source tree.
- DB-backed utils get concurrency/behavior specs like `test/balance/concurrency.spec.ts`
  (skip without `DATABASE_URL`, run in CI against the Postgres service).
- Endpoint handlers themselves aren't directly testable without an HTTP harness — the strategy is
  to extract their logic into testable functions (B3, B4, A4) and cover those. A future
  `@nuxt/test-utils` harness for endpoint-level burst tests is tracked as D4.
- A refactor item is only checked off when `bun run typecheck` and `bun run test` both pass and
  new/changed logic has a spec, or the progress log explicitly notes the gap.

## D. Tests & tooling

- [x] **D1 — concurrency test helpers + coverage.** Extract seed/cleanup/burst helpers from
  test/balance/concurrency.spec.ts, then add burst specs for rakeback claim, hack-op collect,
  sells, roster expand, colony loot.
  *Done: seedUser/cleanupUser/burst/SKIP helpers in test/setup/db-helpers.ts; existing spec
  refactored onto them; new test/balance/gems-concurrency.spec.ts covers debitGems/creditGems/
  credit bursts + validation. Endpoint-level bursts still blocked on D4 harness.*
- [x] **D2 — specs for slot/blackjack gamelogic** (~3,100 lines, currently only RTP sim scripts):
  max-win caps, paytable monotonicity, RTP-within-tolerance under seeded RNG. Collapse the six
  `scripts/*-rtp.ts` harnesses into one parametrized runner.
  *Table games: test/games/{blackjack,dice,limbo,wheel}.spec.ts (blackjack alone is 52 specs
  covering scoring/soft-ace demotion, hole-card masking, phase guards, hit/stand/double/split/
  surrender/insurance, dealer play and payout outcomes). Slots: 26 specs pinning max-win caps,
  paytable monotonicity on BOTH axes (rarity derived from the live weight tables, so retuning
  weights without retuning pays trips it), feature-trigger boundaries, BOS retrigger-once, and the
  payout formulas. Runner: `bun run scripts/slot-rtp.ts <game> [rounds] [feature] [--fast]` replaces
  6 harnesses (665 lines deleted). `spinata-rtp.ts` stays — it never calls `playSpinata()`, it
  reimplements the reel logic against Math.random, so it isn't a parameter of this shape.*
  *Caveat worth remembering: the RTP bands in the specs are deliberately loose (0.3–3.0) to hold the
  <1s suite budget. They catch gross regressions, NOT tuning drift — a real 98% → 92% sails through.
  `slot-rtp.ts` remains the tool for actual RTP sign-off.*

## Follow-ups found during the audit (not yet actioned)

Surfaced while doing the work above; each deliberately left alone to keep refactors behavior-preserving.

- [x] **BOS reported `won: true` on losing buy-bonus rounds.** `bookofshadows.ts:473` used
  `won: payout > 0`; every other slot uses `payout > cost` (xenoslot:487, candymadness:453,
  aethergates:557). A buy costs 56.5x bet, so a round returning 0.18x reported `won: true`.
  *Fixed to `payout > cost`; the spec that pinned the old behavior now pins the fix.*
- [x] **Hand-rolled `rand()` across the gamelogic modules** — far wider than first reported, and
  three of them carried the exact bug CLAUDE.md warns about.
  *`dice.ts`, `limbo.ts` and `wheel.ts` divided by `0xFFFFFFFF`, which reaches exactly 1.0:*
  - *`wheel.ts` — `idx = floor(r * totalSegments)` could hit `totalSegments`, so the mapping loop
    never broke and the spin silently returned `segmentIndex: 0, multiplier: 0` — a player losing a
    spin they may have won, with the UI showing a segment that contradicts the result.*
  - *`dice.ts` — could roll `100.00` against a documented `0.00–99.99` range.*
  - *`limbo.ts` — could return exactly `1.0`.*
  *All nine simple helpers (dice, limbo, wheel, spinata, xenoslot, aethergates, magichands,
  bookofshadows, candymadness) now call `randomFloat()`. Two dice/limbo specs had encoded the bug
  in their expected values (limbo's `0.98/0.5` floored to 1.95 only because the divisor skewed
  `rand` above 0.5; it is exactly 1.96 with a correct RNG) — corrected. New bound specs in
  test/shared/random.spec.ts pin `randomFloat() < 1` on all-ones entropy, which is what actually
  reproduces the bug — `stubRandomFloat` cannot, as it packs buf[0]'s low bits with zeroes.*
- [ ] **blackjack.ts still hand-rolls its shuffle** — a bulk `Uint32Array(deck.length)` Fisher-Yates
  using `arr[i] % (i + 1)`, which carries modulo bias. Left alone deliberately: it is a different
  shape from the others, it is not the `/0xFFFFFFFF` bug, and all 52 blackjack specs are coupled to
  a `stubDeal` helper that reverse-engineers this exact shuffle. Worth doing as its own pass.
- [ ] **`leaderboard.vue` and `pirates/leaderboard.vue` receive `isCurrentUser` but render no
  highlight from it.** Pre-existing gap spotted during C5.
- [ ] **Blackjack's inline bet block** is near-identical to `<BetControls>` (C2 covered
  dice/limbo/wheel only).
- [ ] **ai.ts `XenoState`/`HackState`/`ColonyState`/`MinerState`** still mirror state-endpoint
  responses by hand and can silently drift (B1 deferred this deliberately).
- [ ] **`slot-rtp.ts --fast`** (Math.random swap) measured 2.7x faster under tsx but **0% under
  bun** — bun's `getRandomValues` isn't the bottleneck. The project is bun-exclusive, so the flag is
  effectively dead weight; drop it unless tsx use returns.
- [x] **D3 — de-brittle test/setup/stub-random.ts** (reverse-engineers randomFloat's bit packing
  with duplicated constants) — `vi.mock('#shared/utils/random')` or export the constants. Replace
  the hand-rolled .env parser in test/setup/nitro-globals.ts.
  *Done: stub-random imports the packing constants from shared/utils/random.ts (now exported)
  plus a self-check spec proving the inversion; nitro-globals uses process.loadEnvFile.*
- [ ] **D4 — endpoint-level test harness.** Evaluate `@nuxt/test-utils` (or a thin h3 harness) so
  claim/burst behavior of actual endpoints (rakeback, hack-op collect, sells, roster expand,
  colony loot) can be exercised end-to-end, not just their extracted helpers.

## Progress log

- 2026-07-17 — audit written; starting section A quick wins (A1, A2, A6).
- 2026-07-17 — A1, A2, A6 done (104 files, net −220 lines). Typecheck clean, 85 tests pass.
  Uncommitted, on `bugfix/toctou-races-and-secure-rng`.
- 2026-07-17 — wave 1 via parallel subagents: A3, A4, A5, A7, B4, B5, C3, C4, D1, D3 done;
  C5 keys fixed (component extraction open). Suite grew 85 → 127 tests. Solo verification:
  typecheck exit 0, 127 passed / 2 skipped. Working tree: 139 files, net −434 lines.
- 2026-07-17 — wave 3 via parallel subagents: B1, C6, D2 done; C1 phase 1 done (phase 2 = migrate
  the other five slots). Three of four agents were killed mid-task by transient API 529s and were
  resumed from their own transcripts rather than restarted — no work lost. Solo verification caught
  one issue no agent could see: B1's barrel collided with Nitro's recursive auto-import of
  `server/utils/`, registering 6 symbols twice; removed the barrel for concrete-module imports.
  Also dropped an orphaned `randomFloat` import left by wave 1's B5 conversion. Suite 226 → 293.
  Final: typecheck exit 0, 291 passed / 2 skipped, eslint 0 errors (228 warnings, 186 of them
  pre-existing `no-explicit-any`).
  Two agents corrected the audit itself: C1's `<BuyBonusModal>` was a phantom (no slot has one —
  they fire the spin straight from the button; `<AutoSpinModal>` is the real shared modal), and
  C6 showed the five-way engine split was wrong for the code as written.
- 2026-07-17 — wave 2 via parallel subagents: B2, B3, C2, C5 done, D2 partial (table games only).
  Two defects caught in solo verification that the per-agent test runs could not see:
  `useCasinoGame`'s `ref<THistory[]>` unwrapped its generic and failed typecheck (agents run tests
  but not `nuxt typecheck` — concurrent typechecks clash on `.nuxt`); and D2's blackjack spec
  asserted `'stood'` on two hands that `resolveGame` had already overwritten with the final
  outcome. Both fixed. Suite grew 127 → 226 tests. Solo verification: typecheck exit 0,
  224 passed / 2 skipped. Working tree: 140 files, net −524 lines.
