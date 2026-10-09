# What still needs attention

**Only open items live here.** Refreshed 2026-09-17, against the code on the `hero-quest` branch.
Everything that landed moved to `build-log.md` on that date — this doc had reached 604 lines of
which the large majority was a record of finished work, and it is on the always-read list, which
made it the most expensive bloat in the project.

**Item numbers are the originals and are never reused.** Eleven docs, `constants.ts` and two
scripts cite them (`#22`, `#23.3`, `#18.6`). The gaps below — #4, #5, #8, #10–#21, #24, #26–#28 —
are finished items, not missing ones; they are in `build-log.md` under the same number. #22, #23,
#25 and #29 appear in both: the open part here, the full record there. New items continue from
**#55** (#51 and #52 are taken by parallel work) — #30 was raised and decided on 2026-09-17, and is in `build-log.md`; #31 opened 2026-09-28, #32 on 2026-09-29; #33, #34 and #35 were decided on 2026-10-02 and are in `build-log.md`; #36 landed 2026-10-03 with its pacing half open; #37 landed the same day; #38 to #42 landed 2026-10-04; #43 opened the same day, #44 landed and #45 opened with it, and #6, #3, #31 and #32 were decided (all in `build-log.md`); #46 (raids) landed 2026-10-05; #45 (boss specials) landed 2026-10-08 with its open half below, and #47 (the login calendar) the same day; #48 (milestones) landed 2026-10-09, and #43 (the Ascendant) was decided, built and its art locked the same day, closing it; #49 opened with it, and #50 (the tutorials, backlog item 10) was picked up; #53 (holiday gifts) and #54 (per-raid Loadout auto-apply) were built the same day, each with an open half below.

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
| 47 | #29 above: the free 10-pull is the only thing a clock hands out; `economy-and-currencies.md` §5: Seals come in milestone and raid chunks, never a drip | **The login calendar is a second clock.** It pays Seals on some of its thirty days, alongside Gold, Gems, Raid Keys, Trait Gems and, on day 30, Void Shards, each day claimed in person (2026-10-08, the user's call: any currency the game grants may be on it). Built outside the phase plan, from backlog item 12. `build-log.md` #47 |
| 48 | `economy-and-currencies.md` §5 source 1: milestones are core-progression feats, never a gacha's own progress, so each grants all four Seal types; the World-clear and prestige batches pay on the event | **Milestones are claimable tracks** (`milestones.ts`): a formula per kind of feat, not a list. Worlds and prestiges still pay all four Seal types, now claimed in the Milestones scene rather than paid on the super-boss win and the prestige, and a prestige adds Gems. Two kinds are a gacha's own progress after all: a **collection** pays its gacha's Seals and a **raid** its Keys (2026-10-09, the user's calls). A boss's Seals still pay on the win. Built outside the phase plan, from backlog item 11. `build-log.md` #48 |
| 43 | `classes-and-combat.md` §1, §5 and throughout: a 16-node tree, one parent per node, a kit that accumulates down one path. `loadouts.md` §1–2: five components, and the Hero's class "correctly excluded" | **A 17th class, the Ascendant**, past the tree and joined to all six masters, with no single parent. It opens once a prestige has been completed as each master, takes a token, and **picks any 4 class skills** across paths plus **Convergence**, every master's skill at once; its stats are the best master's in each. Its picks are **a sixth Loadout component** (the class itself still isn't one). The user's calls, 2026-10-09. `capstone-class.md`, `build-log.md` #43 |
| 31 | `raid-system.md` §1/§7, `asset-list.md`, `economy-and-currencies.md` §9: the Training Grounds Raid is a `solo_boss` fight, its Keys spent only on a win | It is a **`training_dummy`**: a static dummy that can't die or attack, the result being the damage dealt before the timer ends (2026-09-28, the user's call). Keys, the ladder and rewards follow Rampaging Boss's rules, the level reached on live damage thresholds; it has no DEF (decided 2026-10-04, `build-log.md` #31) |
| 32 | `raid-system.md` §1/§7, `asset-list.md`, `asset-checklist.md`: the Forge Raid is one `phased_boss` whose phases change at HP thresholds | It is a **`boss_gauntlet`**: three bosses back to back, the Apprentice, the Journeyman and the Forgemaster (2026-09-29, the user's call). One 30 s clock for the run, 10 s back per boss killed; all three or nothing; each boss steps up (decided 2026-10-04, `build-log.md` #32) |
| 36 | `classes-and-combat.md` §3: SPD reduces cooldown duration across the board, off the same curve as the autoattack; every skill on `SKILL_BASE_COOLDOWN_SECONDS` | Cooldowns read **`cooldownSpd`**, SPD without the level curve; the autoattack still reads the full stat. Cooldowns sit on a **rank ladder** (`SKILL_COOLDOWN_RANK_STEP`): rarity for Skills and Champion abilities, tree depth for class skills, hit size scaled to match. §3 updated in place (2026-10-03, the user's call) |
| 37 | `core-progression-and-prestige.md`, `settle.killsBeforeWipe`'s old contract: a wave wipe restarts the stage at once and income continues unbroken | Each wave wipe costs **`WIPE_RECOVERY_SECONDS` (5s)** with nothing landing, served across settle windows via `hq_state.recovery_seconds`. Still no ground lost (2026-10-03, the user's call) |
| 38 | `CLAUDE.md` §3 and #25: every boss engages automatically while the tab is visible, never from a button | **A boss that just beat the party** (a timeout or a wipe) does not re-engage on reaching its gate again. The stage shows a red skull challenge button in place of the stage progress, and the player fights it from there. Saved as `hq_state.boss_lost` (migration `0050`), set by the fight that loses and cleared by the one that wins, so it holds across reloads and coming back later; run position, so a prestige clears it. Presence still gates every fight (2026-10-04, the user's call) |
| 40 | `loadouts.md` §3: Loadout slots run 2 → 10, eight Gem-priced purchase levels | **2 → 6**, four levels on the same doubling (`MAX_LOADOUT_SLOTS`). Saved rows past slot 6 are never served. The Loadouts scene shows the six as two rows of three cards (2026-10-04, the user's call) |
| 41 | `build-log.md` #11.4: the prestige-shop stat multiplier is cut, struck from the sink lists in `core-progression-and-prestige.md` §4, `economy-and-currencies.md` §4, `tech-architecture.md` §3 and `global-power-number.md` §3 | **Back, as four uncapped tracks: PWR, DEF, IMP and VIT**, party-wide (summed with equipped Artifacts' lines). Each level adds `PRESTIGE_STAT_PER_LEVEL` of the stat; the price climbs on `PRESTIGE_STAT_COST_GROWTH` from `PRESTIGE_STAT_BASE_COST` Void Shards, forever. SPD and LCK are left out because they run into ceilings (the attack-interval floor, the crit clamp). Page 2 of the shop scene. The campaign sim buys none, so pacing does not account for them (2026-10-04, the user's call) |
| 42 | `core-progression-and-prestige.md` and `pickableClasses`: a class pick is legal "at a prestige" (anything seen, or one tier deeper) — and in practice at any time, since nothing gated it | **A class token**: every prestige grants one (`hq_state.class_token`, migration `0051`; a flag, so a second prestige while holding one changes nothing), and taking a class **never reached before** — one tier deeper than the current — spends it. Switching back to any class already reached is free at any time. A new account starts without one, so everyone plays the Beginner until their first prestige. The class tree is its own scene and menu item; prestiging happens only through Begin Again on the bridge, which now raises the Void Shards it paid over the Hero (2026-10-04, the user's call) |
| 44 | `idle-mechanics.md` §3: Battle Speed tiers 2x/3x/5x/10x, anchored at 50 Gems for 2x/30 min | **2x/3x/5x**, anchored at **250 Gems** (the old 10x price), both axes' rules unchanged. 10x was cut because at 10x the largest offline collect cleared the balance column by 1.87 orders of magnitude against the specs' 2. A second purchase of the running speed extends the block from its end; another speed is refused until it ends. §3 updated in place (2026-10-04, the user's calls) |
| 44 | `gold-economy.md` §7: Seal-ladder growth 1.0007 (Guild, Dig Site) and 1.0011 (Forge, Training), sized so Gold completes a roster in ~6 months | **1.2 for all four**, set by feel: a day's first 10-pull is ~21M, the fifth ~14.7B, so Gold buys a few extra 10-pulls a day rather than completing a roster. There is no Seal button: a pull short of Seals buys them itself, at the price its button shows. §7 carries a dated note (2026-10-04, the user's call) |
| 39 | `gear-equipment.md` §3 ("every *other* owned piece … contributes a smaller passive bonus **instead**"), `build-log.md` #28's collection passives ("an equipped copy is never counted twice") | The collection passive is **additive with equipping** for Gear, Skills and Artifacts, as it already was for Champions: every owned copy pays its owned share, and an equipped one adds its full bonus on top. `gearModifiers`, `skillCollectionModifiers` and `artifactCollectionModifiers` changed; an equipped item is worth ~10% more than before (the share is 0.1 of the full line in all three). The campaign walk is unchanged — it models no collection. The Collections detail shows the two blocks, "In collection" always active once owned (2026-10-04, the user's call) |

---

## 🔷 Open questions — need your input

### 2. Arena matchmaking band width
`ARENA_MATCH_BAND_PCT` — how close in GPN does an opponent need to be to appear as a real candidate before Training Dummy fills the slot? Design-feel question as much as a number.

---

## 🔴 Genuinely undesigned — full passes, not edits

### 50. Tutorials with a guide character (backlog item 10) — **🚧 in progress, @rtgschepers, 2026-10-09**
Picked up 2026-10-09; ask before starting on it. **Decided** (the user's calls): the guide is **a snail familiar**, working name Shellby (`GUIDE_NAME`, display only), unhurried and a little wry; the unlock schedule below; and **announce, then explain**: a line when a scene opens, two or three short pages the first time it is visited, plus an intro on a new run.

| Opens at | Scenes |
|---|---|
| Start | Battle, Settings |
| World 1 boss beaten | Gacha, Collections |
| 1 World cleared | Milestones, Calendar |
| 2 Worlds cleared | Loadouts, Battle Speed |
| 4 Worlds cleared | Raids |
| The run cleared | Prestige |
| First prestige | Classes |

**Built** (`FEATURE_UNLOCKS`, `shared/utils/hero-quest/tutorials.ts`, `content/tutorials.ts`): unlocks are derived from lifetime progress, never stored, and **enforced on the server** (`requireFeature` in every feature's routes, a 403 naming the checkpoint), so they can't be reached early. The tutorials seen are `hq_state.tutorials_seen` (migration `0059`); resetting them (Settings) locks nothing. The menu band shows only open scenes, a new one dotted until visited; a closed scene reached by a link falls back to the battle; the guide waits out boss and raid fights, and stays away while "show tutorials" is off.

**Open:** the snail's art round (its portrait is a placeholder drawn in `guide.ts`), and its name.

### 7. Passive Skill Tree (backlog item 3)
Unchecked. Hero-only passive tree, generic root splitting into 3 paths, nodes up to 5 levels each, purchased via its own dedicated raid, with Champion/item side-nodes allowed but never gating a path. Structurally sound to build (raids don't have to be gacha-paired) but has had no dedicated design session.

### 9. Holiday gameplay events
Explicitly deferred scope — the gift-mechanic phase is locked, but limited-time modes/content were never started.

---

## ⚠️ Open consequences of work that landed

Eleven items are built and working but left something undecided. The full record of each is in
`build-log.md`; only the open half is restated here. (The `killFraction` invariant that used to
sit here as #24 is not an open item — it is a trap, and it lives in `CLAUDE.md` §7 and
`build-log.md` #24.)

### 22. The combat and progression tuning pass — three open consequences

Full record: `build-log.md` #22. 42 constants moved to `// TUNED ✓` and the level curve was
re-derived as a pacing model. What it left open:

1. ~~**A solo account never completes a prestige** without pulling.~~ **Decided 2026-10-09: intended**
   (the user's call). The boss gate is the wall and Champions are the answer to it, so no prestige
   without a party is the design, not a side effect. Record in `build-log.md` #22.
2. **The Gold curve was calibrated against the old loop speed** — see #23.
3. **`STAT_PACES_ENEMY_CURVE` is inert while `XP_PACE_SLACK` is 1.0**, because both stat curves
   are then numerically identical. Keep it: it starts mattering the moment slack moves.

⚠ The `TUNED ✓` legend says "confirmed in playtest", but `playtest-notes.md` records only
session 1. The block was tuned on the campaign sim, not felt.

### 45. Boss specials are real — built; what the sims don't see

Full record: `build-log.md` #45. Every gate boss swings its special in place of an attack, on a
fixed cooldown, with damage and a status or a drain. What it left open:

1. **The campaign walk and the idle projection don't model specials.** Both are
   expected-value models with no boss kit in them, so `--report=campaign` reads exactly as it did
   before. They were measured on seeded `runFight` gate fights instead: a party of three needs
   1 to 4 more levels at six of the twenty gates (the stuns, silence, weaken, slows and drain),
   and none at the rest. Solo is the same, World 1's boss +4. No gate fight wipes either way,
   since the gates are DPS walls. Fold specials into the sim if their numbers grow to where that
   matters.
2. **All eleven magnitudes are `UNTUNED ╧`** (`BOSS_SPECIAL_*`). Pure-damage specials cost
   nothing at the current values: a party at a gate's level is in no danger of dying, so extra
   incoming damage shows only once something else pushes a fight long.
3. **No Artifact carries Unshaken.** `controlResist` is live now (it shortens every hostile
   status a special lands), but the 48-Artifact distribution never draws Unshaken from the Tempo
   pool, so only the Skills Unbreakable Will and Immortal Vanguard grant it. Worth a look when
   the Artifact effects are re-cut (`CLAUDE.md` §6).

### 47. The login calendar — built; its Gold and Gem days are placeholders

Full record: `build-log.md` #47. Thirty fixed days per account cycle, three make-ups. What it left
open:

1. ~~**`CALENDAR_REWARDS` is one `UNTUNED ╧` table.**~~ **Sized 2026-10-09 (the user's call):** a
   Seal, Key or Trait Gem day pays days of that currency's regular income, a day of raid clears at
   raid level 1 (free pulls not counted), climbing evenly from `CALENDAR_INCOME_DAYS_FIRST` (¼) on day 1 to
   `CALENDAR_INCOME_DAYS_LAST` (1) on day 30. Both dials are `UNTUNED ╧`. A cycle now pays
   1–1.5 days of each gacha's raid Seals (7–13 Seals, from 4–6), 2.4 days of Trait Gems (73, from
   50) and the same Keys as before. Day 30's 200 Void Shards is the user's number. The Gold minutes
   and Gem counts in `CALENDAR_SCHEDULE` are still guesses, below.
2. **Rebalance its Gold and Gems after the Gold balance step** (step 7 of the *Suggested order*,
   #23; the user's call, 2026-10-08). A Gold day is minutes of current income (`gold-economy.md`
   §6), so it is exactly as right as the unreconciled Gold curve, and the Gem days (25, 50, 75 a
   cycle, platform-wide) are sized against nothing yet.
3. ~~**No Battle Speed days.**~~ **Decided 2026-10-09: left out** (the user's call). A free block
   can't start while a bought block of another speed runs (`idle-mechanics.md` §3), and neither a
   refused claim nor a queue was worth it.

### 49. Convergence plays as one cinematic in the game — **new 2026-10-09**

The Ascendant's design and art are complete and locked (#43, `build-log.md`), and the gallery's
live stage plays the Convergence cinematic. The game doesn't yet: its run stage plays a cinematic
only for a class's own skill (`demo.ts`, `setKits`), and Convergence's volley casts as the six
masters' skills, so idle play shows their six small effects and a boss replay would play each
master's own cinematic back to back. The fix is engineering, not design: tag the volley's six
entries (`CONVERGENCE`) as one cast the stage can recognise, and play `skill_convergence`'s
cinematic once for them, its six hits landing the volley's damage.

### 48. Milestones — built; every number is a placeholder

Full record: `build-log.md` #48. Eleven tracks, each a formula rather than a list. What it left
open:

1. **Eleven of the twelve `MILESTONE_*` constants are `UNTUNED ╧`.** The twelfth,
   `MILESTONE_RAID_LEVEL_EVERY` (5), comes from backlog item 11. The World and prestige Seal bases carry over the old batch sizes (3 and 10);
   every growth step, the collection step and the Key and Gem amounts are guesses. Prestige Gems
   (50, then 25 more a prestige) are platform-wide, so they reach past Hero Quest. Size them with
   the calendar's Gem days in step 7 of the *Suggested order*.
2. ~~**Accounts with history claim it again.**~~ **Decided 2026-10-09: accepted, no migration**
   (the user's call). Hero Quest has never reached `main`, so production starts with no `hq_state`
   rows and no history to re-claim. Record in `build-log.md` #48.
3. **The campaign sim doesn't see milestones.** Seal income isn't part of the walk, so this changes
   nothing it measures. Pull-pacing questions (#23.2, the Seal ladder) now have this source to
   account for.

### 53. Holiday gifts — built; the bundles are placeholders

Full record: `build-log.md` #53. Four holidays, a claim each per year, in a three-day UTC window.
What it left open:

1. **`HOLIDAY_GIFTS` is one `UNTUNED ╧` table**, and `HOLIDAY_CLAIM_WINDOW_DAYS` (3, the holiday
   counted) is §2's "e.g." taken at its word. The bundles follow §3's shape (Christmas richest,
   Halloween smallest, themed Seals); every amount is a guess. Their Gems are platform-wide, so
   size them with the calendar's Gem days (#47) and the prestige milestones' (#48) in step 7 of the
   *Suggested order*, and their Gold after the Gold decision (#23), like the calendar's.
2. **Lunar New Year's table ends at 2050**, and takes the date in China as the UTC day. A spec
   fails once the table is within twenty years of running out.
3. **`holiday-events.md` §2 models the claim on `seals/claim-daily.post.ts`**, which #29 retired
   (`tech-architecture.md` §5 still lists it). The login calendar (#47) was the model instead; no
   rule moved.

### 54. Per-raid Loadout auto-apply — built; choices made without asking

Full record: `build-log.md` #54. Each raid points at a saved slot from a picker on its own screen;
a fresh engage snapshots and applies, leaving reverts. What it left open:

1. **The run's boss closes the session.** Bosses engage under every scene, and the run's gate is
   not the raid's fight, so a boss that fires while the player sits on the Raids scene fights on
   the player's own loadout and the next raid engage applies the preferred one again.
   `loadouts.md` §4 only says "on leaving the raid"; flip it if a boss should fight on the raid's.
2. **The picker cycles** through the saved slots and none, rather than opening a list.
3. **A preferred Loadout that can't be applied refuses the engage** (nothing spent) rather than
   fighting on the live one. `loadouts.md` §1 says a Loadout never goes stale, so this should only
   happen after a roster edit drops an ID.
4. **Idle accrual during a session runs on the raid's Loadout**: the run never stops, and the
   session is short. A session the client never closed reverts on the first read once the game
   session has timed out (`HQ_SESSION_TIMEOUT_MS`), before that read's settle.
5. **The Arena's pointer is stored but unread.** `arena` is a valid target (#1); the Arena's attack
   calls `engageLoadout(…, 'arena')` and its own leave when it is built.
6. **`tech-architecture.md` §3 said a 5-entry map**, one per raid; #1 (the user's call,
   2026-10-04) and `loadouts.md` §4 add the Arena. Built per #1, and §3 now says so. The leave
   route, `raid/leave.post.ts`, is new to §5.

### 36. Cooldowns off the level curve — the pacing half is deferred to playtesting

**What landed (2026-10-03).** The battle stage showed skills firing back to back: SPD rode the
geometric level curve into `cooldownFor`, so every class hit `MIN_COOLDOWN_SECONDS` (0.5s) by
level ~200 — the LCK trap again. Three options were weighed: freeze SPD outright (like LCK),
clamp the reduction to a fraction of base, or **split SPD's two consumers**. The split was chosen.
`UnitStats.cooldownSpd` is the unit's SPD built at level 1, every multiplier (collection passive,
Gear, Skills, Artifacts, Haste) kept. The autoattack still reads the full stat and still reaches
5/s around level 190. Freezing SPD outright was measured first and rejected: it removed ~9× of
late DPS and moved the whole game clear by ~58 levels.

Cooldowns now sit on a ladder, `SKILL_COOLDOWN_RANK_STEP ^ rank` × the base (`effects.onCooldownRank`):
rarity for Skill Actives and Champion abilities (a Champion's ability takes *its Champion's*
rarity, since the 7-ability pool is shared across rarities), tree depth for class skills.
`abilityMultiplier`, heals, shields and bursts scale by the same factor, so damage per second holds
and a better ability is a bigger, rarer hit. **Status durations stretch rather than magnitudes
growing**, which keeps uptime fixed — debuffs clamp at zero, so a deeper Weaken on a slower cadence
would have deleted enemy PWR. Coin Toss and Prospector's Instinct stay on
`GOLD_BURST_COOLDOWN_SECONDS`, off the ladder.

**What is open — the pacing.** Skills at 0.5s were a large share of late damage, so with a party
of three every gate moves 2–13 levels later (game clear 494 → 506) and **the first prestige goes
from 6.4 to ~13.7 days** (summed fights + grind to W10S10, `--party=3 --grind-hours=200`). Solo
is unchanged, since the Beginner's only skill is Haste. One dial would restore the week —
`BASE_ENEMY_HP` 60 → ~36 measured 7.9 days at 40 — but it also makes World 1 easier, and the user
chose to leave pacing alone until more playtesting (2026-10-03). Two more things to settle then:

1. **Long cooldowns lose their tail inside `BOSS_TIMER_SECONDS`.** The first cast waits a full
   cooldown, so a Mythic ability (~15.9s at step 1.2) fires once in a 30s boss fight. Damage per
   second is equal on average only; in boss fights the ladder is a slight nerf to rare kits.
2. **The step itself is a placeholder** (`// UNTUNED ╧`), shared by both ladders.

### 37. A wave wipe costs recovery time — built; its feel is unmeasured

**What landed (2026-10-03, the user's call).** A wipe used to cost nothing: the attempt restarted
in the same instant, every kill kept paying, and the stage showed a 1.6s fall. Now each wave
wipe is followed by `WIPE_RECOVERY_SECONDS` (5s, a decision) with nothing landing and nothing
earned. `settle.walkWall` walks a walled stage in closed form (attempt, recovery, attempt), and
`settle()` and the client's `projectRun` both call it, so they agree. A recovery cut short by a
read persists as `hq_state.recovery_seconds` (migration `0049`) and is served first by the next
window, offline included. Everything that resets run position zeroes it. On the stage the party
lies where it fell for the whole recovery, the scene sinks toward dark red, and a `DEFEATED`
banner counts down to the next attempt.

It bites only while walled, and harder the shorter the attempts: a party wiping every 10 kills at
2s/kill earns 80% of its old rate; one wiping every 2 kills, a third. **Pacing barely moved.** The
campaign walls at boss timers, not wave wipes, so the party-of-3 walk is unchanged and the early
solo wipe grinds are ~5% longer (`sim.ts` charges the recovery per attempt,
`secondsPerFarmedKill`). Boss losses are untouched: still fall back one stage, re-kill 30, retry.

**Open:** whether 5s reads as a penalty or just as a pause. Watch it in play.

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
still allowing 7,200, the worst case is **12× platform**. **Battle Speed multiplies straight
through it**, with no second ceiling underneath. That was a warning about an unbuilt system until
2026-10-04; Battle Speed is built now (`build-log.md` #44), so at its 5x top tier
(`MAX_BATTLE_SPEED`) the live worst case is **60× platform** while a block runs. The column specs
already use `MAX_BATTLE_SPEED`; whether income needs a second ceiling is part of the #23.3 call.

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

Named constants with a formula shape locked and a placeholder value. Consolidated so a tuning pass has one list. `rg '╧' shared/utils/hero-quest/constants.ts` is the authority — **97 markers** as of 2026-10-09 (`rg -c` prints 99: the file's header legend carries the glyph twice), up from 61 on 2026-09-16 with the raids (#46), boss specials (#45), the login calendar (#47), milestones (#48), the Ascendant (#43) and the holiday gifts (#53). Every marker has a row below; the Arena row's constants are not in `constants.ts` until the Arena is built.

~~**Decided: none of this is tuned before playtesting.**~~ **Superseded for the combat and progression block by #22**, which tuned it on the campaign walk. The original reasoning still holds for everything that remains below: the balance script and campaign sim project *what the formulas say*, and a projected value that feels wrong in play is worth less than no value, because it looks settled. What remains is mostly the gacha, shop and ability-magnitude layers, which the campaign walk barely exercises — so they want play data or a different measurement, not another sim pass.

**Do not treat any of these as blocking a phase.**

Two rows are not constants in the strict sense: the archetype stat spreads are a table, and `SEAL_LADDER_BASE_GOLD` *is* specified. Both are listed anyway because the same pass answers them.

**Removed from this table**, so they are not re-added by mistake — now `TUNED ✓`, derived, or deleted (#22, #23, #29): `SEAL_GRANT_INTERVAL_HOURS`, `SEAL_GRANT_AMOUNT`, `SEAL_GRANT_BANK_CAP_DAYS`, `FREE_PULLS_PER_DAY`, `FREE_PULL_COOLDOWN_MINUTES`, `K`, `CRIT_CHANCE_PER_POINT`, `CRIT_DAMAGE_PER_POINT`, `SKILL_BASE_COOLDOWN_SECONDS`, `SKILL_BASE_ABILITY_MULTIPLIER`, `WAVE_PACK_SIZE`, `ELITE_PACK_SIZE`, `PACK_LIVE_STREAM_FRACTION`, `BOSS_MINION_COUNT`, `STATUS_MAX_STACKS`, `STATUS_TICK_SECONDS`, `MAX_SUSTAIN_MITIGATION`, `MIN_SECONDS_PER_KILL`, and `GOLD_PRESTIGE_CAP` / `prestigeGoldFactor[]` (deleted). From the raids (#46): `RAID_REWARD_BASE` / `RAID_REWARD_GROWTH` (set by the user, 2026-10-04), every `RAID_*_HP_MULT`, `RAID_DUMMY_PACKS` and the three `RAID_RAMPAGE_*` (measured on the campaign walk, `TUNED ✓`); `RAID_BASE_STATS` and `RAID_LEVEL_GROWTH` were never built under those names.

| Constant(s) | Doc | Note |
|---|---|---|
| Offline Efficiency / Offline Cap `BASE_COST` (×2) | `idle-mechanics.md` §4 | Formula shapes locked, no anchor value |
| `K_ATTACK`, `K_DEFEND`, `MEDAL_BASE_WIN`, `MEDAL_BASE_LOSS`, `MEDAL_UPSET_BONUS`, `ARENA_MATCH_BAND_PCT`, `ARENA_SHOP_GEM_PRICE` | `arena.md` | `ARENA_MATCH_BAND_PCT` also a design question, see #2 — set it against GPN's root form (#28, restored 2026-09-16); the flat `GPN_DISPLAY_SCALE` cancels in a ratio, so a percentage band means the same before and after it. `ARENA_SHOP_GEM_PRICE` has an explicit calibration target (under 1 Battle Speed block per day's Medals) |
| `EHP_DEF_CONSTANT` | `global-power-number.md` §2 | Built (#28). At 10 a level-1 Hero's DEF doubles its EHP; tune against how balanced parties should read against lopsided ones |
| `SKILL_COLLECTION_PASSIVE_FRACTION`, `ARTIFACT_COLLECTION_PASSIVE_FRACTION` | none — see #28 | What every owned Passive Skill or Artifact gives the Hero, equipped or not (#39), as a fraction of equipping it. 0.1 mirrors Gear; tune together with `GEAR_PASSIVE_COEFFICIENT` so all three collections feel comparable |
| `PRESTIGE_STAT_PER_LEVEL`, `PRESTIGE_STAT_BASE_COST`, `PRESTIGE_STAT_COST_GROWTH` | none — see #41 | The uncapped stat tracks: +1% party-wide per level, from 100 Void Shards climbing ×1.15. They decide how fast Void Shards turn into power once the capped tracks are done, so tune against `VOID_SHARD_BASE/GROWTH` and add them to the campaign walk before trusting the pacing past a first prestige |
| `RAID_ENRAGE_SECONDS`, `RAID_DUMMY_SECONDS`, `RAID_KNIGHT_PWR_MULT`, `RAID_DIG_PWR_MULT`, `RAID_DIG_ADD_SECONDS`, `RAID_FORGE_PWR_MULT`, `RAID_FORGE_BOSS_STEPS`, `RAID_FORGE_HANDOFF_SECONDS` | `raid-system.md` | Built (#46). Each raid's HP multiplier is measured against its clock, so moving `RAID_ENRAGE_SECONDS` or `RAID_DUMMY_SECONDS` means re-measuring the HP multiplier it is coupled to. The PWR multipliers sit at 1: a raid boss hits like the stage it stands for |
| `BOSS_SPECIAL_*` (11) | none — see #45 | One set of magnitudes for all twenty gate bosses' specials: cooldown, the spread, heavy and focus hits, burn, stun, silence, debuff and drain. Measured only on seeded gate fights; the campaign walk does not model them |
| `CALENDAR_SCHEDULE`, `CALENDAR_INCOME_DAYS_FIRST`, `CALENDAR_INCOME_DAYS_LAST` | none — see #47 | The schedule's Gold minutes and Gem counts are placeholders, rebalanced after the Gold decision (#23), and count as one marker; day 30's 200 Void Shards is the user's. The two dials size every Seal, Key and Trait Gem day in days of income, ¼ to 1 |
| `HOLIDAY_GIFTS`, `HOLIDAY_CLAIM_WINDOW_DAYS` | `holiday-events.md` §2–§3 | The four holidays' bundles, counted as one marker, and the claim window. Gems reach past Hero Quest: size them with the calendar's and the milestones' (#53) |
| `GPN_DISPLAY_SCALE` | `global-power-number.md` | Presentation only (#28): it changes how big GPN reads, never which party ranks above which, and cancels out of the Arena's percentage band |
| `SLOT_BASE_BONUS` ×6, `GEAR_PASSIVE_COEFFICIENT` | `gear-equipment.md` §2 | Built. The six slot coefficients are deliberately *identical* — no doc ranks the stats against each other, so six different values would encode a spread nobody decided. `GEAR_PASSIVE_COEFFICIENT` must stay well under them or manual equip stops mattering |
| `SKILL_PASSIVE_MAGNITUDE[]`, `SKILL_ECONOMY_COEFFICIENT` | `skills-gacha.md` §4 | The whole 36-skill magnitude ladder, indexed by rarity. §4 authors it as "small" → "large" and assigns no number anywhere; the *relative ordering* is design content, so retune the set rather than entries |
| `SKILL_POTENCY_PER_POINT` | none — see #18 | What one point of a Skill copy's `(star × 10 + level)` scalar adds to its effect potency. **Identity at minimum**, so §4's authored bands stay the reference and only levelling multiplies up — ×2.18 at 5★/Lv10 on the placeholder. Its own constant rather than reusing `CHAMPION_INVESTMENT_PER_POINT` (×3.95 at max) because a Champion's scalar is its *only* growth axis while a Skill already carries a rarity band |
| `GOLD_BURST_MINUTES[]`, `GOLD_BURST_COOLDOWN_SECONDS` | `gold-economy.md` §6 | Burst size in minutes of income, and the cadence it repays over. The cooldown is a **decision, not a transcription** — at the shared 6.4s skill base, a 0.5-minute burst repays ~+470% Gold, two orders past §5's ×3 stack target |
| `SKILL_COOLDOWN_RANK_STEP` | none — see #36 | How much longer each rank of the cooldown ladder waits, and so how much harder it hits. One step shared by rarity (Skills, Champion abilities) and tree depth (class skills); at 1.2 a Mythic waits ×2.49 and a master class skill ×1.73 |
| `SKILL_COOLDOWN_REFUND_FRACTION` | none — see #18 | How much shorter a "chance to refund / reset / re-trigger" Active's cooldown is rendered as. One constant for all three such Skills, so the approximation retunes in one place |
| `WEALTH_FACTOR_MIN/MAX`, `WEALTH_NEUTRAL_HOURS` | `skills-gacha.md` §4¹ | The Gambler's Strike family's bounded modulation. §4¹ suggests ×0.5–×2.0 explicitly and calls it not locked; the neutral point is where the factor passes through 1.0 |
| `ARTIFACT_EFFECT_PER_POINT`, `ARTIFACT_ECONOMY_COEFFICIENT` | `artifacts-dig-site-gacha.md` §6 | Per *point* of the investment scalar, unlike Skills' flat magnitude — §6 states the scaling for Artifacts and no doc states it for Skills. See #18's closing note |
| `SKILL_SLOT_BASE_COST`/`_GROWTH`, `ARTIFACT_SLOT_BASE_COST`/`_GROWTH` | `skills-gacha.md` §6, `artifacts-dig-site-gacha.md` §7 | Both mirror the Champion slot track exactly, so all three want deriving together — and all three compete with the two offline tracks for the same Void Shards |
| `GOLD_STEP_BASE`, `BASE_GOLD`, `GOLD_PLATFORM_DISCOUNT` | `gold-economy.md` §3, §3a | **Carry no marker but are open** — see #23.3. `GOLD_TENURE_CEILING` is generated, never tuned by hand: regenerate from `scripts/lib/economy-stages.ts` |
| `SEAL_LADDER_GROWTH[]` | `gold-economy.md` §7 | Set, but calibrated against the superseded Gold anchors — see #23.2 |
| `LOADOUT_SLOT_BASE_COST_GEMS` (4-level doubling, #40) | `loadouts.md` §3 | Built. §3 flags the first pairing of the doubling short track with Gems as a genuine unknown; at 4 levels the top step is 8× the base. Now checkable against real Gem flows: the login calendar (#47) and prestige milestones (#48) pay Gems, and Battle Speed (#44) is the only other Gem sink built so far. Traits and the Arena add more when they land |
| `ONLINE_THRESHOLD_MS`, `HQ_REFRESH_INTERVAL_MS` | `tech-architecture.md` §9 | |
| `MAX_EVASION` | `classes-and-combat.md` §7 | **Locked at 0.60** — not open, listed for completeness |
| `OVERFLOW_CONVERSION_RATE` | `classes-and-combat.md` §7 | The only crit constant still untuned. Rarely reachable: with LCK off the level curve only a deliberately built crit Hero passes 100% |
| `SEAL_GRANT_PER_BOSS` | `economy-and-currencies.md` §5 | A boss's batch, paid on the win. Doc gives only the shape and defers the values to the world/enemy pass (#6). Built and paying out |
| `CONVERGENCE_COOLDOWN_FACTOR` | `capstone-class.md` | The Ascendant's power, the one open half of #43: best-of-each stats (the user's call), four free picks, and a volley paying `6 / factor` master skills a second very likely out-class every master. Measure the Ascendant on the campaign sim before moving it. Bounded above by the boss timer (past ~3.5 it never fires in a boss fight) |
| `MILESTONE_*` (11) | `economy-and-currencies.md` §4–5 | The milestone formulas (#48): each track's reward is `BASE + STEP × (k − 1)`, with Worlds stepping per run instead, plus a collection's step size. The World and prestige Seal bases are the old World-clear and prestige batches (3, 10); the rest are guesses |
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

~~**Before merging `hero-quest` into `main`: settle the ??? capstone class (#43).**~~ **Done 2026-10-09** as the Ascendant: designed, built and its art locked (`build-log.md` #43). Its power is a standing-tuning row, and #49 makes the game play its cinematic. ~~Before the merge, also decide #48.2 (milestone claims for history).~~ Decided 2026-10-09: no migration.

**Reordered 2026-10-02, the user's call: the playtest and the Gold balance (step 2) move to the very end, with step 7.** The battle stage comes first (`build-log.md` #34): the idle stage and the boss replay on the stage both landed that day. The argument below for playing early was weighed and set aside; it is kept as the record of what the reorder gives up.

1. ~~**Phase 3 — the remaining three gachas**~~ **Done — `build-log.md` #18.**
2. **Close out the tuning pass** — *deferred to the end with step 7 (2026-10-02).* Small, and it was meant to come before anything is built on top of the loop:
   - **Play a session against the tuned loop** and log it in `playtest-notes.md`. The predictions table there is refreshed; session 1 is the only one on record.
   - **Decide the Gold consequences (#23)** — first-week income, the lost calendar anchors, and whether the Seal ladder is re-derived now or after world design. **Measured and half-applied 2026-09-16** (`--report=gold`): the ceiling is regenerated against the measured kill rate, which raises the cap 12× but leaves the walk's income untouched, since it is progression-bound throughout. What remains open is the progression half — `BASE_GOLD` and `GOLD_STEP_BASE` — and #23.2, which is downstream of it.
   - ~~**Confirm the solo shape (#22.1)**~~ **Decided 2026-10-09:** no prestige without a party is intended.
   - ~~**Check the cleared-run manual re-engage** flagged in #25.~~ Fixed.
3. ~~**World & Enemy Design (#6)**~~ **Closed 2026-10-04** — the art is restyled and locked (`art-style.md`); regular enemies get no abilities. ~~**Boss specials become real (#45)**~~ **built 2026-10-08**, measured on seeded gate fights; the open half is under #45 above.
4. **The last quick call (#2)**, the Arena band — answer it with the Arena. #1 and #3 are decided, and with #3 the raid-rule questions #31 and #32 (2026-10-04); the asset calls (#4, #30) on 2026-09-17.
5. **Phase 4 — endgame systems** (`implementation-plan.md`). Traits and Arena remain. ~~GPN~~ built (#28); the leaderboard aggregate and Defense GPN remain, with Arena. ~~Battle Speed~~ built (#44). ~~Raids~~ built, all five (#46). ~~Holidays~~ built, the gifts (#53). ~~`loadouts.md` §4's per-raid auto-apply~~ built (#54); the Arena's half comes with the Arena.
6. **Passive Skill Tree (#7)** — the last unbuilt major system; good candidate for its own dedicated session.
7. **Playtest, then tune the rest.** The combat and progression block is tuned (#22); the gacha, shop, economy and ability-magnitude constants are settled here — see the standing-tuning section. The balance script and campaign sim stay in use throughout. **Once the Gold balance is decided, rebalance the login calendar's Gold and Gem days** (#47).

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

