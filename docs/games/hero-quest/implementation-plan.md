# Phased Implementation Plan

A build order for taking the 18 locked design docs to a shippable game, structured so each phase produces something **playable and testable on its own** rather than a pile of half-finished systems.

The governing principle: **the core loop is the risk.** Everything else in this project — 4 gachas, 5 raids, Arena, Traits, Loadouts — is additive content layered onto a loop that either feels good or doesn't. Build the loop first, play it, and only then decide how much of the rest is worth building.

## Status — 2026-10-09

| Phase | State |
|---|---|
| **0 — Foundations** | ✅ Built. |
| **1 — Playable Core Loop** | ✅ Built, and the loop is **tuned** on the campaign sim (`open-items.md` #22). One playtest session logged (`playtest-notes.md`). Bosses engage automatically while the tab is visible — a deviation from this phase's manual-engage design (`open-items.md` #25). |
| **2 — Champions** | ✅ Built, with the **full 48-Champion roster** rather than the 8–12 planned, and the full ability-effects pass (`open-items.md` #12–#17). |
| **3 — Remaining gachas + Loadouts** | ✅ Built, including **GPN** (landed 2026-09-15, `open-items.md` #28; the leaderboard aggregate and Defense GPN came with the Arena, #52). Also landed alongside: the dev playtest harness, the Gacha/Collections navigation, the in-game wiki, stat attribution and a projected battle screen (#19–#21, #26). |
| **4 — Endgame** | **Under way.** Battle Speed built 2026-10-04 (`build-log.md` #44), all five Raids 2026-10-05 (`build-log.md` #46), Traits 2026-10-09 (`build-log.md` #51), bringing evasion into combat and GPN, the Arena the same day (`build-log.md` #52) with Defense GPN and the GPN leaderboard aggregate, and the Holiday gifts and `loadouts.md` §4's per-raid auto-apply 2026-10-09 (`build-log.md` #53, #54), with GPN carried over from Phase 3. The Arena's preferred attack Loadout is not wired to the auto-apply yet. |
| **5 — Content & tuning** | Partly done early: every roster is structurally complete (Artifacts and Worlds were named 2026-09-15), and the combat/progression constants are tuned. **World art is restyled and locked** (`art-style.md`), and the enemy-kit question is answered: regular enemies get no abilities, and bosses' specials are real combat effects since 2026-10-08 (`build-log.md` #45). The prestige→calendar Gold mapping below is **retired** — Gold reads account age instead (`gold-economy.md` §3a). |

**What comes next** is `open-items.md`'s *Suggested order*: the quick calls and the rest of Phase 4, with the playtest and the Gold decisions (#23) last, by the user's call.

---

## Phase 0 — Foundations (no gameplay yet)

**Goal:** the shared math layer exists, is fully tested, and the balance script runs — before a single table or route.

This is the platform doc's own scaffolding order, and it's the right one: `shared/utils/hero-quest/` is pure, has no DB or auth dependencies, runs in a test harness, and is where every number in the game actually lives.

| Build | Source |
|---|---|
| `constants.ts` — every named constant from every doc, placeholder values where untuned | all docs; `open-items.md` has the consolidated list |
| `numbers.ts` — `break_eternity.js` wrappers, string (de)serialization, display formatting | `tech-architecture.md` §2 |
| `content/classes.ts` — 16 nodes, stat spreads, skill definitions | `classes-and-combat.md` §1–2 |
| `stats.ts` — the stat pipeline: (content, playerState) → final party stats | `tech-architecture.md` §2 |
| `combat.ts` — damage, clamped mitigation, crit, evasion, HP, DPS derivation | `classes-and-combat.md` §7 |
| `settle.ts` — rate-based accrual, `secondsPerKill` with the floor, stage advancement, boss-gate stop | `idle-mechanics.md` §4–5, `gold-economy.md` §4 |
| `test/hero-quest/settle.spec.ts` + `combat` tests | `tech-architecture.md` §6 |
| `scripts/hero-quest-balance.ts` | `tech-architecture.md` §6 |

**Why the balance script belongs here and not later:** the moment `settle.ts` exists, you can print time-to-boss curves and offline earnings tables *without any game around them*. That's how the untuned constants get their first real values, and it costs almost nothing to build at this point.

**Done when:** you can run the balance script and see a projection table for "how long does World 1 take at prestige 0," with no UI, no database, and no server.

---

## Phase 1 — The Playable Core Loop ⭐ *the prototype*

**Goal:** a real, playable idle auto-battler. Hero fights, kills accrue, stages advance, bosses gate, prestige resets and restarts harder.

**In scope:**

| System | Docs | Notes |
|---|---|---|
| Hero + 16-node class tree | `classes-and-combat.md` §1–5 | Full tree; it's only 16 nodes and 16 skills |
| Combat resolution | `classes-and-combat.md` §7 | PWR damage, mitigation, crit, HP. **Skip evasion** — nothing sources it until Traits (Phase 4) |
| Formation (3 front / 3 back) | `classes-and-combat.md` §6 | |
| Core progression: 10 worlds × 10 stages | `core-progression-and-prestige.md` §1–2 | Placeholder art/enemy names — the *curve* is what's being tested |
| Boss / super-boss gates, soft-fail fallback | `core-progression-and-prestige.md` §2 | |
| Prestige + Void Shards + prestige shop | `core-progression-and-prestige.md` §3–4 | Hero level persists — don't reset it |
| Idle: auto-battle, offline accrual, cap + efficiency | `idle-mechanics.md` §1–2, §4–5 | |
| Gold economy | `gold-economy.md` §3–4, §6 | |
| Server authority: lazy settle, seeded boss fights | `tech-architecture.md` §4a–4c | |
| Minimal client: battle scene, run position, prestige screen | `tech-architecture.md` §7 | |

**Explicitly deferred:** all 4 gachas, all 5 raids, Arena, Traits, Loadouts, Gear, Holidays, GPN, Battle Speed, leaderboards.

**Why no gacha at all in Phase 1 — this is the important call.** It's tempting to include Champions since the party is central. Resist it: a gacha is a *content* system (48 unique kits) bolted onto a *loop* system, and building it early means tuning drop rates against a loop you haven't validated. A Phase 1 Hero fighting solo through 10 worlds tells you everything you need to know about whether the enemy curve, the boss gates, the offline pacing, and the prestige rhythm actually feel good. Those are the answers that make every later phase cheaper.

**Done when:** you can play for an hour, hit a boss wall, farm past it, clear World 10, prestige, and feel the steamroll. **Stop here and actually play it before continuing.**

### What Phase 1 is really testing

These are the design assumptions most likely to be wrong, and the reason the phase exists. *(Status 2026-09-15: 1 is tuned on the sim but unfelt; 2 is answered by construction in the tuning pass; 3 changed shape — bosses auto-engage while visible; 4 is unchanged at 30 kills and ~a week per prestige for a party of three. See `playtest-notes.md`.)*

1. **Does `b = 1.08` per stage feel right?** The *shape* is settled — the continuous `b^n` curve replaced `5^prestige × 1.6^world × 1.15^stage` (`open-items.md` #10), closing backlog item 9. What Phase 1 tests is the value, and whether losing the prestige difficulty dip costs the run its rhythm. `bun run sim:hero-quest --report=campaign --sweep=ENEMY_STEP_BASE=...` is the slider.
2. **Can an uncapped, now-*persistent* Hero level actually keep pace with a ×T-per-prestige ceiling?** `classes-and-combat.md` §4 flags that flat-additive per-level growth **provably cannot** on its own, and the campaign sim now demonstrates it: at `STAT_PER_LEVEL_GROWTH = 1.0` a solo Hero stalls in World 3 and never completes a prestige. Phase 1 either confirms the other power sources carry it, or forces a change to the level curve.
3. **Is boss-gating-requires-presence tolerable?** Prestige currency can never be earned offline by design. Fun, or annoying?
4. **Is 30 kills per stage × 100 stages the right run length?**

---

## Phase 2 — The First Gacha (Champions)

**Goal:** the party exists, and the collection loop turns.

| Build | Docs |
|---|---|
| Shared gacha mechanics: rarity, leveling 1–10, drop table, dupes/stars, crafting | `gacha-shared-system.md` (all) |
| Champions: 4 archetypes, PWR model, passive collection bonus, targeting/formation | `champions-guild-gacha.md` |
| Guild Seals, Champion Essence, the daily Gold ladder | `economy-and-currencies.md` §5–6, `gold-economy.md` §7 |
| Party slot progression 2→5 via prestige shop | `champions-guild-gacha.md` §1 |
| Content: **8–12 Champions, not 48** | — |

**On the roster:** author 2 per archetype at Common/Rare/Mythic only. That's enough to exercise every mechanic — rarity multipliers, 1 vs 2 vs 3 abilities, archetype passives, dupe leveling — at a fraction of the authoring cost. The remaining ~36 are pure content, addable any time with zero code change.

**Why Champions first among the four gachas:** it's the only one that changes the *shape* of combat (party size, formation, targeting, multiple actors). Gear/Skills/Artifacts are all stat and effect modifiers on an existing party — much cheaper once this exists.

**Done when:** you can pull, level via dupes, field a party of 3, and feel the collection loop.

---

## Phase 3 — The Remaining Gachas

All three reuse Phase 2's shared machinery. Build in this order — cheapest first:

1. **Gear (Forge)** — the simplest system in the project. 6 slots, 1 item per slot per rarity, single-stat magnitude only, fully named already, no ability pool to author. Nearly free once `hqCollection` exists.
2. **Skills (Training Grounds)** — 36 skills, full draft roster already written. Adds equippable actives/passives to the Hero.
3. **Artifacts (Dig-site)** — 48 items over a 33-effect pool, party-wide passives.

Plus: Loadouts (`loadouts.md`) lands naturally here, since it's the thing that manages all the equipping Phase 3 creates.

**Also in scope: retiring `foldToAvailableRarity`** (`open-items.md`, Phase 2 carry-over). It is scaffolding that folds a rolled rarity down to the nearest rarity the shipped roster actually populates — needed because Phase 2's Champions cover only Common/Rare/Mythic. Each gacha added here needs its own `hasContent` predicate wired in, so the decision cannot be dodged:

- **Gear** ships 1 item per slot per rarity, i.e. fully populated. The fold is the identity, and Gear should simply not call it.
- **Skills** and **Artifacts** — decide per roster. If either ships partial, it keeps folding on the same terms as Champions (strictly stingier than the finished table, never richer).

The helper is deleted outright the day every roster is complete; until then it stays, and every caller that no longer needs it stops calling it rather than passing an always-true predicate.

**Done when:** all four gachas run, Loadouts bundle the swapping, and GPN (`global-power-number.md`) can finally be computed meaningfully — it needs real gear and collections to read.

---

## Phase 4 — Endgame Systems

Everything that assumes a mature account. Each is genuinely independent — build in whatever order appeals, or skip any of them.

| System | Adds | Note |
|---|---|---|
| **Raids** (`raid-system.md`) | 5 ladders, Keys, 4 fight types, quick-clear | **Built 2026-10-05** (`build-log.md` #46). Biggest of the four; `rampaging_boss` is its own mini-system |
| **Traits** (`traits.md`) | 5 slots, roll/lock, 8×9 value tables, 5 Sets | **Built 2026-10-09** (`build-log.md` #51). Brought evasion into the game — the `1−EVA` accuracy check and GPN's EVA term are live |
| **Arena** (`arena.md`) | Async PvP, Defense GPN, Elo, Medals, shop, seasons | Needs a real player population to be meaningful — arguably last |
| **Holiday Events** (`holiday-events.md`) | Calendar gift claims | **Gifts built 2026-10-09** (`build-log.md` #53). Smallest; a day's work |
| **Battle Speed** (`idle-mechanics.md` §3) | Gem-purchased time dilation | **Built 2026-10-04** (`build-log.md` #44). Could pull earlier if playtesting is slow — it makes testing faster too |

**Passive Skill Tree** (backlog item 3) is unbuilt design, not deferred implementation — it needs its own design session before it can be scheduled at all.

---

## Phase 5 — Content Completion & Tuning

The long tail, once every system is proven:

- Full rosters: 48 Champions, 48 Artifacts (Skills and Gear are already fully drafted)
- **World & enemy design** — ~~10 themes, enemy rosters, boss identities~~ named 2026-09-15 (World 10 kept as The Void); art and enemy kits remain.
- The real balance pass: every constant in `open-items.md`, calibrated against actual play data rather than projections
- ~~`gold-economy.md` §9's prestige→calendar mapping, re-derived now that Hero level persists~~ — retired; Gold is paced on account age (`gold-economy.md` §3a). Re-derive the Seal ladder against it instead (`open-items.md` #23).

---

## Two things to decide before Phase 0 — **both resolved**

1. ~~The game's real name~~ **Resolved: Hero Quest** — applied throughout `tech-architecture.md` as `hq` (tables) / `hero-quest` (directories, routes). *(Worth a quick trademark/discoverability check before this is public-facing — HeroQuest is an existing, actively-republished board game with mobile ports. Easy to swap later if needed; every occurrence is the same `hq`/`hero-quest` find-replace.)*
2. ~~`hqCollection`: one table or four?~~ **Resolved: single table**, `system` enum (`'gear'|'champion'|'skill'|'artifact'`) over `contentId` — locked in `tech-architecture.md` §3. Phase 2 (Champions) builds the first real usage; Phase 3 (Gear/Skills/Artifacts) is close to zero schema work as a result, just new `system` values.

---

## How to brief Claude Code

**Don't hand it all 18 docs.** Per phase, give it: the docs in that phase's scope, plus `index.md` for cross-references, plus an explicit "these systems are deferred, do not build them" list. The design docs are unusually complete and cross-referenced — that's an asset when scoped, and a liability when it invites building everything at once.

Phase 0 and Phase 1 together are the real proving ground. If the loop is fun with a solo Hero and placeholder enemies, everything after is content and layering. If it isn't, you'll have found out after two phases instead of five.
