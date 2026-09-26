# Core Progression & Prestige System

Status: **Locked** — decisions confirmed, ready to reference for implementation planning.

## Structure recap
- 1 prestige run = **10 worlds (fixed)** × 10 stages each
- Stage 10 of every world = super boss encounter
- Player prestiges after clearing World 10, Stage 10, resetting into a harder run

---

## 1. Enemy Power Curve

Base multiplier applied to enemy stats. Every position in the game collapses to **one index**,
and the curve is a single exponential over it.

```
n = prestige × 100 + (world-1) × 10 + (stage-1)

enemyMultiplier(prestige, world, stage) = b^n
```
(world and stage both range 1–10, so `n` advances by exactly 1 per stage, forever)

- `b` = **per-stage growth**, `ENEMY_STEP_BASE`, currently **1.08** (+8% per stage)
- `T` = `b^100` ≈ **2,200** — the multiplier across one full 100-stage prestige loop, derived

This **replaces** the earlier `5^prestige × 1.6^(world-1) × 1.15^(stage-1)`, which was three
bases on three axes and stepped unevenly: a world boundary was a ×1.6 jump where a stage step
was ×1.15, and because stage reset from 10 to 1 across that boundary the curve actually *fell*
×0.455 at every world change and ×0.021 at every prestige. It was a sawtooth, not a ramp. The
single index removes both seams — n=99 → n=100 is one ordinary step like any other.

**Consequence, deliberate and worth stating plainly: there is no prestige difficulty reset.**
Under the old curve a new prestige started ~52× weaker than where you just were, so prestige
meant re-climbing familiar ground. It no longer does. A single continuous base cannot express
both a per-run ramp and a smaller per-prestige jump — under one index they are the same number.
`ENEMY_PRESTIGE_STEP_MULT` in `constants.ts` is the escape hatch if the dip is wanted back.

**The World 1 Stage 1 enemy** is `BASE_ENEMY_HP 60 / BASE_ENEMY_PWR 1.75 / BASE_ENEMY_DEF 2` before the ramp. PWR and DEF ride `b^n`; **HP rides its own exponent** — see *Hero pacing* below for why.

**Elite mob stats** (stages 6–9 within a world), layered on top of the regular-mob multiplier for that stage:
- Stats **×1.2** that stage's regular-mob baseline (`ELITE_STAT_MULT`) — same base roster, stat-buffed variants with a slight design variation (e.g. recolor or minor visual tweak) so players can tell them apart from regular mobs at a glance, without needing full new art.

**Boss stats** (Stage 5 of every world), layered on top of the trash-mob multiplier for that stage:
- HP **×7** trash-mob HP (`BOSS_HP_MULT`)
- ATK ×1.2 trash-mob ATK

**Super boss stats** (Stage 10 of each world), also expressed against **trash-mob** HP so the two
gates stay directly comparable while balancing:
- HP **×9** trash-mob HP (`SUPER_BOSS_HP_MULT`)
- ATK ×1.5 trash-mob ATK

Each boss stands with `BOSS_MINION_COUNT = 2` trash-tier escorts (`open-items.md` #13), and the 30-second timer covers the whole encounter.

**History:** the original ×8–12 (with the super boss compounding ×2 off the stage boss, ×16–24 of trash) was cut to ×3 / ×6 with the continuous curve, then raised to **×7 / ×9 in the combat tuning pass** (`open-items.md` #22) once the enemy HP curve was re-derived. The super boss is the heavier of the two on purpose: against a fixed `BOSS_TIMER_SECONDS`, a gate is a pure DPS check, and party DPS is exactly what Champions add. Making the *gate* the wall rather than the wave ramp is what turns "this got slow" into "this needs a party."

- **`BOSS_HP_MULT` sets the first wall of a fresh account.** A solo level-1 Beginner clears World 1 Stages 1–4 and must fail the Stage 5 timer on arrival by a clear margin (a gate decided by two seconds of a seeded fight is a coin flip), while a starting party of three passes it on sight.
- **`SUPER_BOSS_HP_MULT` sets the length of the first prestige**, together with `XP_PACE_SLACK`.
- ⚠ **Bounded above by the fixed timer.** A gate is three bodies inside 30s, so `secondsPerKill` at a gate cannot exceed 10s. Raise enemy HP much further and the early gates stop being passable at any level a fresh account can reach; raising it means raising `BOSS_TIMER_SECONDS` too.

Every constant in this section is now marked `// TUNED ✓` in `constants.ts`.

### Hero pacing against the curve — **revised in the combat tuning pass**

Hero stat growth is **geometric**, expressed as a fraction of the enemy curve rather than as an independent number, and it is now built so that **the matched stat pairs never drift and the walls come from fight length instead.** Two stat curves, one enemy HP exponent:

```
LEVELS_PER_STAGE             = XP_PACE_SLACK × DPS_STAT_EXPONENT / STAT_PACE_RATIO        // 1.0 × 2 / 0.5 = 4
STAT_PER_LEVEL_GROWTH        = ENEMY_STEP_BASE ^ (STAT_PACE_RATIO / DPS_STAT_EXPONENT)     // SPD, IMP
STAT_PER_LEVEL_GROWTH_PACED  = ENEMY_STEP_BASE ^ (ENEMY_PACE_RATIO / LEVELS_PER_STAGE)     // PWR, DEF, VIT
DPS_COVERAGE_PER_STAGE       = ENEMY_PACE_RATIO + XP_PACE_SLACK                            // 2.0
ENEMY_HP_STEP_EXPONENT       = DPS_COVERAGE_PER_STAGE + FIGHT_LENGTH_DRIFT                 // 2.35

enemyHp(n) = BASE_ENEMY_HP × b^(n × ENEMY_HP_STEP_EXPONENT)
```

- **`ENEMY_PACE_RATIO = 1.0` — the matched stats track the enemy exactly.** Hero PWR is read against enemy DEF and hero DEF/VIT against enemy PWR, each through the mitigation *clamp*. A matched pair growing even slightly apart does not "fall behind and catch up": it stays identical for a hundred stages and then collapses to `MIN_DAMAGE`. At 1.0, `enemyPwr / heroDef` and `heroPwr / enemyDef` are fixed for the life of a run, so **the level-1 answer on mitigation and survival is every depth's answer.** This removes the clamp as a source of walls at both ends.
- **`FIGHT_LENGTH_DRIFT = 0.35` — where the walls come from instead.** Enemy HP is the one stat read against a *product* (DPS = PWR × crit multiplier × …), so it needs its own exponent. Drift is how much faster HP grows than party DPS: each stage's fight is `1.08^0.35 ≈ +2.7%` longer than the one before. A slope, not a cliff — any stage is beatable given levels — and the walls land on **boss timers**, the one place the drift is read as pass/fail. ⚠ Past ~0.35 the run gets *shorter*: the last gate of a loop must make up `drift × 100` stages and farming cannot deliver that, so the walk stops a world or two early.
- **`XP_PACE_SLACK = 1.0` — the grind dial.** `XP_STEP_EXPONENT = XP_PACE_SLACK × ln(XP_TO_LEVEL_GROWTH) / ln(STAT_PER_LEVEL_GROWTH)`. Fighting time is invariant under it (enemy HP is set against `DPS_COVERAGE_PER_STAGE`, which contains it); only idle waiting in front of a gate changes. With `SUPER_BOSS_HP_MULT` it sets the first prestige for a party of three at about a week. At exactly 1.0 the two stat curves are numerically identical, so the split is currently inert — it matters the moment slack moves.
- **`STAT_PACE_RATIO = 0.5`** no longer decides pace on its own — `XP_STEP_EXPONENT` hands back as XP whatever ground a level fails to buy. It sets the *unit*: one level buys half a stage of DPS, one stage costs two levels of DPS growth, a 100-stage loop costs 200.
- **`DPS_STAT_EXPONENT = 2`** — PWR and `critMultiplier` (through IMP) both ride the stat block, so DPS grows as the stat curve *squared*. Below the attack-rate cap SPD also scales and the true exponent is nearer 3.
- **LCK is off the level curve** (`STAT_SCALES_WITH_LEVEL`). Crit chance is LCK clamped to 100%, and a geometric curve feeding a clamp makes the cap a question of *when*; frozen at base, crit chance is something Gear, Skills, Artifacts and the collection passive have to buy. IMP stays on the curve because it is what makes the exponent 2. See `classes-and-combat.md` §4, §7.
- **`XP_TO_LEVEL_GROWTH = 1.05`** is the dial for "XP numbers are too big" and very nearly only that: `XP_STEP_BASE === XP_TO_LEVEL_GROWTH ^ LEVELS_PER_STAGE`, so fight time and end level are invariant under it.

⚠ The old warning that `STAT_PACE_RATIO = 1.0` "removes gating entirely" is retired: gating is `FIGHT_LENGTH_DRIFT`'s job now.

**Measured at the current values** (`bun run sim:hero-quest --report=campaign`, 72h grind budget per blocked stage, un-invested Beginner stand-ins at Common):

| | Wall | Level | Prestiges | Time (fighting / grinding) |
|---|---|---|---|---|
| Solo Hero | P0 W8S10, needs 430 | 401 | **0** | 10d 11h (2h 38m / 10d 8h) |
| Party of 3 | P1 W2S10, needs 588 | 559 | 1 — the first took ~6½ days | 10d 13h (3h 31m / 10d 9h) |

Every blocker in a party of three's first prestige is a boss timer. Level to clear the first loop's final gate: 524 solo, 494 with a party of three (`--report=gates`).

Note: by roughly prestige 15–20, raw numbers will exceed standard float precision. Plan for scientific notation display or a big-number library (e.g. `break_eternity.js`) ahead of time.

---

## 2. Stage Types & Completion Rules

Each world's 10 stages break down into four archetypes:

| Stages | Type | Enemies | Progression rule |
|---|---|---|---|
| 1–4 | Regular wave | Regular mobs | Kill count required to advance |
| 5 | Boss | Boss + a couple regular mobs | Defeat boss within time limit |
| 6–9 | Elite wave | Buffed ("elite") variants of regular mobs | Kill count required to advance |
| 10 | Super boss | Super boss | Defeat super boss within time limit |

- **Kill count:** baseline **30**, does not scale with world/prestige — difficulty comes from enemy stats, not enemy count. This should be implemented as a single easily-tunable constant (e.g. `BASE_KILL_COUNT`) rather than hardcoded per stage, since it's expected to change often during balancing. It can later be reduced via prestige-shop upgrades (Section 4) or other future mechanics.
- **Boss/super boss timer:** flat 30 seconds, same at both Stage 5 and Stage 10.
- **Fail state:** if the boss (or super boss) isn't killed within the time limit, **or** the party dies, the player is sent back one stage to farm — Stage 5 failure returns the player to Stage 4, Stage 10 failure returns the player to Stage 9. This gives a natural grind-and-retry loop: fall back, farm the previous wave for gold/XP/levels, then attempt the boss again.
- **Engagement — revised 2026-08-18, a deviation from this doc's original rule.** This section said a failed boss is "**not** auto-retried; the player must manually choose to re-engage." The game now **engages a boss automatically while the page is visible** (`document.visibilityState`), a moment after the run reaches the gate — on first arrival and on every re-arrival after farming back. A backgrounded tab, a closed app and an offline settle still never engage one, so the presence requirement and its consequence (Void Shards cannot be earned from idle time) are intact; visibility is simply a more direct reading of presence than a button press. A manual engage button remains. Decided in code rather than in a doc revision — recorded in `open-items.md` #25.

---

## 3. Prestige Reset Rules

**Revised — Hero level now persists too.** The only things that reset are run position and run-scoped run state:

| Resets on prestige | Persists on prestige |
|---|---|
| World/stage position → World 1, Stage 1 | **Hero level & XP** (revised — no longer resets) |
| Stage kill-count flags, run-scoped buffs | Hero's class node & "already seen" node history |
| | Champion roster, levels, stars/dupes (Guild gacha) |
| | Skill roster & levels (Training Grounds gacha) |
| | Artifact roster & levels (Dig-site gacha) |
| | Gear roster & levels (Forge gacha) |
| | Trait slots, Trait save slots |
| | Loadouts, formation, equipped everything |
| | Raid state (frontier levels, Key balances) |
| | Arena state (Medals, defense loadout; Rating resets by *season*, not prestige) |
| | Gold, Gems, Void Shards, all Seals/Essence/Keys/Trait Gems |
| | Prestige-shop purchases |
| | Lifetime stats/achievements |

**Locked: Hero level never resets — not on prestige, and not when switching class.** The player carries their level through every prestige, and carries it *across* a class switch as well: picking Warrior after a run as a Mage keeps the level intact, only the node (and therefore the stat spread and inherited kit) changes. There is no relevel-from-1 anywhere in the game.

**What this changes, stated plainly, since it's a large shift:**
- **The class picker becomes a genuine build choice rather than a cost.** Previously, switching class and staying put were mechanically identical (both reset you to level 1), so "try something else" carried an invisible tax of re-earning your level in the new node. Now the level is yours; the only thing that changes is which spread it multiplies into. Experimenting across the 16-node tree is free.
- **The "steamroll the early worlds" feel gets much stronger.** A post-prestige player re-enters World 1 with their full level *and* their full collection against an enemy curve that simply keeps climbing (no prestige dip under the continuous index, §1). That's intended — the early worlds are meant to be a victory lap, with the wall arriving later in the run.
- **XP stops being run-scoped.** `gold-economy.md` §2 lists XP as *"free to follow enemy value — it's run-scoped (Hero resets to Lv1 at prestige)."* That justification no longer holds; XP is now a permanent, unbounded-growth quantity and needs the same Decimal/text treatment as combat stats (`tech-architecture.md` §2 already stores `heroXp` as text/Decimal, so the implementation is already correct — only the reasoning was stale).
- ~~**Pacing needs a re-check.**~~ **Resolved differently.** `gold-economy.md` §9's prestige→calendar mapping turned out not to exist at all — prestige count tracks power, not time — so Gold now reads wall-clock account age instead (`gold-economy.md` §3a) and no longer cares how fast prestiges resolve.

**Design intent:** wiping the four gacha collections each prestige would erase real investment and kill retention. Keeping everything persistent while resetting only world position produces a satisfying "steamroll the early worlds" feel right after a prestige, tightening up again deeper into the run. Gold persists too — it's the platform's regular global currency (see Section 4), not a run-scoped resource, so there's no reason to zero it out on reset.

**Resolved:** no level-cap gating system, and no level reset either. Hero and Champion levels are uncapped *and* fully persistent across every prestige — the exponential enemy curve is bounded within a prestige tier, so continuous uncapped leveling alone is enough headroom without needing either a cap-raising mechanic or a reset.

---

## 4. Prestige Currency

**Platform context:** the target platform provides two global currencies out of the box — **Gold** (regular currency) and **Gems** (premium currency), both per-user, shared across every game on the platform (not shared between players, no real-money purchase path). Gold is earned from idle stage farming (kill-count progress, Section 2) and persists across prestige (Section 3), **but follows its own bounded curve deliberately decoupled from this doc's `enemyMultiplier`** — Gold cannot ride the exponential enemy curve since it lives on a fixed-precision shared platform column; see `gold-economy.md` (Locked) for the full formula and reasoning. **Resolved (was previously open): the prestige currency described below is Void Shards, a new currency dedicated to this game** — not Gems, not Gold; see `economy-and-currencies.md` §3 (Locked) for its full source/sink specification. The mechanics below describe the prestige currency's earning/spending shape; the concrete formula constants are calibrated in that doc.

**Earning:** fixed payout, granted only on a full clear of World 10 / Stage 10 — no partial credit for an incomplete run. Payout scales with which prestige tier is being completed, since a higher-prestige full clear represents far more difficulty:

```
prestigeCurrencyEarned(prestigeCompleted) =
    BASE_CURRENCY × CURRENCY_GROWTH^prestigeCompleted
```

Starting point: `BASE_CURRENCY = 100`, `CURRENCY_GROWTH = 2` → 100 / 200 / 400 / 800 / ... Keep `CURRENCY_GROWTH` well below the enemy curve's ≈×2,200 per loop; it only needs to outpace shop upgrade costs, not match the power curve 1:1. Exact tuning depends on the eventual shop cost curve.

**Design note:** this pairs with the soft fallback fail state — since a run can never permanently lose progress (only fall back a stage), "must reach World 10 to get paid" doesn't carry true failure risk, just time cost. If early playtesting shows the *first* prestige (before any shop bonuses exist) takes unreasonably long with zero payoff en route, that's the one assumption worth revisiting.

**Spends on (shop, permanent):**
- Idle/offline efficiency%
- **Slot expansions — same pattern across the three slot-based collectible systems:** Champion slots, (gacha) Skill slots, and Artifact slots each start at **2** and cap at **5**, via **3 permanent purchase levels** apiece (2→3, 3→4, 4→5) — 9 purchase levels total. See `champions-guild-gacha.md` §1, `skills-gacha.md` §6, and `artifacts-dig-site-gacha.md` §7. **Gear/Forge has no slot track** — all 6 of its slots are available from account start by design (`gear-equipment.md` §1).
- Kill-count reduction% (lowering the per-stage requirement below its base 30) or boss-timer extension (small, expensive)
- **Raid Key daily-grant-rate — 5 independent tracks, one per raid** (Guild/Training Grounds/Dig-site/Forge/Trait), each raising that raid's Key grant above the 3/day baseline, with its bank cap scaling to match the upgraded rate. Same one-track-per-system pattern as the slot expansions above, applied to `raid-system.md` §3's Key mechanic (Locked).

---

## 5. World Themes

**Fixed pool, no reskins** — the same 10 worlds, with the same art and the same enemy rosters, appear identically in every prestige run.

**World 10 is The Void.** `economy-and-currencies.md` §3 names the prestige currency **Void Shards** after it, with the lore tie "reach the end and reset stronger" — load-bearing on a locked currency name, and kept by the naming pass.

**Named 2026-09-15.** The run is a walk toward the source: the archmage of Duskspire opened a door to the Void, the cracks it left spread outward through the kingdom, and a run starts at the farthest frontier — where the damage is only feral hedgerows — and walks inward, past the door and out through the edge of the world into The Void. The theme line is each world's art brief. Elites share the trash roster's name; they are the same enemies, stat-buffed.

| # | World | Theme | Enemies | Boss | Super boss |
|---|---|---|---|---|---|
| 1 | Thornwick Vale | Frontier farmland at the edge of the kingdom, where the first cracks have turned the hedgerows feral | Bramble Warband: Bramble Goblin, Thornhide Hobgoblin, Scarecrow Stalker, Hedge-Witch | Old Gnarlhide | Gorsecrown, King of Hedges |
| 2 | Mirewood | A drowned forest of black water and hanging moss, rotting from the roots up | Mire Brood: Bog Lurker, Peat Brute, Reed Spitter, Bog Crone | Mother Leech | Rotheart, the Sunken Elder |
| 3 | Cinderpass | A volcanic mountain pass choked with ash, held by kobold clans and the thing they worship | Cinder Clan: Cinder Kobold, Slag Golem, Ash Imp, Salamander Firecaller | Slagjaw | Pyrrhax, the Molten Wyrm |
| 4 | Rimeholt | A frozen northern hold whose raiders swore themselves to a cold that does not end | Frost Host: Frostbound Raider, Rime Troll, Snowfield Huntress, Rune Skald | Jarl Hrimgar | Vinterhel, the Glacier Titan |
| 5 | Sunken Amarath | The drowned capital of a sea-empire, its dead still keeping the tides | Drowned Crew: Drowned Sailor, Barnacle Brute, Harpoon Siren, Tide Priestess | Tidecaller Nerine | Queen Maerith of the Deep |
| 6 | Duskspire | A city of mage-towers held at twilight since its archmage opened a door to the Void | Hollow Conclave: Hollow Acolyte, Spire Gargoyle, Spellbound Construct, Riftbound Magus | Magister Halvane | Archmage Ithren, the Door-Opener |
| 7 | The Bonefields | An ancient battlefield where the fallen of a forgotten war rise to fight it again | Restless Legion: Restless Legionnaire, Barrow Ghoul, Bone Archer, Ossuary Priest | Grave Marshal Korr | Ossuar, the Thousand-Bone Host |
| 8 | The Shattered Sky | Islands of torn-loose stone adrift in a storm the Void has unmoored | Storm Swarm: Skyshard Wisp, Thunderhead Golem, Harpy Raider, Squall Caller | Stormcrown Roc | Zephyrax, Breaker of Heavens |
| 9 | The Brink | The last ground at the edge of the world, where the storm has burned out, the sky has gone to stars and everything left is falling toward the Void | Unravelled Host: Unravelled Knight, Tethered Brute, Starfall Archer, Last Seer | Sister Vesper, the Forgotten | Liminus, the Last Door |
| 10 | The Void | Nothing, pressing in — where every crack leads, and where each run ends before it begins again | Void Horde: Void Thrall, Void Maw, Starved Wraith, Void Augur | Void Herald | Nihil, the Hunger at the End |

The source of truth is `shared/utils/hero-quest/content/worlds.ts`; the wiki's Content page renders it, and `asset-list.md` §1.4 mirrors this table as the art brief — where it also locks that **every enemy is styled to its world**. Names only — stats come from Section 1. Enemies have no abilities of their own yet. No tier bumps or visual re-theming between prestiges — this keeps art scope minimal for a small team. Difficulty is communicated entirely through the stat curve (Section 1), not through visual differentiation between prestiges.

---

## Next sections to define
- ~~**World themes & enemy/boss design (specific rosters)**~~ — named in §5, and fully briefed for art in `asset-list.md` §1.4 (2026-09-17: 4 weapon variants per world on shared rigs, 4 animation states, 5 for bosses). Still open: production itself, and whether enemies get their own ability kits (`open-items.md` #6).

*(Classes & combat, all four gacha systems, and idle mechanics & economy are all now Locked in their own docs — see `index.md`.)*
