# Design Doc Index

Master navigation for the project. **26 files**: 18 design docs (all **Locked** except `idea-backlog.md`, a running list), 7 project-meta docs catalogued in §1a, and `CLAUDE.md`. *Refreshed 2026-09-15 against the built game; the folder is gitignored and local.*

> **Read first:** `open-items.md` lists everything still open — design questions, undesigned passes, and the standing constant-tuning list. Anything below marked ⚠️ points at a section where code has overridden a locked doc; `open-items.md`'s precedence table records each (#17, #18.2, #20, #23, #25, #29).
>
> **`build-log.md` is the record of what landed** and why it was built that way — split out of `open-items.md` on 2026-09-17. It is **not** on the per-task reading list: read an entry when you need the reasoning behind something already built, never to find out what to do next. A bare `#N` resolves to `open-items.md` first, `build-log.md` otherwise.

---

## 1. Document Catalog

Ordered roughly by dependency — earlier docs are prerequisites for later ones.

| # | Doc | Owns | Depends on |
|---|---|---|---|
| 1 | `core-progression-and-prestige.md` | Enemy curve, 10×10 run structure, stage archetypes, fail states, prestige reset table, prestige shop | — |
| 2 | `classes-and-combat.md` | 16-node class tree, 6-stat spread (+HP, +EVA), cooldown system, damage/crit/HP math, targeting, formation | 1 |
| 3 | `gacha-shared-system.md` | Rarity tiers, gacha leveling 1–10, drop rates, dupes/stars, crafting, Essence naming | — |
| 4 | `champions-guild-gacha.md` | 48 Champions, 4 archetypes, PWR model, 28-ability pool, naming, passive collection bonus | 2, 3 |
| 5 | `skills-gacha.md` | Training Grounds, 36 skills (18 Active / 18 Passive), universality rules, slot unlocks, UI split | 2, 3 |
| 6 | `artifacts-dig-site-gacha.md` | 48 Artifacts, 4 effect categories, 33-effect pool, party-wide passives, stacking | 3, 4 |
| 7 | `gear-equipment.md` | The Forge (4th gacha), 6 Hero slots, 36 pieces, single-stat model, rarity progression guarantee, manual equip | 2, 3 |
| 8 | `idle-mechanics.md` | Idle vs active, auto-battle, Battle Speed, offline formula, offline cap/efficiency, boss wall | 1, 2 |
| 9 | `gold-economy.md` | Gold curve, account-age tenure ceiling, throughput floor, Seal price ladder, burst denomination | 1, 3, 8 |
| 10 | `economy-and-currencies.md` | Consolidated currency list, Gold/Gems/Void Shards/Seals/Essence/Trait Gems/Keys/Medals | 1, 3, 9 |
| 11 | `raid-system.md` | 5 raids, level ladders, Keys, quick-clear, 4 fight types, rampaging boss | 4–7, 10 |
| 12 | `traits.md` | 5 trait slots, roll/lock, 8 stats × 9 grades, 5 Sets, save slots | 2, 10, 11 |
| 13 | `loadouts.md` | Loadout snapshot contents, save/apply, 2→10 slots, per-raid auto-apply | 4–7, 11 |
| 14 | `global-power-number.md` | GPN formula, EHP definition, live-snapshot behavior, what flows in | 2, 4, 8 |
| 15 | `arena.md` | Async PvP, Defense GPN, matchmaking, Training Dummy, Elo, Medals, Arena Shop, seasons | 13, 14 |
| 16 | `holiday-events.md` | Holiday calendar, claim windows, gift bundle structure | 9, 10 |
| 17 | `tech-architecture.md` | Integration path, shared logic layout, schema, server authority, API surface, tests, client | all |
| 18 | `idea-backlog.md` | Running idea list with implementation checkboxes | — |

---

## 1a. Project-Meta Docs

Not design docs — they describe the *state* of the project rather than the game. Unnumbered deliberately, so the dependency numbering above stays stable.

| Doc | Owns | When to read it |
|---|---|---|
| `index.md` | This file — catalog, topic lookup, currency/formula indexes, roster sizes | Any time you need to find where something is specified |
| `open-items.md` | Every open question, undesigned pass, and untuned constant, plus the precedence table for code that overrides a locked doc. **The freshest doc in the project**, and now only what is still open | Before implementing anything numeric or contested; before starting a design session |
| `build-log.md` | What landed and why — the numbered record #4–#29, split out of `open-items.md` 2026-09-17 | Only when you need the reasoning behind something already built. **Never to decide what to do next** |
| `implementation-plan.md` | 5-phase build order, per-phase scope + deferral lists, how to brief Claude Code | Before writing any code |
| `asset-list.md` | Full art/VFX/icon/background production list — **every count is now a number** (2026-09-17) | Art production planning. Enemy variants, styling and animation states closed 2026-09-17; only world-background art direction is still owed. An enemy-kit yes (#6) would add a fifth state to every enemy rig |
| `asset-checklist.md` | The same production list, itemised — **665 checkboxes**, one per deliverable, named from the live content modules (2026-09-17) | Tracking art production. Generated from `asset-list.md`, which stays the source of truth for *why* each count is what it is; regenerate if a roster or a count moves |
| `playtest-notes.md` | Raw session observations, the sim's falsifiable predictions, and what is known-inert so it isn't chased | While playing; and before any tuning pass, since it holds the *why* behind what `open-items.md` decided |
| `sim-tool.md` | `sim:hero-quest` and `balance:hero-quest` usage — reports, flags, overrides, sweeps, caveats | Before measuring or tuning anything |
| `idle-game-architecture.md` | The polynux idle-game platform conventions this slice inherits | When a platform convention is in question |

`CLAUDE.md` is the implementation brief for Claude Code, loaded from the repo root's `CLAUDE.md`.

---

## 2. Topic → Location Lookup

### Core loop & progression
| Topic | Doc | § |
|---|---|---|
| Enemy scaling `b^n` (continuous index) | `core-progression-and-prestige.md` | §1 |
| Hero pacing model — paced stat curves, enemy HP exponent, `FIGHT_LENGTH_DRIFT`, measured campaign | `core-progression-and-prestige.md` §1, `open-items.md` #22 | |
| Elite / boss / super-boss stat modifiers | `core-progression-and-prestige.md` | §1 |
| Stage archetypes (waves / boss / elite / super boss) | `core-progression-and-prestige.md` | §2 |
| Kill count (`BASE_KILL_COUNT` = 30), boss timer (30s) | `core-progression-and-prestige.md` | §2 |
| Fail state / soft fallback | `core-progression-and-prestige.md` | §2 |
| ⚠️ Automatic boss engagement while the page is visible | `idle-mechanics.md` §2, `tech-architecture.md` §4b, `open-items.md` #25 | |
| What resets on prestige (run position only — level persists) | `core-progression-and-prestige.md` | §3 |
| Void Shards earning formula | `core-progression-and-prestige.md` §4, `economy-and-currencies.md` §3 | |
| Prestige shop track list | `core-progression-and-prestige.md` | §4 |
| World themes, names and enemy rosters (fixed pool, no reskins) | `core-progression-and-prestige.md` | §5 |
| Class-switch rules at prestige (no level reset) | `classes-and-combat.md` | §5 |

### Combat
| Topic | Doc | § |
|---|---|---|
| 16-node class tree + skill per node | `classes-and-combat.md` | §1 |
| The Ascendant, the capstone class (17th node) — design complete, art locked | `capstone-class.md`, `build-log.md` #43 | |
| 6 stats (PWR/SPD/LCK/IMP/VIT/DEF) + per-class spreads | `classes-and-combat.md` | §2 |
| Flat cooldowns, SPD reduces cooldown *and* autoattack interval | `classes-and-combat.md` | §3 |
| Everything auto-casts — no manual mode *(toggle deleted game-wide, `tech-architecture.md` §9.2)* | `classes-and-combat.md` | §3 |
| Leveling vs specializing; geometric level curve, LCK off the curve | `classes-and-combat.md` | §4 |
| Formation, front/back rows | `classes-and-combat.md` §6, `champions-guild-gacha.md` §8 | |
| Damage formula + clamped mitigation (PWR-based), `MIN_DAMAGE` floor, `K` × enemy PWR | `classes-and-combat.md` | §7 |
| Status effects — stacking vs refresh, live stats in boss fights | `classes-and-combat.md` | §7 |
| Crit (LCK linear, IMP damage, overflow conversion) | `classes-and-combat.md` | §7 |
| HP = BASE_HP + VIT × HP_PER_VIT, one pool per stage attempt | `classes-and-combat.md` | §7 |
| Multi-strike (Beginner double, Hunter triple, Beast Master quad) | `classes-and-combat.md` | §7 |
| Autoattack targeting — Hero paths | `classes-and-combat.md` | §7 |
| Autoattack targeting — Champion archetypes | `champions-guild-gacha.md` | §8 |
| Champion damage/heal/debuff via PWR | `champions-guild-gacha.md` | §2 |

### Gacha (all four)
| Topic | Doc | § |
|---|---|---|
| 6 rarity tiers + colors | `gacha-shared-system.md` | §1 |
| Gacha leveling curve, pulls-to-level table | `gacha-shared-system.md` | §2 |
| Drop rate table per gacha level | `gacha-shared-system.md` | §3 |
| Pull cost, 10-pull discount, extra-Seal ladder | `gacha-shared-system.md` §4, `gold-economy.md` §7 | |
| No pity | `gacha-shared-system.md` | §5 |
| `dupesToLevelUp`, stars, 1,066-dupe max | `gacha-shared-system.md` | §6 |
| Crafting + Essence value/cost (×5 per tier) | `gacha-shared-system.md` | §6 |
| Champions: 48 roster, archetypes, ability pool | `champions-guild-gacha.md` | §1, §6 |
| Champions: naming convention | `champions-guild-gacha.md` | §5 |
| Champions: passive collection bonus → Hero | `champions-guild-gacha.md` | §7 |
| Skills: 36 roster, Active/Passive split | `skills-gacha.md` | §3, §4 |
| Skills: universality rule (path-agnostic buckets) | `skills-gacha.md` | §3 |
| Skills: equip rules, no duplicate slotting | `skills-gacha.md` | §5 |
| Skills: square vs circle UI convention | `skills-gacha.md` | §7 |
| Artifacts: 4 categories, 33-effect pool | `artifacts-dig-site-gacha.md` | §2, §3 |
| Artifacts: named roster (48 relics, by rarity and category) | `artifacts-dig-site-gacha.md` | §3a |
| Artifacts: stacking rules, no set bonuses | `artifacts-dig-site-gacha.md` | §4 |
| Gear: 6 slots + stat mapping | `gear-equipment.md` | §1 |
| Gear: `equippedBonus` / `passiveBonus` formulas | `gear-equipment.md` | §2, §3 |
| Gear: rarity progression guarantee (6× ceiling) | `gear-equipment.md` | §2 |
| Slot progression 2→5 (Champion / Skill / Artifact) | `champions-guild-gacha.md` §1, `skills-gacha.md` §6, `artifacts-dig-site-gacha.md` §7 | |

### Economy
| Topic | Doc | § |
|---|---|---|
| Full currency list | `economy-and-currencies.md` | §1 |
| Gold curve (`1.017^n`, `min`'d against the ceiling) | `gold-economy.md` | §3 |
| ⚠️ Tenure ceiling — Gold paced on account age, generated from Colony/Xeno | `gold-economy.md` §3a, `open-items.md` #23 | |
| Throughput floor `MIN_SECONDS_PER_KILL` | `gold-economy.md` §4, `idle-mechanics.md` §4 | |
| Gold% stacking policy | `gold-economy.md` | §5 |
| Gold bursts denominated in earn-time | `gold-economy.md` | §6 |
| Per-gacha daily Seal price ladder | `gold-economy.md` | §7 |
| Gambler's Strike wealth-factor redesign | `gold-economy.md` §8, `skills-gacha.md` §4¹ | |
| Gold sinks | `economy-and-currencies.md` | §2 |
| Void Shards source/sinks | `economy-and-currencies.md` | §3 |
| Gems source/sinks | `economy-and-currencies.md` | §4 |
| Seal earn sources (milestone / daily / raid) | `economy-and-currencies.md` | §5 |
| Milestones: tracks, formulas, claim | `build-log.md` #48, `open-items.md` #48 | |
| Essence source/sink | `economy-and-currencies.md` | §6 |
| Trait Gems | `economy-and-currencies.md` | §8 |
| Raid Keys (×5) | `economy-and-currencies.md` §9, `raid-system.md` §3 | |
| Arena Medals | `economy-and-currencies.md` §10, `arena.md` §5 | |

### Idle & offline
| Topic | Doc | § |
|---|---|---|
| Idle-native vs active systems | `idle-mechanics.md` | §1 |
| Auto-battle, stage auto-advance | `idle-mechanics.md` | §2 |
| Battle Speed tiers, durations, Gem prices | `idle-mechanics.md` | §3 |
| Battle Speed scope — everywhere except Arena; offline applies to wave accrual only | `idle-mechanics.md` §3, `tech-architecture.md` §4b/§9.3 | |
| Offline formula, cap (8→72h), efficiency (50→100%), part-kill carry | `idle-mechanics.md` | §4 |
| Upgrade cost curves (doubling / 1.72^) | `idle-mechanics.md` | §4 |
| Boss wall — offline never engages a boss | `idle-mechanics.md` | §5 |
| Boss specials — shapes, cadence, control resist; the art per special | `build-log.md` #45, `art-style.md` | §5b |

### Endgame & side systems
| Topic | Doc | § |
|---|---|---|
| Raid roster, pairing, fight types | `raid-system.md` | §1, §7 |
| Raid difficulty ladder | `raid-system.md` | §2 |
| Keys: 3/day, bank 21, win-gated | `raid-system.md` | §3 |
| Quick-clear | `raid-system.md` | §4 |
| Raid rewards formula | `raid-system.md` | §6 |
| Rampaging Boss (unkillable, level-on-damage) | `raid-system.md` | §7 |
| Trait roll mechanics + cost `5 + locked×5` | `traits.md` | §2 |
| Trait grade probability table | `traits.md` | §2 |
| Trait stat values by grade | `traits.md` | §4 |
| Trait Sets (5) | `traits.md` | §5 |
| Trait save slots (Gems 250/750/1250) | `traits.md` | §6 |
| Loadout contents (5 components) | `loadouts.md` | §1 |
| Loadout slots 2→10, Gems | `loadouts.md` | §3 |
| Per-raid loadout auto-apply | `loadouts.md` | §4 |
| GPN formula `DPS × EHP` | `global-power-number.md` | §2 |
| What flows into GPN | `global-power-number.md` | §4 |
| GPN as built (zero-DEF DPS, computed on read, battle-screen display) | `global-power-number.md` | *As built* |
| Collection passives — every owned Champion, Gear piece, Passive Skill and Artifact raises stats | `champions-guild-gacha.md` §7, `gear-equipment.md` §3, `skills-gacha.md` §5, `artifacts-dig-site-gacha.md` §1 | |
| Arena defense loadout, Defense GPN | `arena.md` | §1, §2 |
| Training Dummy fallback | `arena.md` | §2a |
| Arena attempts (5/day, non-banking) | `arena.md` | §3 |
| Asymmetric Elo | `arena.md` | §4 |
| Arena Shop, seasons, battle log, leaderboard | `arena.md` | §6–9 |
| Holiday calendar + claim window | `holiday-events.md` | §1, §2 |
| Holiday gift bundle structure | `holiday-events.md` | §3 |

### Implementation
| Topic | Doc | § |
|---|---|---|
| Platform integration path | `tech-architecture.md` | §1 |
| `shared/utils/hero-quest/` layout, big numbers | `tech-architecture.md` | §2 |
| Database schema | `tech-architecture.md` | §3 |
| Lazy settle contract | `tech-architecture.md` | §4a |
| Online/offline threshold | `tech-architecture.md` | §4b |
| Seeded boss fights + client replay | `tech-architecture.md` | §4c |
| Arena resolution | `tech-architecture.md` | §4d |
| API route list | `tech-architecture.md` | §5 |
| Tests + balance script | `tech-architecture.md` | §6 |
| Client pages + battle stage (Canvas 2D); as-built battle projection | `tech-architecture.md` | §7 |
| Stat attribution (`explain.ts`, `--report=stats`) | `tech-architecture.md` §2, `open-items.md` #26 | |
| Sim and balance tooling | `sim-tool.md` | |
| Dev playtest harness | `open-items.md` | #19 |

---

## 3. Currency Index

| Currency | Type | Source | Sink | Spec |
|---|---|---|---|---|
| **Gold** | Platform, universal | Idle kill farming (own bounded curve) | Seal ladder; Arena Shop purchases | `gold-economy.md`, `economy-and-currencies.md` §2 |
| **Gems** | Platform, universal | Milestones, Holiday gifts, Arena Shop | Battle Speed, Loadout slots, Trait save slots, Arena refresh/attempts | `economy-and-currencies.md` §4 |
| **Void Shards** | Prestige | Full World 10/Stage 10 clear only | Prestige shop (offline, slots, kill-count, Key rates) | `economy-and-currencies.md` §3 |
| **Guild Seals** | Pull | Milestones, Guild Raid, Arena Shop, Gold ladder (no daily grant — `open-items.md` #29) | Champion pulls | `champions-guild-gacha.md` §3 |
| **Skill Seals** | Pull | same pattern + Training Grounds Raid | Skill pulls | `skills-gacha.md` §2 |
| **Excavation Seals** | Pull | same pattern + Dig-site Raid | Artifact pulls | `artifacts-dig-site-gacha.md` §5 |
| **Forge Seals** | Pull | same pattern + Forge Raid | Gear pulls | `gear-equipment.md` §4 |
| **Champion / Skill / Artifact / Gear Essence** | Crafting | Post-max (5★ Lv10) duplicates only | Crafting a specific item | `gacha-shared-system.md` §6 |
| **Trait Gems** | Roll | Trait Raid | Roll action, trait save/load | `economy-and-currencies.md` §8 |
| **Guild / Skill / Excavation / Forge / Trait Keys** | Entry | 3/day per raid (banks to 21), Arena Shop | Raid entry (win-gated, except Trait) | `economy-and-currencies.md` §9 |
| **Arena Medals** | Reward | Arena attacks (attacker only), Training Dummy wins | Arena Shop | `economy-and-currencies.md` §10 |

---

## 4. Key Formula Index

| Formula | Doc |
|---|---|
| `enemyMultiplier = b^n`, `n = p×100 + (w-1)×10 + (s-1)` | `core-progression-and-prestige.md` §1 |
| `xpPerKill = XP_BASE × (b^XP_STEP_EXPONENT)^n` | `core-progression-and-prestige.md` §1 |
| `prestigeCurrencyEarned = 100 × 2^prestigeCompleted` | `core-progression-and-prestige.md` §4 |
| `enemyHp = BASE_ENEMY_HP × b^(n × ENEMY_HP_STEP_EXPONENT)`, exponent `= ENEMY_PACE_RATIO + XP_PACE_SLACK + FIGHT_LENGTH_DRIFT` | `core-progression-and-prestige.md` §1 |
| `statAtLevel = base × growth^(level−1)`, `growth = b^(ENEMY_PACE_RATIO / LEVELS_PER_STAGE)` for PWR/DEF/VIT | `core-progression-and-prestige.md` §1, `classes-and-combat.md` §4 |
| `mitigation = min(1, DEF / (PWR × K))` | `classes-and-combat.md` §7 |
| `damage = max(MIN_DAMAGE, PWR × (1 − mitigation)) × abilityMultiplier` | `classes-and-combat.md` §7 |
| `critChance = min(1, LCK × critChancePerPoint)` + overflow | `classes-and-combat.md` §7 |
| `HP = BASE_HP + VIT × HP_PER_VIT` (150 + VIT × 10) | `classes-and-combat.md` §7 |
| `pullsToLevelUp(L) = ⌊10 × 2.6^(L-1) × 1.5⌋` | `gacha-shared-system.md` §2 |
| `dupesToLevelUp(x,y) = round(min((x×10+y) × 1.618, 20))` | `gacha-shared-system.md` §6 |
| `(star × 10 + level)` — the universal power scalar | `gacha-shared-system.md` §6 |
| `goldPerKill = BASE_GOLD × min(GOLD_STEP_BASE^n, 0.85 × platformCeiling(accountAgeDays))` | `gold-economy.md` §3, §3a |
| `secondsPerKill = max(MIN_SECONDS_PER_KILL, EHP / DPS)` | `gold-economy.md` §4, `idle-mechanics.md` §4 |
| `kills = floor(effectiveSeconds / spk + killFraction)`, remainder carried | `idle-mechanics.md` §4 |
| `burstGold = MINUTES_OF_INCOME × goldPerHour / 60` | `gold-economy.md` §6 |
| `sealGoldCost(gacha, k) = 1M × GROWTH[gacha]^(k-1)` | `gold-economy.md` §7 |
| `offlineCapHours(level) = 8 + 2 × level` (max 72) | `idle-mechanics.md` §4 |
| `cost(level) = BASE × 2^(level-1)` — short tracks | `idle-mechanics.md` §4 |
| `cost(level) = BASE × 1.72^(level-1)` — offline cap | `idle-mechanics.md` §4 |
| `price(speed, 30min) = 50 × (speed/2)`, ×1.9 per duration step | `idle-mechanics.md` §3 |
| `equippedBonus = SLOT_BASE × RARITY_MULT × (star×10+level)` | `gear-equipment.md` §2 |
| `raidDifficulty(L) = RAID_BASE × RAID_GROWTH^(L-1)` | `raid-system.md` §2 |
| `raidRewardGranted(L) = REWARD_BASE × REWARD_GROWTH^(L-1)` | `raid-system.md` §6 |
| `rollCost(locked) = 5 + locked × 5` | `traits.md` §2 |
| `memberEHP = HP × (1 + DEF / EHP_DEF_CONSTANT) / (1 − EVA)` | `global-power-number.md` §2 |
| `GPN = partyEffectiveDPS × partyEffectiveEHP` | `global-power-number.md` §2 |
| Asymmetric Elo (`K_ATTACK` ≠ `K_DEFEND`) | `arena.md` §4 |
| `medalsOnWin = BASE × (1 + UPSET × (1 − expectedAttacker))` | `arena.md` §5 |

---

## 5. Content Roster Sizes

| System | Count | Breakdown | Authored? |
|---|---|---|---|
| Class nodes | 16 | Beginner + 3 base + 6 Elite + 6 Master | ✅ named, skills named |
| Champions | 48 | 2 per archetype per rarity (4 × 6 × 2) | ✅ all 48 named and built (`open-items.md` #17) |
| Champion abilities | 28 | 7 per archetype | ✅ named + described |
| Skills | 36 | 6 per rarity, 3 Active / 3 Passive | ✅ full draft |
| Artifacts | 48 | 2 per category per rarity (4 × 6 × 2) | ✅ all 48 built and named (`artifacts-dig-site-gacha.md` §3a) |
| Artifact effects | 33 | Offense 9 / Defense 8 / Tempo 9 / Fortune 7, max reuse 3 | ✅ named + described |
| Gear | 36 | 1 per slot per rarity (6 × 6) | ✅ fully named by the epithet table |
| Traits | 8 stats × 9 grades × 5 sets | — | ✅ all tables transcribed |
| Worlds | 10 | 10 stages each | ✅ named with themes and rosters (`core-progression-and-prestige.md` §5); ❌ art and enemy kits not designed |
| Raids | 5 | 4 gacha-paired + Trait | ✅ structure; per-tier mechanic content deferred |
| Holidays | 4 | New Year, Lunar New Year, Halloween, Christmas | ❌ per-holiday bundle contents deferred |

---

## 6. What's Still Genuinely Undesigned

| Item | Status |
|---|---|
| **World & enemy design** (10 worlds, names, art, enemy rosters, boss identities, enemy kits) | The single biggest remaining greenfield pass. No longer blocks Gold (`gold-economy.md` §3a) |
| **Passive Skill Tree** | `idea-backlog.md` item 3 — unchecked, no raid assigned |
| ~~**Alternative enemy-scaling formula**~~ | Applied — the continuous `b^n` curve (`open-items.md` #10) |
| **Holiday gameplay events** (limited-time modes) | Explicitly deferred in `holiday-events.md` |
| **Per-raid mechanic content** | Fight types locked, specifics deferred |
| **Remaining tuning** | Combat/progression tuned (#22); 62 `// UNTUNED ╧` constants remain, mostly gacha, shop, economy and ability magnitudes — see `open-items.md`, "Standing numeric tuning" |
| **Gold decisions** | First-week income, lost calendar anchors, stale Seal ladder — `open-items.md` #23 |
