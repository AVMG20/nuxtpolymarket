# Hero Quest — Implementation Brief

Hero Quest is an idle auto-battler shipping as a **vertical slice inside polynux**, on the `hero-quest` branch. Design is locked across the documents in `docs/games/hero-quest/` — **gitignored and kept local**, like the other games' design docs, so edits here are not versioned. **Phases 0–3 are built** and the combat/progression loop is tuned (`implementation-plan.md` *Status*); what comes next is `open-items.md` *Suggested order*.

Platform conventions (Nuxt 4, Vue, Bun, Postgres/Drizzle, vitest, code style, slice layout) are **inherited from the platform and its root guidance — this file does not restate them.** What follows is only what's specific to Hero Quest.

---

## 1. Read this much, and no more

**Never load all the docs.** They cross-reference heavily, which is an asset when scoped and a liability otherwise — a full load reliably produces attempts to build systems four phases early.

Per task, load:

1. `implementation-plan.md` — build order, and the deferred list for the current phase
2. `index.md` — topic → doc/§ lookup; use it to fetch *sections*, not whole files
3. The 2–4 docs owning the system being built
4. `open-items.md` — before implementing anything numeric or contested

**`build-log.md` is not on that list.** It holds the record of everything that landed (#4–#29), split out of `open-items.md` on 2026-09-17 to stop the always-read doc carrying 604 lines of finished work. Read a single entry when you need the reasoning behind something already built; never load it to decide what to do next. A bare `#N` resolves to `open-items.md` first, `build-log.md` otherwise, and numbers are never reused.

`tech-architecture.md` is the biggest doc and is section-addressable. Fetch §3 for schema, §5 for routes, §2 for the shared layer — not the whole file.

**Art tasks read `art-style.md` first.** It is the art brief: procedural generation, the reference-video style, the review-round workflow, the chibi body, the cinematic skill recipe, backgrounds and the two-tier palette, plus what is done and what is open. `asset-list.md` / `asset-checklist.md` say *what* to draw; `art-style.md` says *how*.

---

## 2. Precedence when docs disagree

The docs were written across many sessions and revised in place. Conflicts exist. Resolve in this order:

| Question | Authority |
|---|---|
| Is this decided, or still open? | `open-items.md` — always. It is the freshest doc in the project, and now holds *only* what is open. |
| Does the code override a locked doc here? | `open-items.md`'s precedence table — the live list, with the full record in `build-log.md`. |
| How is it built (schema, routes, types, layering)? | `tech-architecture.md` |
| What is the rule / formula / number? | The owning system doc, per `index.md` §1 |
| What order do we build in, what's deferred? | `implementation-plan.md` |

**If a doc disagrees with `tech-architecture.md` §9, §9 wins** — that section is the running record of design consequences forced by the architecture, and it lists which cross-doc edits were applied.

**Never silently reconcile a contradiction.** Stop and surface it. Every past contradiction in this project was resolved by a deliberate decision, not by an implementer picking one.

---

## 3. Invariants — do not break these without asking

These are load-bearing and easy to violate by accident.

**Server authority.** All combat resolves server-side. The client is strictly an animation player driven by shared deterministic sim code and a seed. Gold and Gems are *shared balances across all polynux games* — the server never trusts a client-claimed earning or outcome. No exceptions for "just this one UI-only case."

**No background workers, no cron, no intervals.** Progress accrues via lazy settle (`settleHq`) called from `state.get.ts` and from every mutation that depends on accrued progress. Row lock is the mutex. If a feature seems to need a scheduled job, it doesn't — re-read `tech-architecture.md` §4a.

**Nothing numeric at a call site.** Every constant lives in `shared/utils/hero-quest/constants.ts` as a named export. This is what makes the balance script and playtest tuning a one-file edit. A magic number in `combat.ts` is a bug even if the value is correct.

**Big numbers are Decimal end to end.** `break_eternity.js` is the only new dependency this game adds. Enemy multipliers, stats, damage, HP, `heroXp`, and **Void Shards** are Decimal, persisted as `text` columns — Postgres `numeric` cannot hold `5^1000`, and the DB never does math on these. Safely plain integers: gacha levels, star/level, slot counts, shop levels, prestige count, Seal/Essence/Medal balances.

**`shared/` is pure.** No DB access, no auth, no `#server` imports. It runs in the browser. Both sides import it; only the server applies anything.

**Stable string IDs, never indices.** `champ_kaira`, `skill_coin_toss`, `world_the_void`. DB rows and loadouts reference IDs only. Reordering a content array must never change a save.

**Bosses require presence — read from page visibility, not a button.** A boss engages automatically while `document.visibilityState` is `visible` (`open-items.md` #25). The one exception: a boss that just beat the party (timeout or wipe) waits at its gate for the stage's challenge button instead of re-engaging (`open-items.md` #38). Offline settles, hidden tabs and closed apps never engage one, so Void Shards can never be earned from idle time. The 400 that `boss/engage.post.ts` returns when the client arrives a beat early is routine — do not soften it.

**Manual cast mode does not exist.** Every skill on every unit auto-fires the instant its cooldown completes. No toggle, no tap-to-fire, no ready-and-waiting state, no `manualMode` field. If you find a doc reference to a cast toggle, it is stale — flag it.

**One `hqCollection` table** for all four gachas, with a `system` enum over `contentId`. `applyDupe()`, `levelUp()`, and `craft()` are each written once and take `system` as an argument. Do not write per-gacha duplicates.

**This extends to the routes, as of Phase 3.** `gacha/pull.post.ts`, `gacha/craft.post.ts` and `gacha/buy-seals.post.ts` are each **one file** taking `system` in the body, per `tech-architecture.md` §5 — the Phase 2 `guild/*` copies were retired rather than triplicated. Two lookup tables are what make that possible: `content/registry.ts` maps `system` → content module (pure, so the client shares it), and `SEAL_COLUMN` / `ESSENCE_COLUMN` in `server/utils/hero-quest.ts` map `system` → Drizzle column, which is the one piece that cannot live in `shared/`. Likewise `loadout/set.post.ts` is the single live-equip route for all five loadout components; there is no per-system equip endpoint.

---

## 4. Untuned constants — the trap

`constants.ts` marks every constant with one of three states (see its header):

- **`// UNTUNED ╧`** — locked formula shape, placeholder value. **62** of them as of 2026-09-15, mostly the gacha, shop, economy and ability-magnitude layers. `rg '╧' shared/utils/hero-quest/constants.ts` is the list; `open-items.md` "Standing numeric tuning" says what each is waiting on.
- **`// TUNED ✓`** — measured on the campaign sim (`open-items.md` #22). **Moving one is a design decision**: its comment says what it trades against and what it is coupled to. Several only mean anything as a pair (`K` with `BASE_ENEMY_PWR`, `BASE_ATTACK_INTERVAL_SECONDS` with `SKILL_BASE_COOLDOWN_SECONDS`, `XP_BASE_PER_KILL` with `XP_TO_LEVEL_BASE`). Re-measure with `bun run sim:hero-quest --report=campaign` before and after.
- **No marker** — either derived (`STAT_PER_LEVEL_GROWTH`, `XP_STEP_EXPONENT`, `LEVELS_PER_STAGE`, `ENEMY_HP_STEP_EXPONENT`, …; never set directly — move its inputs) or specified by a doc. `GOLD_TENURE_CEILING` is **generated** from Colony and Xeno by `scripts/lib/economy-stages.ts`; regenerate, never hand-edit.

When you need a new constant:

- Define it in `constants.ts` with a placeholder and a `// UNTUNED ╧` comment
- **Do not invent a plausible value and move on.** A silently-chosen `K = 10` becomes load-bearing three phases later and nobody remembers it was a guess.
- Say which ones you placeholdered in your summary

---

## 5. Scope discipline

`implementation-plan.md` defines five phases. **Build only the current phase.** Each phase names its deferred systems explicitly; treat that list as a prohibition, not a suggestion.

The current phase is **Phase 4**, but it has not started. The battle stage comes first (`build-log.md` #34), and the playtest session and the Gold decisions (#23) were moved to the very end on 2026-10-02 (`open-items.md` *Suggested order*). Phase 4's systems are independent of each other; build the one asked for, not its neighbours. GPN, left over from Phase 3, is built (`open-items.md` #28).

The failure this rule was written against still generalises: building a content system (a gacha, a raid) on top of a loop nobody has validated means tuning it against numbers that will move. The loop is now tuned on the sim but has been felt in only one logged session.

---

## 6. Content authoring

Rosters are deliberately partial:

| System | Full roster | Status |
|---|---|---|
| Class nodes | 16 | **All 16 — done.** |
| Skills | 36 | **All 36 — done.** Phase 3; the §4 draft transcribed verbatim |
| Gear | 36 | **All 36 — done.** Phase 3; fully named by the epithet table alone |
| Champions | 48 | **All 48 — done.** Filled during the ability-effects pass |
| Artifacts | 48 | **All 48 — done**, with the full 33-effect pool. Named 2026-09-15 (`artifacts-dig-site-gacha.md` §3a) |
| Worlds | 10 | **Named, with themes** (2026-09-15, `core-progression-and-prestige.md` §5). Art and enemy kits not designed. |

**Every roster is now structurally complete, and that is what retired `foldToAvailableRarity`.** The helper folded a rolled rarity down to the nearest rarity a partial roster populated; with all four systems covering all six rarities it was the identity function everywhere, so it is **deleted** (`implementation-plan.md`, Phase 3). `content.spec.ts` asserts the coverage per system, so "no fold is needed" is a tested claim rather than a comment. If a future roster ships partial, the reasoning for reintroducing it — and why rounding *down* was the right repair — is preserved in a comment where it used to live in `gacha.ts`.

**Champions are complete.** The roster was filled deliberately during the ability-effects pass — the deciding argument was that a complete roster is what lets the fold be retired, and that the rarity-overlap goal is served by the *small* 7-ability pool rather than by more content. All 48 exist, assembled from two tables (`ROSTER`, `ABILITY_SLOTS`) so the structural rules are properties of one distribution.

**Artifacts and Worlds are named.** Both naming passes landed 2026-09-15: Artifacts in `ARTIFACT_NAMES` (relics dug out of the ten worlds, `artifacts-dig-site-gacha.md` §3a), Worlds in `content/worlds.ts`. The rules that keep names from colliding — unique, no Champion given name or title reused, no Artifact named after a pool effect, no boss name starting with "The" — are specs, so a later rename that breaks one fails the build. Names are display only; saves reference IDs, which must never change. The per-Artifact *effect assignment* is still a distribution rather than an authored choice, and is a legitimate thing for a later pass to re-cut.

**World 10 must be named The Void**, or Void Shards needs renaming.

Structural invariants from the docs (drop-rate rows sum to 100%, ability reuse ≤ 3 per archetype, effect-line count matches rarity, every loadout-referenced ID exists) go in `test/hero-quest/content.spec.ts` as vitest specs — not boot asserts.

---

## 7. Known-unstable ground

- **The loop is tuned as a pacing model — change it as one.** One index `n = p×100 + (w-1)×10 + (s-1)`, one base `ENEMY_STEP_BASE = 1.08`, no prestige difficulty reset. Hero PWR/DEF/VIT track enemy DEF/PWR exactly (`ENEMY_PACE_RATIO = 1.0`), so the mitigation clamp never makes walls; enemy HP rides its own exponent, and **walls come from `FIGHT_LENGTH_DRIFT` at boss timers**. LCK is off the level curve. A first prestige for a party of three is about a week; a solo account does not prestige. Full derivation: `core-progression-and-prestige.md` §1; record and open consequences: `open-items.md` #22. Anything that lengthens fights (enemy kits, heals, more escorts) has to be re-measured on the campaign walk. The curve stays behind `settle.enemyMultiplier()` / `enemyHpMultiplier()`.
- **Gold is paced on wall-clock account age** — `BASE_GOLD × min(1.017^n, tenureCeiling(age))`, ceiling generated from Colony and Xeno at 0.85× (`gold-economy.md` §3a). `PRESTIGE_GOLD_FACTOR`, `GOLD_PRESTIGE_CAP` and the calendar anchors are gone. ⚠ **Three consequences are unreconciled** — lost anchors (#23.1), a stale Seal ladder (#23.2) and very low first-week income (#23.3). The tenure ceiling was regenerated against the measured kill rate on 2026-09-16, which raised it 12× and left the walk's income unchanged, since it is progression-bound throughout; the progression half is the open one. Do not build economy features on top of these numbers without surfacing that.
- **Settles carry a part-kill** (`hq_state.kill_fraction`, in kills, `[0, 1)`), and the DB connection is pinned to UTC. Anything that resets run position must zero `killFraction` too (`build-log.md` #24), and `recoverySeconds`, the wipe recovery still owed (`open-items.md` #37).
- **Hero level persists across prestige and class switches.** `heroLevel`/`heroXp` are **not** reset by `settleHq`'s prestige path — it zeroes only the run-position group.
- **Locked docs that code has overridden**, each recorded rather than silently reconciled: Champion and Artifact names generated against guidance that deferred them (#17, #18.2), the four gacha tabs collapsed to Gacha + Collections (#20), the account-age Gold curve (#23), automatic boss engagement (#25), the free Seal grant removed (#29). **`open-items.md`'s precedence table is the live list** — read it before trusting a rule in a system doc; where they disagree, it wins.
- **`gold-economy.md` supersedes older Gold assumptions** in `gacha-shared-system.md`, `economy-and-currencies.md`, `skills-gacha.md`, and `core-progression-and-prestige.md`. Any flat 1,000,000-Gold Seal price you encounter is superseded by the daily escalating ladder (`gold-economy.md` §7).

---

## 8. Starting a phase

A good kickoff prompt names the phase, the docs, and the prohibition. The one used for Phase 1, kept as the template:

> Build Phase 1 (Playable Core Loop) per `implementation-plan.md`.
> Docs in scope: `core-progression-and-prestige.md`, `classes-and-combat.md`, `idle-mechanics.md`, `gold-economy.md` §3–4 §6, `tech-architecture.md` §4a–4c §7.
> Use `index.md` to locate anything else; ask before loading a doc outside this list.
> Do NOT build: any gacha, any raid, Arena, Traits, Loadouts, Gear, Holidays, GPN, Battle Speed, leaderboards, evasion.
> Read `CLAUDE.md` §3 before writing code, and §4 before writing any constant.

For a Phase 4 system, scope it the same way — e.g. Traits: `traits.md`, `classes-and-combat.md` §7 (evasion), `tech-architecture.md` §3 §5; do NOT build Arena, Raids or Holidays.

Phase 0 and Phase 1 were the proving ground. The loop is tuned; whether it is fun is still one logged session's worth of evidence.
