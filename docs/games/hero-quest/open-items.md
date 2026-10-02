# What still needs attention

**Only open items live here.** Refreshed 2026-09-17, against the code on the `hero-quest` branch.
Everything that landed moved to `build-log.md` on that date — this doc had reached 604 lines of
which the large majority was a record of finished work, and it is on the always-read list, which
made it the most expensive bloat in the project.

**Item numbers are the originals and are never reused.** Eleven docs, `constants.ts` and two
scripts cite them (`#22`, `#23.3`, `#18.6`). The gaps below — #4, #5, #8, #10–#21, #24, #26–#28 —
are finished items, not missing ones; they are in `build-log.md` under the same number. #22, #23,
#25 and #29 appear in both: the open part here, the full record there. New items continue from
**#36** — #30 was raised and decided on 2026-09-17, and is in `build-log.md`; #31 opened 2026-09-28, #32 on 2026-09-29; #33, #34 and #35 were decided on 2026-10-02 and are in `build-log.md`.

**Resolving a bare `#N`:** this doc first, `build-log.md` otherwise. Sub-numbers (`#23.3`,
`#18.6`) keep their original meaning in both.

**These docs live in `docs/games/hero-quest/`.** Nothing but these files records the reasoning
behind the decisions in them.

---

## ⚖️ Precedence — where the code overrides a locked doc

The standing rule is that a contradiction gets recorded, never silently reconciled, and that this
doc wins over a system doc. These are the live overrides; each links its full record. **If you
read the older rule in the doc named in the middle column, it is superseded.**

| # | The locked doc still says | What is true |
|---|---|---|
| 17 | `CLAUDE.md` §6: Champion names are deferred, do not generate them | All 48 exist, assembled from two tables. The guidance was updated rather than left contradicting the code |
| 18.2 | "do not generate 48 Artifact names" | Named 2026-09-15, `artifacts-dig-site-gacha.md` §3a |
| 20 | `gear-equipment.md` §6, `skills-gacha.md` §1 and both gacha docs describe four gacha **tabs** the player visits | Collapsed to **Gacha + Collections**. Navigation only — no rule, formula, drop table or number moved. `trainingGroundsArt` is serialized and rendered nowhere |
| 23 | `gold-economy.md` §9's prestige→calendar anchors; ~235M/hr at month 3 | Gold is paced on **wall-clock account age**. The anchors are gone. Still open below |
| 25 | `core-progression-and-prestige.md` §2 and `idle-mechanics.md` §5: a failed boss is re-engaged **manually** | Bosses engage **automatically** while `document.visibilityState` is `visible`. A hidden tab, a closed app and an offline settle never engage one, so Void Shards still cannot come from idle time. The 400 on an early client engage is routine — **do not soften it server-side** |
| 29 | `economy-and-currencies.md` §5 source 2: a time-gated free Seal grant | **Removed.** Free Seals come only from milestones and (later) raid clears; the free 10-pull entitlement is the only thing a clock hands out |
| 31 | `raid-system.md` §1/§7, `asset-list.md`, `economy-and-currencies.md` §9: the Training Grounds Raid is a `solo_boss` fight, its Keys spent only on a win | It is a **`training_dummy`**: a static dummy that can't die or attack, the result being the damage dealt before the timer ends (2026-09-28, the user's call). How that meets Keys, the ladder and rewards is still open below |
| 32 | `raid-system.md` §1/§7, `asset-list.md`, `asset-checklist.md`: the Forge Raid is one `phased_boss` whose phases change at HP thresholds | It is a **`boss_gauntlet`**: three bosses back to back, the Apprentice, the Journeyman and the Forgemaster (2026-09-29, the user's call). How the timer, Keys and curves apply is still open below |

---

## 🔷 Open questions — need your input

### 1. Should Arena get its own preferred-Loadout auto-apply for attacking?
Every raid auto-applies a preferred Loadout on engage (`loadouts.md` §4). Arena still doesn't — the attacker fights with whatever's live, manually pre-swapped if desired. `arena.md`'s Implementation Note flags this as a natural extension, not yet requested.

### 2. Arena matchmaking band width
`ARENA_MATCH_BAND_PCT` — how close in GPN does an opponent need to be to appear as a real candidate before Training Dummy fills the slot? Design-feel question as much as a number.

### 3. Boss/Raid fight crit model — seeded or averaged?
`tech-architecture.md` §4c/§9 recommends seeded RNG crits for live boss and raid fights, but it's a recommendation, not a lock. **As built, boss fights roll seeded crits** (`fight.ts`). The question is whether that stays — with `BOSS_HP_MULT` sized so gates are not decided within a couple of seconds, the variance matters less than it did.

### 31. Training Grounds Raid as a damage race — how it fits the raid rules — **new 2026-09-28**
The user made the Training Grounds Raid a `training_dummy` fight: a static dummy that can't die and can't attack, scored on the damage the party lands before a timer runs out (`raid-system.md` §7 *Training Dummy*). The art is built (the Great Dummy, `art-style.md` Round 5). `raid-system.md` was written for fights that end in a win, a wipe or a death, so these are undecided:

1. **Keys.** No win to gate on, so the win-only spend (§3) can't apply. Rampaging Boss's rule would be the precedent: a Key spent on every entry.
2. **The ladder.** There is no level to select or clear (§2). Is the result the damage itself, or a level the damage reaches on a threshold curve?
3. **Rewards.** `raidRewardGranted(level)` (§6) needs a level. A damage race needs either damage → level thresholds or its own damage → Skill Seals curve. Damage is Decimal and grows exponentially with the account, so the curve has to be too.
4. **Quick-clear.** Reclaim the personal best for a Key, as Rampaging does (§4)?
5. **The dummy's stats.** Does it have DEF, so mitigation counts, and is that fixed per the "static difficulty" rule (§2)?
6. **The timer.** A new constant (for example `RAID_DUMMY_SECONDS`, `// UNTUNED ╧`), separate from `RAID_ENRAGE_SECONDS`. The art page's live stage uses 20 s for viewing only.


### 32. Forge Raid as three bosses back to back — how it fits the raid rules — **new 2026-09-29**
The user made the Forge Raid a `boss_gauntlet`: the Apprentice, the Journeyman and the Forgemaster, each coming out as the last falls (`raid-system.md` §7 *Boss Gauntlet*). The art is built (`raid-forge.ts`). `raid-system.md` was written for one boss per fight, so these are undecided:

1. **The timer.** One `RAID_ENRAGE_SECONDS` for all three, or one per boss?
2. **A win.** Is a Key spent only for downing all three, or does reaching the second or third boss count for something?
3. **Difficulty.** Does `raidDifficulty(level)` set all three alike, or does each step up in its own right, the Forgemaster hardest?
4. **Rewards.** One `raidRewardGranted(level)` for the full clear, or a share per boss downed?
---

## 🔴 Genuinely undesigned — full passes, not edits

### 6. World & enemy design — **naming and art briefs done; only the enemy-kit question is open**

**Names, themes and rosters are done** (`shared/utils/hero-quest/content/worlds.ts`, `core-progression-and-prestige.md` §5). The run is a walk toward the source: Duskspire's archmage opened a door to the Void (World 6), the cracks spread outward, and a run starts at the far frontier and walks inward past the door and out through the edge of the world into The Void. Each world has a one-line theme, which is the art brief. Nothing numeric moved — enemy stats come only from the curve.

Three naming rules, because the UI depends on them, stated in the `worlds.ts` header: trash names pluralise with a plain "s" ("Bramble Goblins defeated" — documented, not tested), boss names never start with "The" (the button reads "Fight Old Gnarlhide"; it previously rendered "Fight the The Voidborn"), and no name reuses a Champion given name or title (six of the old placeholders did). `worlds.spec.ts` enforces the last two, plus unique names across worlds. World IDs were renamed to match (`world_thornwick_vale` …); nothing persists them — runs store the world as an integer.

**The art briefs landed 2026-09-17.** `asset-list.md` §1.4 now carries the full roster table with each world's theme as its brief, and locks the rule: **every enemy is styled to its world** — trash, elite, boss and super boss drawn as inhabitants of that place, not a generic set recoloured ten times. Art is the only signal a run has moved on, since the stat curve is continuous across worlds and the pool never re-themes between prestiges. Elites are one consistent mark reused across all ten worlds, not ten designs. That puts the category at **30 distinct designs plus one elite mark**, before variants.

**The counts closed 2026-09-17 too.** 4 trash variants per world — sword, axe, bow, mage-staff — on **4 shared rigs** reskinned per world (§1.2's Champion chassis pattern, since a bow release and an axe swing genuinely differ but a world does not change how either moves). **4 animation states** for trash and elites (Idle, Attack, Hit, Death — no skill-cast, because enemies have no abilities), **5 for bosses and super bosses**, the extra being an Entry rather than a cast. That last one exists because #25 removed the player's engage action and the watchlist asks whether a boss still reads as an event; the art is what is left to carry it. Totals: **60 designs, 116 spritesheets**.

**Still open — one question, and it is gameplay, not art:** whether enemies get kits of their own. ⚠ **It now carries a priced art cost**: a yes adds a fifth state to every enemy rig, 4 more trash sets and 20 more boss sets, on top of the fight-length re-measurement it already owed. Enemies are still HP/PWR/DEF stat blocks with no abilities, which is why `controlResist` is inert (#18.6). *(This no longer blocks Gold: `gold-economy.md` §9's prestige→calendar calibration was replaced by the account-age ceiling, #23.)*

**What the tuning pass (#22) hands the enemy-kit question:** the enemy *curve* is tuned and derived from a pacing model, so art and kits can be chosen without re-deciding numbers — but anything that changes fight length (enemy abilities, heals, shields, more escort bodies) moves `FIGHT_LENGTH_DRIFT`'s effective value and has to be re-measured on the campaign walk. A first prestige for a party of three is about a week, and a world takes from under an hour (World 1–2) to about two days (World 10), almost all of it grind in front of gates.

### 7. Passive Skill Tree (backlog item 3)
Unchecked. Hero-only passive tree, generic root splitting into 3 paths, nodes up to 5 levels each, purchased via its own dedicated raid, with Champion/item side-nodes allowed but never gating a path. Structurally sound to build (raids don't have to be gacha-paired) but has had no dedicated design session.

### 9. Holiday gameplay events
Explicitly deferred scope — the gift-mechanic phase is locked, but limited-time modes/content were never started.

---

## ⚠️ Open consequences of work that landed

Three items are built and working but left something undecided. The full record of each is in
`build-log.md`; only the open half is restated here. (The `killFraction` invariant that used to
sit here as #24 is not an open item — it is a trap, and it lives in `CLAUDE.md` §7 and
`build-log.md` #24.)

### 22. The combat and progression tuning pass — three open consequences

Full record: `build-log.md` #22. 42 constants moved to `// TUNED ✓` and the level curve was
re-derived as a pacing model. What it left open:

1. **A solo account never completes a prestige** without pulling. That follows from making the
   boss gate the wall and Champions the answer to it — worth confirming it is intended rather
   than letting it stand by default.
2. **The Gold curve was calibrated against the old loop speed** — see #23.
3. **`STAT_PACES_ENEMY_CURVE` is inert while `XP_PACE_SLACK` is 1.0**, because both stat curves
   are then numerically identical. Keep it: it starts mattering the moment slack moves.

⚠ The `TUNED ✓` legend says "confirmed in playtest", but `playtest-notes.md` records only
session 1. The block was tuned on the campaign sim, not felt.

### 23. Gold — the progression half is still open

Full record, including the 2026-09-16 measurement pass and the ceiling regeneration:
`build-log.md` #23. Where it stands:

**Done.** `GOLD_TENURE_CEILING` is regenerated against `GOLD_REFERENCE_KILLS_PER_HOUR = 600`,
measured on the campaign walk, instead of the `MIN_SECONDS_PER_KILL` throughput floor it used to
assume. Every rung went up 12×. `bun run balance:compare --emit-hq-ceiling` regenerates it.

**Still open. The sub-numbers are unchanged** — `#23.1`, `#23.2` and `#23.3` are cited from
`playtest-notes.md`, `gold-economy.md` and `constants.ts`:

1. **The locked calendar anchors are gone.** `gold-economy.md` locked ~235M/hr at month 3 and
   ~0.71B/hr at month 6; the ceiling pays ~28M/hr at day 90 and ~52M/hr at day 180. A deliberate
   re-anchoring on the platform that replaced a *locked* decision in code — recorded here so it
   reads as a decision rather than a drift.
2. **The Seal ladder's calibration is stale**, and measured, worse than stale: at present income
   the first 1,000,000-Gold rung is **33.8 days** away, so re-deriving `SEAL_LADDER_GROWTH`
   against income that size is meaningless. **Blocked on 23.3, not parallel to it.** #29 raised
   the stakes — the ladder is now the only non-milestone Seal source.
3. **First-week income — the actual decision.** The walk is **progression-bound end to end** and
   earns 1,233 Gold/hour, 0.07% of platform; raising a ceiling that never binds changed its
   income by nothing. The two levers that reach that region are `BASE_GOLD` and `GOLD_STEP_BASE`,
   and the regeneration gave them room they did not have — the walk now saturates at 138.8M
   rather than 11.57M, with the saturation point at 1.09 rather than 1.07. **Nothing has been
   moved** pending the call: should a first-week account earn near platform rates, or is low
   early Gold acceptable given that Gold only buys Seals? Note that `GOLD_PLATFORM_DISCOUNT`'s
   "~89% of time ceiling-bound" figure is **0%** for the first month-plus.

⚠ **The abuse bound is now explicit.** With the ceiling generated at 600 kills/hour and the floor
still allowing 7,200, the worst case is **12× platform**. **Battle Speed (Phase 4, unbuilt)
multiplies straight through it**, with no second ceiling underneath.

⚠ **`gold-economy.md` §9.4's safety margin dropped an order of magnitude** with the regeneration:
the largest single collect clears the `numeric(19,4)` column by two orders rather than three
(187 consecutive worst-case collects fill it, not 2,250). `settle.spec.ts` asserts the new figure
and says why.

### 29. Free Seals — the un-re-derived half

Full record: `build-log.md` #29. A gacha gets 30 free pulls a day and no free Seals, ×4 systems.
The 30/day ceiling for a player who never buys Seals is **intended and accepted**. What has not
been re-derived against the new shape: the collection curve, Essence income and the crafting
economy — a tuning question, listed below rather than a blocker.

---

## ⚪ Standing numeric tuning — **what is still `// UNTUNED ╧`**

Named constants with a formula shape locked and a placeholder value. Consolidated so a tuning pass has one list. `rg '╧' shared/utils/hero-quest/constants.ts` is the authority — **61 markers** as of 2026-09-16 (three Seal-grant constants deleted and two free-pull constants promoted to `TUNED ✓` by #29; `GPN_DISPLAY_SCALE` added by #28).

~~**Decided: none of this is tuned before playtesting.**~~ **Superseded for the combat and progression block by #22**, which tuned it on the campaign walk. The original reasoning still holds for everything that remains below: the balance script and campaign sim project *what the formulas say*, and a projected value that feels wrong in play is worth less than no value, because it looks settled. What remains is mostly the gacha, shop and ability-magnitude layers, which the campaign walk barely exercises — so they want play data or a different measurement, not another sim pass.

**Do not treat any of these as blocking a phase.**

Two rows are not constants in the strict sense: the archetype stat spreads are a table, and `SEAL_LADDER_BASE_GOLD` *is* specified. Both are listed anyway because the same pass answers them.

**Removed from this table**, so they are not re-added by mistake — now `TUNED ✓`, derived, or deleted (#22, #23, #29): `SEAL_GRANT_INTERVAL_HOURS`, `SEAL_GRANT_AMOUNT`, `SEAL_GRANT_BANK_CAP_DAYS`, `FREE_PULLS_PER_DAY`, `FREE_PULL_COOLDOWN_MINUTES`, `K`, `CRIT_CHANCE_PER_POINT`, `CRIT_DAMAGE_PER_POINT`, `SKILL_BASE_COOLDOWN_SECONDS`, `SKILL_BASE_ABILITY_MULTIPLIER`, `WAVE_PACK_SIZE`, `ELITE_PACK_SIZE`, `PACK_LIVE_STREAM_FRACTION`, `BOSS_MINION_COUNT`, `STATUS_MAX_STACKS`, `STATUS_TICK_SECONDS`, `MAX_SUSTAIN_MITIGATION`, `MIN_SECONDS_PER_KILL`, and `GOLD_PRESTIGE_CAP` / `prestigeGoldFactor[]` (deleted).

| Constant(s) | Doc | Note |
|---|---|---|
| Offline Efficiency / Offline Cap `BASE_COST` (×2) | `idle-mechanics.md` §4 | Formula shapes locked, no anchor value |
| `K_ATTACK`, `K_DEFEND`, `MEDAL_BASE_WIN`, `MEDAL_BASE_LOSS`, `MEDAL_UPSET_BONUS`, `ARENA_MATCH_BAND_PCT`, `ARENA_SHOP_GEM_PRICE` | `arena.md` | `ARENA_MATCH_BAND_PCT` also a design question, see #2 — set it against GPN's root form (#28, restored 2026-09-16); the flat `GPN_DISPLAY_SCALE` cancels in a ratio, so a percentage band means the same before and after it. `ARENA_SHOP_GEM_PRICE` has an explicit calibration target (under 1 Battle Speed block per day's Medals) |
| `EHP_DEF_CONSTANT` | `global-power-number.md` §2 | Built (#28). At 10 a level-1 Hero's DEF doubles its EHP; tune against how balanced parties should read against lopsided ones |
| `SKILL_COLLECTION_PASSIVE_FRACTION`, `ARTIFACT_COLLECTION_PASSIVE_FRACTION` | none — see #28 | What an unequipped Passive Skill or Artifact gives the Hero, as a fraction of equipping it. 0.1 mirrors Gear; tune together with `GEAR_PASSIVE_COEFFICIENT` so all three collections feel comparable |
| `RAID_BASE_STATS`, `RAID_LEVEL_GROWTH`, `RAID_REWARD_BASE/GROWTH`, `RAID_ENRAGE_SECONDS`, `RAID_RAMPAGE_DMG/POWER_BASE/GROWTH` | `raid-system.md` | Per-raid |
| `SLOT_BASE_BONUS` ×6, `GEAR_PASSIVE_COEFFICIENT` | `gear-equipment.md` §2 | Built. The six slot coefficients are deliberately *identical* — no doc ranks the stats against each other, so six different values would encode a spread nobody decided. `GEAR_PASSIVE_COEFFICIENT` must stay well under them or manual equip stops mattering |
| `SKILL_PASSIVE_MAGNITUDE[]`, `SKILL_ECONOMY_COEFFICIENT` | `skills-gacha.md` §4 | The whole 36-skill magnitude ladder, indexed by rarity. §4 authors it as "small" → "large" and assigns no number anywhere; the *relative ordering* is design content, so retune the set rather than entries |
| `SKILL_POTENCY_PER_POINT` | none — see #18 | What one point of a Skill copy's `(star × 10 + level)` scalar adds to its effect potency. **Identity at minimum**, so §4's authored bands stay the reference and only levelling multiplies up — ×2.18 at 5★/Lv10 on the placeholder. Its own constant rather than reusing `CHAMPION_INVESTMENT_PER_POINT` (×3.95 at max) because a Champion's scalar is its *only* growth axis while a Skill already carries a rarity band |
| `GOLD_BURST_MINUTES[]`, `GOLD_BURST_COOLDOWN_SECONDS` | `gold-economy.md` §6 | Burst size in minutes of income, and the cadence it repays over. The cooldown is a **decision, not a transcription** — at the shared 6.4s skill base, a 0.5-minute burst repays ~+470% Gold, two orders past §5's ×3 stack target |
| `SKILL_COOLDOWN_REFUND_FRACTION` | none — see #18 | How much shorter a "chance to refund / reset / re-trigger" Active's cooldown is rendered as. One constant for all three such Skills, so the approximation retunes in one place |
| `WEALTH_FACTOR_MIN/MAX`, `WEALTH_NEUTRAL_HOURS` | `skills-gacha.md` §4¹ | The Gambler's Strike family's bounded modulation. §4¹ suggests ×0.5–×2.0 explicitly and calls it not locked; the neutral point is where the factor passes through 1.0 |
| `ARTIFACT_EFFECT_PER_POINT`, `ARTIFACT_ECONOMY_COEFFICIENT` | `artifacts-dig-site-gacha.md` §6 | Per *point* of the investment scalar, unlike Skills' flat magnitude — §6 states the scaling for Artifacts and no doc states it for Skills. See #18's closing note |
| `SKILL_SLOT_BASE_COST`/`_GROWTH`, `ARTIFACT_SLOT_BASE_COST`/`_GROWTH` | `skills-gacha.md` §6, `artifacts-dig-site-gacha.md` §7 | Both mirror the Champion slot track exactly, so all three want deriving together — and all three compete with the two offline tracks for the same Void Shards |
| `GOLD_STEP_BASE`, `BASE_GOLD`, `GOLD_PLATFORM_DISCOUNT` | `gold-economy.md` §3, §3a | **Carry no marker but are open** — see #23.3. `GOLD_TENURE_CEILING` is generated, never tuned by hand: regenerate from `scripts/lib/economy-stages.ts` |
| `SEAL_LADDER_GROWTH[]` | `gold-economy.md` §7 | Set, but calibrated against the superseded Gold anchors — see #23.2 |
| `LOADOUT_SLOT_BASE_COST_GEMS` (8-level doubling) | `loadouts.md` §3 | Built. Two firsts at once, which §3 flags as a genuine unknown: the first time the doubling short-track shape stretches past 5 levels (128× the base at the top), and the first time it is paired with Gems. Now checkable against real Gem income (Trait/Arena sinks exist) |
| `ONLINE_THRESHOLD_MS`, refresh interval | `tech-architecture.md` §9 | |
| `MAX_EVASION` | `classes-and-combat.md` §7 | **Locked at 0.60** — not open, listed for completeness |
| `OVERFLOW_CONVERSION_RATE` | `classes-and-combat.md` §7 | The only crit constant still untuned. Rarely reachable: with LCK off the level curve only a deliberately built crit Hero passes 100% |
| `SEAL_GRANT_PER_BOSS`, `SEAL_GRANT_PER_WORLD_CLEAR`, `SEAL_GRANT_PER_PRESTIGE` | `economy-and-currencies.md` §5 | The milestone batch sizes. Doc gives only the shape — "small per World clear, larger per Prestige" — and defers the values to the world/enemy pass (#6). Built and paying out |
| `VOID_SHARD_BASE`, `VOID_SHARD_GROWTH` | `economy-and-currencies.md` §3 | 100 × 2^prestige, the doc's "starting point". Only has to outpace shop costs, so derive it alongside the slot and offline tracks it pays for — and note that at ~a week per prestige (#22) the first shop purchase is a week in |
| `wealthFactor` clamp range for Gambler's Strike family | `skills-gacha.md` §4 | Suggested ×0.5–×2.0, not locked |
| `CHAMPION_SLOT_BASE_COST`, `CHAMPION_SLOT_COST_GROWTH` | `champions-guild-gacha.md` §1 | Void Shard price of party slots 3→5. Competes directly with the two offline tracks for the same currency, so all three want deriving together |
| `CHAMPION_PASSIVE_PER_POINT` | `champions-guild-gacha.md` §7 | The §7 collection passive. Doc fixes which archetype buffs which stat and states no magnitude anywhere. At 0.002 one maxed Champion is +12% to its archetype's stats, and the full 48-Champion roster maxed (12 per archetype) is +144% on each of the six |
| `CHAMPION_INVESTMENT_PER_POINT` | `champions-guild-gacha.md` §2 | What a copy's `star × 10 + level` scalar is worth. Sets the payoff on dupe levelling, so it decides whether pulling wide or levelling deep is correct |
| Archetype base stat spreads (`ARCHETYPE_DEFINITIONS[].spread`) | `champions-guild-gacha.md` §2 | Not a constant but the same problem: §2 states outright there is no Champion equivalent of the Hero's §2 table, so all four spreads are a reading of the archetype identities rather than a specified number |
| `SEAL_LADDER_BASE_GOLD` | `gold-economy.md` §7 | Doc-specified at 1,000,000. Uncapped per day by design — see the note below |
| `TANK_THREAT_MULTIPLIER`, `TAUNT_THREAT_MULTIPLIER` | none — see #14 | How hard the two documented aggro anchors pull. Any value above 1 already puts a Tank in front of its row-mates; the magnitude only starts mattering once threat becomes contested and continuous |
| `FROSTBIND_STACKS_PER_CAST`, `FROSTBIND_FREEZE_STACKS` | none — see #15 | How fast Frostbind's slow builds and how deep it must get before the freeze lands. Two dials so time-to-freeze can be retuned from either end; a threshold above `STATUS_MAX_STACKS` turns the freeze off entirely |
| The `SKILL_*` magnitude set, `ENRAGE_*`, `KILL_SHOT_CRIT_MULTIPLIER`, `EXECUTE_BONUS`, `FOCUSED_BARRAGE_HITS`, `REVIVE_HP_FRACTION` | none — see #15 | Every ability magnitude in the game. Both rosters describe effects entirely in prose ("a short duration", "a portion", "small") and assign no numbers anywhere. The *relative ordering* is design content and deliberate — wide AoE pays for reach, a pierce beats a basic attack by a little — so retune the set, not individual entries. `HASTE_SPD_BONUS` is excluded: §3 states the doubling |

**On `SEAL_LADDER_BASE_GOLD` — reviewed and closed.** Gold buys nothing in the game except Seals, so this price is the entire Gold sink. The campaign sim banks ~4.9B Gold by prestige 4, which at the base rung and `SEAL_LADDER_GROWTH[champion] = 1.0007` converts to roughly **2,100 Seals in a single sitting** — about two full 1,066-dupe Champions — because `MAX_SEALS_PER_PURCHASE` bounds the per-call size and nothing bounds the per-day total.

**That is intended, and no daily cap is being added.** A player willing to spend an exponentially increasing amount of Gold should be able to keep buying; the ladder's compounding *is* the brake, and it is a smooth one rather than a wall that stops the session dead. Converting a large Gold pile into a large collection is what the pile is for. `SEAL_LADDER_BASE_GOLD` stays an ordinary tuning value in the table above, calibrated at playtest against real Gold income like everything else — not a structural problem to solve first.

---

## Suggested order

**Reordered 2026-10-02, the user's call: the playtest and the Gold balance (step 2) move to the very end, with step 7.** The battle stage comes first (`build-log.md` #34): the idle stage and the boss replay on the stage both landed that day. The argument below for playing early was weighed and set aside; it is kept as the record of what the reorder gives up.

1. ~~**Phase 3 — the remaining three gachas**~~ **Done — `build-log.md` #18.**
2. **Close out the tuning pass** — *deferred to the end with step 7 (2026-10-02).* Small, and it was meant to come before anything is built on top of the loop:
   - **Play a session against the tuned loop** and log it in `playtest-notes.md`. The predictions table there is refreshed; session 1 is the only one on record.
   - **Decide the Gold consequences (#23)** — first-week income, the lost calendar anchors, and whether the Seal ladder is re-derived now or after world design. **Measured and half-applied 2026-09-16** (`--report=gold`): the ceiling is regenerated against the measured kill rate, which raises the cap 12× but leaves the walk's income untouched, since it is progression-bound throughout. What remains open is the progression half — `BASE_GOLD` and `GOLD_STEP_BASE` — and #23.2, which is downstream of it.
   - **Confirm the solo shape (#22.1)** — no prestige without a party is a consequence of the design, not yet a stated choice.
   - ~~**Check the cleared-run manual re-engage** flagged in #25.~~ Fixed.
3. **World & Enemy Design (#6)** — names, themes and rosters done 2026-09-15 (closing #5). What remains is art direction and production, and the optional enemy-kit question; kits that change fight length have to be re-measured against #22.
4. **The three remaining quick calls (#1-3)** — all answerable in one short pass, none depend on anything else. The asset calls (#4, #30) are decided, 2026-09-17.
5. **Phase 4 — endgame systems** (`implementation-plan.md`). Raids, Traits, Arena, Holidays, Battle Speed, plus `loadouts.md` §4's per-raid auto-apply. ~~GPN~~ built (#28); the leaderboard aggregate and Defense GPN remain, with Arena.
6. **Passive Skill Tree (#7)** — the last unbuilt major system; good candidate for its own dedicated session.
7. **Playtest, then tune the rest.** The combat and progression block is tuned (#22); the gacha, shop, economy and ability-magnitude constants are settled here — see the standing-tuning section. The balance script and campaign sim stay in use throughout.

**On the playtest step's position.** Tuning the *remaining* constants wants every system present, so the last step is still the right place to *finish*. But the loop itself was tuned on the sim alone, and `implementation-plan.md` Phase 1's "stop here and actually play it before continuing" has now been overridden three times. The harness (#19) makes a session cheap, and world design is downstream of it — nothing settles how long a world should take like having felt one. That is why step 2 exists.

---

## 🔬 Watch during playtest

Things that are **built and working** but whose *feel* has never been observed against a real session. None of these is a bug or a blocked decision, so none belongs in the lists above — they are the questions only playing the game can answer.

**Raw observations go in `playtest-notes.md`, not here.** This section holds the questions and, eventually, the decisions; that file holds what actually happened. The split matters later: this doc will say *what* was changed, and that one will say *why it felt wrong*, which is the half that normally evaporates. It also carries the sim's falsifiable predictions and the known-inert list, so a session does not burn time re-deriving either.

### Champion rarity modifier — is a Mythic too far ahead of a Common?

`RARITY_STAT_MULTIPLIER` (Common 1.0 → Mythic 2.5) is doc-specified, and taken alone it is a reasonable spread. The thing to watch is that it is **no longer the only thing rarity buys.** As of #12 a Mythic also brings three abilities to a Common's one, and its higher stats shorten its own cooldowns on top of that. Three multiplicative payoffs now ride a single rarity roll:

| Payoff | Source | Common → Mythic |
|---|---|---|
| Stat magnitude | `RARITY_STAT_MULTIPLIER` | ×2.5 |
| Ability count | `RARITY_ABILITY_COUNT` (§2) | ×3 |
| Ability throughput | SPD → `cooldownFor`, emergent | unquantified |

The compounded gap was never the number anyone signed off on — ×2.5 was. Watch for whether a single Mythic pull trivialises a stretch of the run, whether a Common ever feels worth fielding once one Mythic is owned, and whether the gacha reads as rewarding or as a wall you cannot pass without a lucky roll. If it lands too hard, the cheapest lever is compressing `RARITY_STAT_MULTIPLIER` rather than touching ability counts, since the counts carry the kit identity and the multiplier carries nothing but itself.

Worth re-checking specifically **after** the ability-effects pass (#12) lands, since real Support and Control effects will change what a second and third ability are actually worth.

**Status: reviewed, no change.** Left as-is deliberately — the compounding is a plausible design and the alternative is guessing at a correction before anyone has felt the problem. Revisit here, with play data, not before.

### Does a slow wall read better than a hard one?

`MIN_DAMAGE` (#11.5) changed what hitting a wall *looks like*: instead of standing immortal dealing exactly nothing, an outmatched party now chips for 1 and wipes, and the same stage restarts without losing ground. Wall positions did not move.

The open question is purely about feel. A wipe-and-retry loop communicates "you are too weak here" far more clearly than a frozen zero, but it also means the player watches the party die repeatedly, which reads as punishing in a way an idle game may not want. Watch whether the wipe loop is legible or just demoralising, and whether "1 damage" reads as *nearly there* — a misleading signal, since 1 damage against exponential HP is not nearly anywhere. If it misleads, the display is the lever rather than the constant: showing time-to-kill instead of raw damage tells the truth without changing the model.

*(Added 2026-09-15: the tuning pass made both of these more concrete. Boss gates are now the only walls in a party's first prestige, and hero DEF paces enemy PWR exactly, so the `MIN_DAMAGE` chip is now a far-side-of-a-wall reading rather than something normal play shows. Elite wave wipes at the World 1 opening for a solo account are the one place a player will reliably watch the wipe loop.)*

### Is a week-long first prestige the right rhythm? — **new, from #22**

The loop was slowed from hours to about a week for a party of three, and nearly all of that week is idle waiting in front of Stage 5 and Stage 10 gates — fighting is ~3 hours of it. Watch whether the grind reads as anticipation (come back tomorrow, the boss falls) or as a stall, whether players understand *why* they are waiting (the stat breakdown, #26, is the in-game answer), and whether a first Void Shard purchase a week in is too late to feel the prestige shop at all. `XP_PACE_SLACK` is the dial for grind length without touching fight length.

### Do automatic boss fights keep the one moment of attention? — **new, from #25**

Bosses were the only thing that waited for the player. They now fire on their own while the tab is visible. Watch whether a boss still feels like an event when the player did not start it, whether the auto-closing replay is long enough to see what happened, and whether players miss the button.

### Does Gold feel like anything in week one? — **new, from #23**

A first-week account earns at most ~15K Gold an hour before Gold%, and the campaign walk's party averages nearer 1K (#23.3), and Gold buys only Seals. Watch whether the Gold ladder is ever used before week two, and whether the number reads as an income at all next to the platform's other games.

### The whole standing-tuning table

Every remaining `// UNTUNED ╧` constant is a playtest deliverable rather than a pre-phase chore — see the standing-tuning section for the reasoning. The watchlist is where they get answered.

