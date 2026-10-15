# What still needs attention

**Only open items live here.** Refreshed 2026-09-17, against the code on the `hero-quest` branch.
Everything that landed moved to `build-log.md` on that date — this doc had reached 604 lines of
which the large majority was a record of finished work, and it is on the always-read list, which
made it the most expensive bloat in the project.

**Item numbers are the originals and are never reused.** Eleven docs, `constants.ts` and two
scripts cite them (`#22`, `#23.3`, `#18.6`). The gaps below — #4, #5, #8, #10–#21, #24, #26–#28 —
are finished items, not missing ones; they are in `build-log.md` under the same number. #22, #23,
#25 and #29 appear in both: the open part here (now closed stubs), the full record there. New items continue from
**#63** — #62 (Arena bots) landed 2026-10-11, with its open half under #58; #61 (party stats, GPN arrows, Gear upgrade arrows) landed 2026-10-11; #60 (Arena crits capped, fights paced) and #59 (an Arena milestone, and no claim-all) landed 2026-10-10 and are in `build-log.md`; #58 (the Arena) landed 2026-10-09 and was reworked 2026-10-10, with its open half below; #57 (the Milestones into the Calendar) landed 2026-10-10 and is in `build-log.md`; #56 (Battle Speed into the Shop, the `shop` rename) landed 2026-10-10 and is in `build-log.md`; #55 (the Shop and the Gold offline tracks) was decided and built 2026-10-10, and is in `build-log.md`; #30 was raised and decided on 2026-09-17, and is in `build-log.md`; #31 opened 2026-09-28, #32 on 2026-09-29; #33, #34 and #35 were decided on 2026-10-02 and are in `build-log.md`; #36 landed 2026-10-03 with its pacing half open; #37 landed the same day; #38 to #42 landed 2026-10-04; #43 opened the same day, #44 landed and #45 opened with it, and #6, #3, #31 and #32 were decided (all in `build-log.md`); #46 (raids) landed 2026-10-05; #45 (boss specials) landed 2026-10-08 with its open half below, and #47 (the login calendar) the same day; #48 (milestones) landed 2026-10-09, and #43 (the Ascendant) was decided, built and its art locked the same day, closing it; #49 opened with it, and #50 (the tutorials, backlog item 10) was picked up, built and its guide's art locked the same day, closing it; #51 (bosses without an escort) landed with it; #52 (Traits), #53 (holiday gifts) and #54 (per-raid Loadout auto-apply) were built the same day, each with an open half below.

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
| 23 | `gold-economy.md` §9's prestige→calendar anchors; ~235M/hr at month 3, ~0.71B/hr at month 6 | Gold is paced on **wall-clock account age**. The anchors are **~28M/hr at month 3 and ~52M/hr at month 6**, what the tenure ceiling pays an account keeping pace (2026-10-12, the user's call via issue #10). `gold-economy.md` §3a now says so. `build-log.md` #23 |
| 25 | `core-progression-and-prestige.md` §2 and `idle-mechanics.md` §5: a failed boss is re-engaged **manually** | Bosses engage **automatically** while `document.visibilityState` is `visible`. A hidden tab, a closed app and an offline settle never engage one, so Void Shards still cannot come from idle time. The 400 on an early client engage is routine — **do not soften it server-side** |
| 64 | `tech-architecture.md` §4a step 5 (as first written): every settle credits its Gold to the shared balance | **Settles bank Gold in a chest** (`hq_state.pending_gold`), paid into the balance as one transaction when the player presses it in the battle view's corner (2026-10-12, the user's call after the first live deploy flooded `transactions`). §4a updated in place. `build-log.md` #64 |
| 29 | `economy-and-currencies.md` §5 source 2: a time-gated free Seal grant | **Removed.** Free Seals come only from milestones and (later) raid clears; the free 10-pull entitlement is the only thing a clock hands out |
| 47 | #29 above: the free 10-pull is the only thing a clock hands out; `economy-and-currencies.md` §5: Seals come in milestone and raid chunks, never a drip | **The login calendar is a second clock.** It pays Seals on some of its thirty days, alongside Gold, Gems, Raid Keys, Trait Gems and, on day 30, Void Shards, each day claimed in person (2026-10-08, the user's call: any currency the game grants may be on it). Built outside the phase plan, from backlog item 12. `build-log.md` #47 |
| 48 | `economy-and-currencies.md` §5 source 1: milestones are core-progression feats, never a gacha's own progress, so each grants all four Seal types; the World-clear and prestige batches pay on the event | **Milestones are claimable tracks** (`milestones.ts`): a formula per kind of feat, not a list. Worlds and prestiges still pay all four Seal types, now claimed in the Milestones scene rather than paid on the super-boss win and the prestige, and a prestige adds Gems. Two kinds are a gacha's own progress after all: a **collection** pays its gacha's Seals and a **raid** its Keys (2026-10-09, the user's calls). A boss's Seals still pay on the win. Built outside the phase plan, from backlog item 11. `build-log.md` #48 |
| 43 | `classes-and-combat.md` §1, §5 and throughout: a 16-node tree, one parent per node, a kit that accumulates down one path. `loadouts.md` §1–2: five components, and the Hero's class "correctly excluded" | **A 17th class, the Ascendant**, past the tree and joined to all six masters, with no single parent. It opens once a prestige has been completed as each master, takes a token, and **picks any 4 class skills** across paths plus **Convergence**, every master's skill at once; its stats are the best master's in each. Its picks are **a sixth Loadout component** (the class itself still isn't one). The user's calls, 2026-10-09. `capstone-class.md`, `build-log.md` #43 |
| 31 | `raid-system.md` §1/§7, `asset-list.md`, `economy-and-currencies.md` §9: the Training Grounds Raid is a `solo_boss` fight, its Keys spent only on a win | It is a **`training_dummy`**: a static dummy that can't die or attack, the result being the damage dealt before the timer ends (2026-09-28, the user's call). Keys, the ladder and rewards follow Rampaging Boss's rules, the level reached on live damage thresholds; it has no DEF (decided 2026-10-04, `build-log.md` #31) |
| 32 | `raid-system.md` §1/§7, `asset-list.md`, `asset-checklist.md`: the Forge Raid is one `phased_boss` whose phases change at HP thresholds | It is a **`boss_gauntlet`**: three bosses back to back, the Apprentice, the Journeyman and the Forgemaster (2026-09-29, the user's call). One 30 s clock for the run, 10 s back per boss killed; all three or nothing; each boss steps up (decided 2026-10-04, `build-log.md` #32) |
| 36 | `classes-and-combat.md` §3: SPD reduces cooldown duration across the board, off the same curve as the autoattack; every skill on `SKILL_BASE_COOLDOWN_SECONDS` | Cooldowns read **`cooldownSpd`**, SPD without the level curve; the autoattack still reads the full stat. Cooldowns sit on a **rank ladder** (`SKILL_COOLDOWN_RANK_STEP`): rarity for Skills and Champion abilities, tree depth for class skills, hit size scaled to match. §3 updated in place (2026-10-03, the user's call) |
| 37 | `core-progression-and-prestige.md`, `settle.killsBeforeWipe`'s old contract: a wave wipe restarts the stage at once and income continues unbroken | Each wave wipe costs **`WIPE_RECOVERY_SECONDS` (3s since 2026-10-11, 5s before)** with nothing landing, served across settle windows via `hq_state.recovery_seconds`. Still no ground lost (2026-10-03, the user's call) |
| 38 | `CLAUDE.md` §3 and #25: every boss engages automatically while the tab is visible, never from a button | **A boss that just beat the party** (a timeout or a wipe) does not re-engage on reaching its gate again. The stage shows a red skull challenge button in place of the stage progress, and the player fights it from there. Saved as `hq_state.boss_lost` (migration `0050`), set by the fight that loses and cleared by the one that wins, so it holds across reloads and coming back later; run position, so a prestige clears it. Presence still gates every fight (2026-10-04, the user's call) |
| 40 | `loadouts.md` §3: Loadout slots run 2 → 10, eight Gem-priced purchase levels | **2 → 6**, four levels on the same doubling (`MAX_LOADOUT_SLOTS`). Saved rows past slot 6 are never served. The Loadouts scene shows the six as two rows of three cards (2026-10-04, the user's call) |
| 41 | `build-log.md` #11.4: the prestige-shop stat multiplier is cut, struck from the sink lists in `core-progression-and-prestige.md` §4, `economy-and-currencies.md` §4, `tech-architecture.md` §3 and `global-power-number.md` §3 | **Back, as four uncapped tracks: PWR, DEF, IMP and VIT**, party-wide (summed with equipped Artifacts' lines). Each level adds `PRESTIGE_STAT_PER_LEVEL` of the stat; the price climbs on `PRESTIGE_STAT_COST_GROWTH` from `PRESTIGE_STAT_BASE_COST` Void Shards, forever. SPD and LCK are left out because they run into ceilings (the attack-interval floor, the crit clamp). Page 2 of the shop scene. The campaign sim buys none, so pacing does not account for them (2026-10-04, the user's call) |
| 42 | `core-progression-and-prestige.md` and `pickableClasses`: a class pick is legal "at a prestige" (anything seen, or one tier deeper) — and in practice at any time, since nothing gated it | **A class token**: every prestige grants one (`hq_state.class_token`, migration `0051`; a flag, so a second prestige while holding one changes nothing), and taking a class **never reached before** — one tier deeper than the current — spends it. Switching back to any class already reached is free at any time. A new account starts without one, so everyone plays the Beginner until their first prestige. The class tree is its own scene and menu item; prestiging happens only through Begin Again on the bridge, which now raises the Void Shards it paid over the Hero (2026-10-04, the user's call) |
| 44 | `idle-mechanics.md` §3: Battle Speed tiers 2x/3x/5x/10x, anchored at 50 Gems for 2x/30 min | **2x/3x/5x**, anchored at **250 Gems** (the old 10x price), both axes' rules unchanged. 10x was cut because at 10x the largest offline collect cleared the balance column by 1.87 orders of magnitude against the specs' 2. A second purchase of the running speed extends the block from its end; another speed is refused until it ends. §3 updated in place (2026-10-04, the user's calls) |
| 44 | `gold-economy.md` §7: Seal-ladder growth 1.0007 (Guild, Dig Site) and 1.0011 (Forge, Training), sized so Gold completes a roster in ~6 months | **1.2 for all four**, set by feel: a day's first 10-pull is ~21M, the fifth ~14.7B, so Gold buys a few extra 10-pulls a day rather than completing a roster. There is no Seal button: a pull short of Seals buys them itself, at the price its button shows. §7 carries a dated note (2026-10-04, the user's call). **Re-derived against the settled income 2026-10-12 and kept**, with the 1,000,000 base (#23.2, `build-log.md` #23) |
| 55 | `idle-mechanics.md` §4: Offline Efficiency and Offline Cap are prestige-shop lines (Void Shards), costing `BASE × 2^(level−1)` and `BASE × 1.72^(level−1)` | **Bought with Gold**, in the Shop: Offline Efficiency 1M ×10 a level (10B for the fifth), Offline Cap 100K ×1.5 a level (28,762,658,885 for the 32nd). The Shop (the renamed Prestige scene) opens on the World 1 boss's first win (2026-10-10, the user's calls). `build-log.md` #55 |
| 54 | `idle-mechanics.md` §2: the core loop is always-auto the instant the app is open, and the run advances continuously; §3: a Battle Speed block is pure wall-clock and runs down whether the app is open or not | **The run holds while the player is in a raid, and a running Battle Speed block waits with it.** Every fresh raid engage opens a session (`hq_state.pre_raid_snapshot`), with a preferred Loadout or without, and a settle while one is open pays nothing and only moves the clock; leaving drops the time spent there. A gap past `ONLINE_THRESHOLD_MS` closes it as time away, settled on the player's own loadout. The screen's projection, the boss auto-engage and the block's countdown hold with it; the block's expiry moves out by the held span (2026-10-10, the user's call). `build-log.md` #54 |
| 62 | `arena.md` §2a: a slot no real player in band can fill gets a Training Dummy | **Arena bots fill it first**, the dummy only after them. Bots are content (`content/arena-bots.ts`), not accounts, so they never reach a leaderboard or a season's standings; each sits at a fixed Rating of 1000 or below, and a fight against one is a real match on the attacker's side: Rating against the bot's, Medals by upset odds, a log row naming it (2026-10-11, the user's calls). `build-log.md` #62 |
| 58 | `arena.md` §7: season rewards "handed out based on final rank at the moment of reset"; §2: a GPN band, a paid refresh, a defence copied from a Loadout | The standings are frozen at the reset (lazily, by the first request after it) and **paid when the player claims them**; nothing runs at the instant a season ends. **The band is on Rating** (±`ARENA_MATCH_BAND_RATING`), not GPN; **two refreshes a day are free**, then 5 Gems doubling, and the list is also redrawn free after every attack; **the defence is set only from the current loadout**. A timeout goes against the side with less of its max HP left (2026-10-10, the user's calls). `build-log.md` #58 |
| 39 | `gear-equipment.md` §3 ("every *other* owned piece … contributes a smaller passive bonus **instead**"), `build-log.md` #28's collection passives ("an equipped copy is never counted twice") | The collection passive is **additive with equipping** for Gear, Skills and Artifacts, as it already was for Champions: every owned copy pays its owned share, and an equipped one adds its full bonus on top. `gearModifiers`, `skillCollectionModifiers` and `artifactCollectionModifiers` changed; an equipped item is worth ~10% more than before (the share is 0.1 of the full line in all three). The campaign walk is unchanged — it models no collection. The Collections detail shows the two blocks, "In collection" always active once owned (2026-10-04, the user's call) |

---

## 🔷 Open questions — need your input

### ~~2. Arena matchmaking band width~~

**Decided 2026-10-11, the user's call: ±100 Rating**, locked (`ARENA_MATCH_BAND_RATING`). A slot the band
can't fill still gets a Training Dummy. Record under #58.

---

## 🔴 Genuinely undesigned — full passes, not edits

### ~~7. Passive Skill Tree (backlog item 3)~~
**Designed and built 2026-10-11** (`passive-skill-tree.md`, `build-log.md` #63). Nothing in this section is open now.

---

## ⚠️ Open consequences of work that landed

Twelve items are built and working but left something undecided. The full record of each is in
`build-log.md`; only the open half is restated here. (The `killFraction` invariant that used to
sit here as #24 is not an open item — it is a trap, and it lives in `CLAUDE.md` §7 and
`build-log.md` #24.)

### ~~22. The combat and progression tuning pass — three open consequences~~ — closed 2026-10-11

Full record: `build-log.md` #22. 42 constants moved to `// TUNED ✓` and the level curve was
re-derived as a pacing model. What it left open:

1. ~~**A solo account never completes a prestige** without pulling.~~ **Decided 2026-10-09: intended**
   (the user's call). The boss gate is the wall and Champions are the answer to it, so no prestige
   without a party is the design, not a side effect. Record in `build-log.md` #22.
2. ~~**The Gold curve was calibrated against the old loop speed**~~ — carried by #23.
3. ~~**`STAT_PACES_ENEMY_CURVE` is inert while `XP_PACE_SLACK` is 1.0**~~, because both stat curves
   are then numerically identical. Keep it: it starts mattering the moment slack moves.

⚠ The `TUNED ✓` legend says "confirmed in playtest", but `playtest-notes.md` records only
session 1. The block was tuned on the campaign sim, not felt. Closed 2026-10-11 (the user's call): that
warning is the playtest's to answer (*Watch during playtest*, GitHub issue #18).

### ~~58. The Arena — built; what it left open~~ — closed 2026-10-11

Full record: `build-log.md` #58. Reworked on review 2026-10-10: the band on Rating, two free refreshes a
day, the defence set only from the current loadout, the preferred attack Loadout wired as a raid's,
and a timeout decided by HP share. What is still open:

1. ~~**Fights shortened with depth**~~ — addressed by #60, and the clocks are locked (below).
2. ~~**The band (#2), the Elo K pair, the Medal amounts, the season rewards, every shop price and the
   fight clocks, and the Arena milestone track (`MILESTONE_ARENA_*`)**~~ — **locked 2026-10-11, the user's call**: the band narrowed from ±200 to **±100
   Rating**, everything else kept as built. The Ranking tab got a REWARDS button that shows what a
   season pays per rank band, so the reward table can be reviewed in the game.
3. ~~**The platform leaderboard shows GPN but does not rank on it**~~ — **ranked 2026-10-11** (the user's
   call, GitHub issue #23): Hero Quest adds **Worlds cleared, every run counted, plus collection entries
   owned** to the platform's upgrade count (`heroQuestScore`, `scoreboard.ts`). Stages and collection levels
   were weighed and left out, since both run into the hundreds and would decide the board. GPN stays shown,
   unranked. **Reweighed 2026-10-15** (the user's call, GitHub issue #35): the collection counts as its
   completion percentage, `round(owned / 168 × 100)`, so an entry is worth about 0.6 of a point and the
   leaderboard breakdown shows the percentage.
4. ~~**The bots' loadouts are guesses (#62).**~~ — `ARENA_BOT_LOADOUT` **locked 2026-10-11**, the user's call.

### ~~45. Boss specials are real — built; what the sims don't see~~ — closed 2026-10-11

Full record: `build-log.md` #45. Every gate boss swings its special in place of an attack, on a
fixed cooldown, with damage and a status or a drain. What it left open:

**Closed 2026-10-11, the user's calls.** Measured on seeded gate fights (party of 3, Beginner plus
stand-ins, 16 seeds, the first level winning half): as swings of the boss's PWR against DEF a special
landed ~1 damage at a gate's level, so no multiplier, even 20×, wiped a party or moved a gate.

1. **A special's hit now takes a share of the target's max HP, past its DEF**: spread **15%**, heavy
   **25%**, focus **45%**, split over its hits (`BOSS_SPECIAL_*_HP_SHARE`, replacing the three
   `_MULTIPLIER`s). Measured: two super bosses become real fights, W3S10 +7 levels and W9S10 +8, about a
   third to half of fights at the gate's level wiping; every other gate within ±3 of the expected-value
   walk, as before. Chosen over 20/35/60%, which moved nine gates +8 to +23, World 1's first boss among
   them. The campaign walk and idle projection still don't model specials; the two gates are the
   whole of the difference.
2. **The other eight magnitudes are locked as built** (cooldown 8 s, stun 1 s, silence 3 s, burn 15% of
   the hit over 4 s, debuffs 20% for 6 s, drain 50%).
3. **No Artifact carries Unshaken — dropped**: the Skills that grant control resist are enough.

### ~~52. Traits — built; Deep Impact breaks the pacing, and two slips in `traits.md`~~ — closed 2026-10-11

Full record: `build-log.md` #52. Five slots, Rolls, locks, Sets, save slots, and evasion live in
combat and GPN. What it left open:

1. ~~**⚠ Deep Impact collapses the mid-game.**~~ **Cut to a quarter 2026-10-11, the user's call:**
   +400/800/1200% → **+100/200/300%** IMP, so one piece now sits below an S IMP roll. Re-measured on the
   campaign walk (party of 3, Worlds 5–10 of the first run): none 9d 11h (unchanged), `--traits=E`
   1d 0h → **3d 11h**, `--traits=A` 10h 14m → **1d 12h**. A full board still speeds the mid-game up, as
   Traits are meant to; no single piece collapses it any more. `traits.md` §5 records the cut.
2. ~~**Two contradictions inside `traits.md`**~~ — **fixed 2026-10-11**: the Implementation Note now
   says Champion ATK reaches every Champion, Tank included, and §5 says `MAX_EVASION` sits ten points
   *above* a 5-piece Vital Reflex board.
3. ~~A Roll or a load does not settle first~~ — fixed 2026-10-10 (the user's call): every route
   that moves the idle rate settles first (`trait/roll`, `trait/load`, `loadout/set`,
   `loadout/apply`, `prestige/pick-class`, `shop/buy`), so a window is always paid at the
   rate it ran at.

### ~~47. The login calendar — built; its Gold and Gem days are placeholders~~ — closed 2026-10-11

Full record: `build-log.md` #47. Thirty fixed days per account cycle, three make-ups. What it left
open:

1. ~~**`CALENDAR_REWARDS` is one `UNTUNED ╧` table.**~~ **Sized 2026-10-09 (the user's call):** a
   Seal, Key or Trait Gem day pays days of that currency's regular income, a day of raid clears at
   raid level 1 (free pulls not counted), climbing evenly from `CALENDAR_INCOME_DAYS_FIRST` (¼) on day 1 to
   `CALENDAR_INCOME_DAYS_LAST` (1) on day 30. Both dials are `UNTUNED ╧`. A cycle now pays
   1–1.5 days of each gacha's raid Seals (7–13 Seals, from 4–6), 2.4 days of Trait Gems (73, from
   50) and the same Keys as before. Day 30's 200 Void Shards is the user's number. The Gold minutes
   and Gem counts in `CALENDAR_SCHEDULE` are still guesses, below.
2. ~~**Rebalance its Gold and Gems after the Gold balance step**~~ — **locked as built 2026-10-11** (the
   user's call): the schedule, its Gold minutes and Gem days, and both income dials. Only a Gold decision
   that changes what a minute of income is worth would reopen it. (step 7 of the *Suggested order*,
   #23; the user's call, 2026-10-08). A Gold day is minutes of current income (`gold-economy.md`
   §6), so it is exactly as right as the unreconciled Gold curve, and the Gem days (25, 50, 75 a
   cycle, platform-wide) are sized against nothing yet.
   **Checked against the 2026-10-12 Gold decision (#23) and not reopened:** a minute is worth far more
   in week one now, but the days are sized in minutes so they scale, and the eight Gold days pay a party
   of three ~8.7M over its first cycle (~0.9% of the cycle's income, ~2K on day 1 to ~3.9M on day 26).
   The Gem days are still sized against nothing; Gems were out of that decision's scope. Recorded in
   `build-log.md` #23.
3. ~~**No Battle Speed days.**~~ **Decided 2026-10-09: left out** (the user's call). A free block
   can't start while a bought block of another speed runs (`idle-mechanics.md` §3), and neither a
   refused claim nor a queue was worth it.

### ~~49. Convergence plays as one cinematic in the game~~ — closed 2026-10-11

**Kept as it plays, the user's call (2026-10-11):** in the game Convergence's volley shows as the masters'
own skill effects, and that stays. The gallery's single Convergence cinematic is not wired into the
game stage, on purpose.

### ~~48. Milestones — built; every number is a placeholder~~ — closed 2026-10-11

Full record: `build-log.md` #48. Eleven tracks, each a formula rather than a list. What it left
open:

1. ~~**Eleven of the twelve `MILESTONE_*` constants are `UNTUNED ╧`.**~~ **Locked as built 2026-10-11**
   (the user's call), the prestige Gems included: each prestige takes longer than the last, so +25 a
   prestige is a minor increase overall. The twelfth,
   `MILESTONE_RAID_LEVEL_EVERY` (5), comes from backlog item 11. The World and prestige Seal bases carry over the old batch sizes (3 and 10);
   every growth step, the collection step and the Key and Gem amounts are guesses. Prestige Gems
   (50, then 25 more a prestige) are platform-wide, so they reach past Hero Quest. Size them with
   the calendar's Gem days in step 7 of the *Suggested order*.
2. ~~**Accounts with history claim it again.**~~ **Decided 2026-10-09: accepted, no migration**
   (the user's call). Hero Quest has never reached `main`, so production starts with no `hq_state`
   rows and no history to re-claim. Record in `build-log.md` #48.
3. ~~**The campaign sim doesn't see milestones.**~~ Closed with the rest; kept as a note for #23.2. Seal income isn't part of the walk, so this changes
   nothing it measures. Pull-pacing questions (#23.2, the Seal ladder) now have this source to
   account for.

### ~~53. Holiday gifts — built; the bundles are placeholders~~ — closed 2026-10-11

Full record: `build-log.md` #53. Six holidays (Valentine's Day and Easter added 2026-10-10), a claim
each per year, in a three-day UTC window, from a gift icon on the battle view.
What it left open:

1. ~~**`HOLIDAY_GIFTS` and `HOLIDAY_CLAIM_WINDOW_DAYS` are placeholders**~~ — **locked as built 2026-10-11**,
   the user's call: the six bundles as they stand and the three-day window.
2. ~~**Lunar New Year's table ends at 2050**~~ — closed 2026-10-11, the user's call: the spec that fails
   twenty years before it runs out is the reminder.
3. ~~`holiday-events.md` §2 models the claim on the retired `seals/claim-daily.post.ts`~~ — fixed
   2026-10-10: §2 and `tech-architecture.md` §5 now name the login calendar's route.

### ~~54. Per-raid Loadout auto-apply — built; the Arena's half waits~~ — closed 2026-10-11

Full record: `build-log.md` #54. Each raid points at a saved slot from a list on its own screen;
a fresh engage snapshots and applies, leaving reverts, and the run (Battle Speed with it) holds
while a session is open. Items 1–4 were settled on 2026-10-10 (the user's call) and are recorded
there: the run's boss closing the session kept as the fallback, the cycling picker replaced by a
list, a preset that can't be applied still refusing the engage, and the hold's two consequences
fixed (Battle Speed waits with the run; the dev time skip leaves the raid first). What is left:

5. ~~**The Arena's pointer is stored but unread.**~~ — done with the Arena's rework (#58): an attack fields
   its preferred Loadout through `engageLoadout(tx, userId, 'arena')` (`hero-quest-arena.ts`).
6. ~~**`tech-architecture.md` §3 said a 5-entry map**~~, one per raid; #1 (the user's call,
   2026-10-04) and `loadouts.md` §4 add the Arena. Built per #1, and §3 now says so. The leave
   route, `raid/leave.post.ts`, is new to §5.

### 36. Cooldowns off the level curve — decided; the first prestige goes back to about a week, later

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

**Re-measured and decided 2026-10-11 (the user's calls).** A party of three's first run now takes
**13d 6h** without Traits (3d 14h with an E board fielded from the start, which Traits never are). The
cooldown decisions are **locked**: the ladder, its step, and the boss-fight tail below. What stays open is
the pacing alone: **bring the first prestige back to about a week**, a later pass (GitHub issue #12). Two
requirements for it (the user's calls, 2026-10-11):

- **Every source of stats goes into the walk/sim first.** It fields only the Hero, Common un-invested
  stand-ins and optionally a Trait board; Gear, Skills, Artifacts, the collection passives, real Champion
  rarities and investment, the Shop's stat tracks, the Passive Skill Tree, the Ascendant and boss specials
  are to be modelled before the pace is measured.
- **Tune across all the constants, not one dial.** `BASE_ENEMY_HP` is the only one measured so far and is
  not to be the fix on its own; the whole set moves together, each move re-measured on the walk.

**Balanced around a baseline Trait board, 2026-10-12 (the user's call).** Traits and the tree are
required: everyone fields every source of damage by design, so there is no "no-Trait player" to pace
for. The baseline is ATK and IMP at D with two pieces of Deep Impact
(`--traits=atk:D:deep_impact,imp:D:deep_impact,champion_atk:D:aggression,atk:D:aggression,imp:D:aggression`)
and the Passive Skill Tree spent cheapest-first (`--tree=cheapest`, new). On the old constants that
party prestiged in **8 hours**: the board lifts IMP about ×4, and crit damage linear in IMP turned that
into a lead that grew with level. Moved: `CRIT_DAMAGE_PER_POINT` 0.02 → 0.005 and
`OVERFLOW_CONVERSION_RATE` 0.01 → 0.0025, to stay at half of crit damage.

**Every source in the walk, a baseline kit, and five days (the user's calls, 2026-10-12).** The walk
now fields Gear, Skills, Artifacts and real Champions (`--kit`), and fights boss gates as seeded live
fights with their specials (`--boss-fights`). Class switches, the Ascendant and the Shop's stat tracks
cannot touch a first run: the first class token is the Void's, and Void Shards come only at a
prestige. The baseline kit is **Rare 0★ Lv2** (`--kit=rare:0:2`), the median equipped copy at the
run's midpoint, from 400 simulated first runs per gacha through the real drop table and dupe curve
(free pulls daily, boss-win and World-milestone Seals, no Gold Seals): Rare 0★ Lv1 by day 1, Epic
0★ Lv1 by day 7, investment never past Lv3. The target is **5.5 days**: five so players who start on
a Monday prestige on the Friday, plus half a day because players will likely field better loadouts than
the walk does, a hunch the playtest is to check. `XP_TO_LEVEL_BASE` 10 → 46 measures **5.46 days**
(42 measured 4.98), World 1 in minutes and Worlds 9 and 10 about 40 hours each. World 9 now costs as much as World 10: Vigil of the
Forgotten's weaken and drain stretch it past the timer (#45). The walk assumes a boss is fought the
moment it is reachable, and in play a boss needs the player present (#25), so real runs land later.

**The unlock schedule, a 20-minute World 1 and four days (the user's calls, 2026-10-12, after the
first live deploy).** New players found World 1 slow. The baseline fielded the Trait board and the tree
from the first stage, but the tree opens at 3 Worlds cleared and Traits at 4 (`FEATURE_UNLOCKS`), so the
early Worlds were paced for a party no new player has. The walk now opens both on that schedule
(`--unlocks`); on it the old constants measured a **6.4-day** first prestige, and a new party of three
on Common 0★ Lv1 kit took **45 minutes** for World 1, walled by its boss timer. Targets: World 1 in
about 20 minutes for that party, and the first prestige at **about 4 days** on the baseline. Two dials,
swept together: `XP_TO_LEVEL_BASE` 46 → **38** (a level offset at every stage) and `BASE_ENEMY_HP`
60 → **50** (every fight shorter). Measured **20 minutes** and **4.04 days**. Alone, HP 45 measured
15 min / 4.21 d and XP 30 measured 28 min / 4.12 d. A solo Hero who never pulls still takes ~2 hours
for World 1 (7 walls); the Gacha opens on the first fall, at Stage 4, so that player is the exception.
The Gold slope was re-measured with it (#23.3): `GOLD_STEP_BASE` 1.065 → **1.0575**.

**XP ×2 and an earlier unlock schedule (the user's calls, 2026-10-13: progression felt too slow).**
`XP_BASE_PER_KILL` 1 → **2**. XP is a pure clock on this model: every World is cleared at the same
level, and since nearly all of a run is grinding levels at boss gates, every grind halves (×1.5
measured 2.6 days, ×3 1.2 days). The schedule moved with it: the Shop, Battle Speed and the Calendar
from the start (a new `start` checkpoint), Loadouts at 1 World cleared, the tree at 2, the raids and
Traits at 3 (Traits never ahead of the raids, which pay Trait Gems), the Arena at 4. Measured **1.76
days** to the first prestige on the baseline (was 4.03) and **10 minutes** for a new party's World 1
(was 20). Raid ladders are measured against the level each World is cleared at, which didn't move.

**Gold on the new pace (the user's call, the same day).** Accounts stand on deep stages at half the
age, so at 1.0575 the age ceiling bound from about hour 7 and the first month paid **45–99% of
platform** (2.52B over the walk's 34 days against 1.38B). `GOLD_STEP_BASE` 1.0575 → **1.05**:
progression-bound until about day 90, 1.29B, ~50–77% of platform on day one and ~25–33% from day 3
(`gold-economy.md` §3).

1. ~~**Long cooldowns lose their tail inside `BOSS_TIMER_SECONDS`.**~~ Accepted, locked with the ladder. The first cast waits a full
   cooldown, so a Mythic ability (~15.9s at step 1.2) fires once in a 30s boss fight. Damage per
   second is equal on average only; in boss fights the ladder is a slight nerf to rare kits.
2. ~~**The step itself is a placeholder**~~ — `SKILL_COOLDOWN_RANK_STEP` **locked at 1.2**, shared by both ladders.

### ~~37. A wave wipe costs recovery time — built; its feel is unmeasured~~ — closed 2026-10-11

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

~~**Open:** whether 5s reads as a penalty or just as a pause.~~ **Shortened to 3 s 2026-10-11** (the
user's call), and closed.

### ~~23. Gold — the progression half~~ — closed 2026-10-12, the user's call via GitHub issue #10

Full record, measurements and knock-ons: `build-log.md` #23. The sub-numbers keep their meaning:

1. ~~**#23.1 The locked calendar anchors are gone.**~~ **Decided:** the anchors are what the regenerated
   ceiling pays an account keeping pace — **~28.2M Gold/hour at month 3, ~51.9M/hour at month 6** — and
   replace ~235M/hour and ~0.71B/hour. Colony and Xeno had not moved; Hero Quest's own kill rate had
   (600 → **420**/hour, re-measured), which is what the regeneration corrects.
2. ~~**#23.2 The Seal ladder's calibration is stale.**~~ **Decided:** 1,000,000 and ×1.2 hold, now
   `TUNED ✓` — the first Gold Seal on day 2 for a party of three, and at keeping-pace income Gold reaches
   a gacha's 30 free pulls a day around month 3 and at most doubles them after.
3. ~~**#23.3 First-week income.**~~ **Decided: about a quarter of platform income in the first week,
   under the ceiling.** `BASE_GOLD` 0.4 → **1**, `GOLD_STEP_BASE` 1.017 → **1.075**, then **1.065** on the new run pace, then **1.0575** on the 4-day pace (#36, `build-log.md` #23): the party-of-three
   walk earns ~24% of the platform across its first week (25.5K/hr at day 1, 216K/hr at day 7), up from
   0.07%; solo ~7%. ⚠ **This was left for the playtest on 2026-10-11 and is now set from the sim, to be
   confirmed by the playtest** (🔬 *Does Gold feel like anything in week one?*, below). It is coupled to
   run pacing: re-measure when #36's first prestige comes back to about a week.

**What it left standing**, recorded rather than open: the abuse bound is now **~17× platform** (12× at
the old 600-kill rate), and §9.4's column margin is ~2.7 orders against the three it asks for (the spec
asserts two, unchanged). `GOLD_PLATFORM_DISCOUNT`'s "~89% ceiling-bound" is retired: ~90% for a party of
six, 0% inside a stand-in party of three's first month.

### ~~29. Free Seals — the un-re-derived half~~ — closed 2026-10-11, folded into the standing tuning

Full record: `build-log.md` #29. A gacha gets 30 free pulls a day and no free Seals, ×4 systems.
The 30/day ceiling for a player who never buys Seals is **intended and accepted**. What has not
been re-derived against the new shape: the collection curve, Essence income and the crafting
economy — a tuning question, listed below rather than a blocker. **Closed as its own item 2026-10-11** (the
user's call): those constants are re-derived with the rest of the standing tuning (GitHub issue #17).

---

## ⚪ Standing numeric tuning — **what is still `// UNTUNED ╧`**

Named constants with a formula shape locked and a placeholder value. Consolidated so a tuning pass has one list. `rg '╧' shared/utils/hero-quest/constants.ts` is the authority — **52 markers** as of 2026-10-12 (`rg -c` prints 54: the file's header legend carries the glyph twice), matching `CLAUDE.md` §4. This line read 120 until 2026-10-12: that was the count before the 2026-10-11 locks and was never brought down; the Gold decision (#23) moved none, since the Gold and ladder constants carried no marker. Every marker has a row below; the Arena row's constants are not in `constants.ts` until the Arena is built.

~~**Decided: none of this is tuned before playtesting.**~~ **Superseded for the combat and progression block by #22**, which tuned it on the campaign walk. The original reasoning still holds for everything that remains below: the balance script and campaign sim project *what the formulas say*, and a projected value that feels wrong in play is worth less than no value, because it looks settled. What remains is mostly the gacha, shop and ability-magnitude layers, which the campaign walk barely exercises — so they want play data or a different measurement, not another sim pass.

**Do not treat any of these as blocking a phase.**

**The combat block is reopened for one goal (2026-10-11, the user's call, GitHub issue #17): enemies have to
actually do damage to the party.** At a gate's level a hit lands ~1 damage against 20k–570k party HP:
mitigation is `DEF / (enemy PWR × K)`, and party DEF passes `K` × enemy PWR, so every hit is `MIN_DAMAGE`.
`K`, `MIN_DAMAGE`, `BASE_ENEMY_PWR`, `ELITE_STAT_MULT`, `BOSS_ATK_MULT`, `ENEMY_PACE_RATIO`, `BASE_HP` and
`HP_PER_VIT` are `TUNED ✓`, so moving them is a design decision; do it under #36's two rules (every stat
source in the walk first, all constants together), re-measured on the walk and on seeded gate fights.

Two rows are not constants in the strict sense: the archetype stat spreads are a table, and `SEAL_LADDER_BASE_GOLD` *is* specified. Both are listed anyway because the same pass answers them.

**Removed from this table**, so they are not re-added by mistake — now `TUNED ✓`, derived, or deleted (#22, #23, #29): `SEAL_GRANT_INTERVAL_HOURS`, `SEAL_GRANT_AMOUNT`, `SEAL_GRANT_BANK_CAP_DAYS`, `FREE_PULLS_PER_DAY`, `FREE_PULL_COOLDOWN_MINUTES`, `K`, `CRIT_CHANCE_PER_POINT`, `CRIT_DAMAGE_PER_POINT`, `SKILL_BASE_COOLDOWN_SECONDS`, `SKILL_BASE_ABILITY_MULTIPLIER`, `WAVE_PACK_SIZE`, `ELITE_PACK_SIZE`, `PACK_LIVE_STREAM_FRACTION`, `BOSS_MINION_COUNT`, `STATUS_MAX_STACKS`, `STATUS_TICK_SECONDS`, `MAX_SUSTAIN_MITIGATION`, `MIN_SECONDS_PER_KILL`, and `GOLD_PRESTIGE_CAP` / `prestigeGoldFactor[]` (deleted). From the raids (#46): `RAID_REWARD_BASE` / `RAID_REWARD_GROWTH` (set by the user, 2026-10-04), every `RAID_*_HP_MULT`, `RAID_DUMMY_PACKS` and the three `RAID_RAMPAGE_*` (measured on the campaign walk, `TUNED ✓`); `RAID_BASE_STATS` and `RAID_LEVEL_GROWTH` were never built under those names.

| Constant(s) | Doc | Note |
|---|---|---|
| Offline Efficiency / Offline Cap `BASE_COST` (×2) | `idle-mechanics.md` §4 | Formula shapes locked, no anchor value |
| ~~`K_ATTACK`, `K_DEFEND`, `MEDAL_BASE_WIN`, `MEDAL_BASE_LOSS`, `MEDAL_UPSET_BONUS`, `ARENA_MATCH_BAND_RATING`, `ARENA_SHOP_GEM_PRICE`, plus (built 2026-10-09, #58) `ARENA_FIGHT_SECONDS`, `ARENA_DUMMY_SECONDS`, `ARENA_SEASON_REWARDS`, `ARENA_LEADERBOARD_NEIGHBORS`, `ARENA_SHOP_SEAL_PRICE`, `ARENA_SHOP_TRAIT_KEY_PRICE`, `ARENA_EVEN_FIGHT_SECONDS` (#60), `ARENA_BOT_LOADOUT` (#62)~~ (a Seal raid's Key is derived from the Seal price since 2026-10-10) | `arena.md` | **Locked 2026-10-11, the user's call** (#58): the band at ±100 Rating, the rest as built |
| ~~`PASSIVE_POINTS_PER_LEVEL`, `PASSIVE_TIER_COST`, `PASSIVE_ENDLESS_BASE_COST`, `PASSIVE_ENDLESS_COST_STEP`, `PASSIVE_BAND_MAGNITUDE`, `PASSIVE_RESPEC_GEMS`~~ | `passive-skill-tree.md` §2–§5 | **Locked 2026-10-11, the user's call** (GitHub issue #17) |
| ~~`EHP_DEF_CONSTANT`~~ | `global-power-number.md` §2 | **Locked 2026-10-11, the user's call** (GitHub issue #17) |
| `SKILL_COLLECTION_PASSIVE_FRACTION`, `ARTIFACT_COLLECTION_PASSIVE_FRACTION` | none — see #28 | What every owned Passive Skill or Artifact gives the Hero, equipped or not (#39), as a fraction of equipping it. 0.1 mirrors Gear; tune together with `GEAR_PASSIVE_COEFFICIENT` so all three collections feel comparable |
| ~~`PRESTIGE_STAT_PER_LEVEL`, `PRESTIGE_STAT_BASE_COST`, `PRESTIGE_STAT_COST_GROWTH`~~ | none — see #41 | **Locked 2026-10-11, the user's call** (GitHub issue #17) |
| `RAID_ENRAGE_SECONDS`, `RAID_DUMMY_SECONDS`, `RAID_KNIGHT_PWR_MULT`, `RAID_DIG_PWR_MULT`, `RAID_DIG_ADD_SECONDS`, `RAID_FORGE_PWR_MULT`, `RAID_FORGE_BOSS_STEPS`, `RAID_FORGE_HANDOFF_SECONDS` | `raid-system.md` | Built (#46). Each raid's HP multiplier is measured against its clock, so moving `RAID_ENRAGE_SECONDS` or `RAID_DUMMY_SECONDS` means re-measuring the HP multiplier it is coupled to. The PWR multipliers sit at 1: a raid boss hits like the stage it stands for |
| ~~`BOSS_SPECIAL_*` (11)~~ | none — see #45 | **Locked 2026-10-11, the user's call** (#45): hits as a share of max HP, 15/25/45% |
| ~~`CALENDAR_SCHEDULE`, `CALENDAR_INCOME_DAYS_FIRST`, `CALENDAR_INCOME_DAYS_LAST`~~ | none — see #47 | **Locked 2026-10-11, the user's call** (#47) |
| ~~`HOLIDAY_GIFTS`, `HOLIDAY_CLAIM_WINDOW_DAYS`~~ | `holiday-events.md` §2–§3 | **Locked 2026-10-11, the user's call** (#53) |
| ~~`GPN_DISPLAY_SCALE`~~ | `global-power-number.md` | **Locked 2026-10-11, the user's call** (GitHub issue #17) |
| `SLOT_BASE_BONUS` ×6, `GEAR_PASSIVE_COEFFICIENT` | `gear-equipment.md` §2 | Built. The six slot coefficients are deliberately *identical* — no doc ranks the stats against each other, so six different values would encode a spread nobody decided. `GEAR_PASSIVE_COEFFICIENT` must stay well under them or manual equip stops mattering |
| `SKILL_PASSIVE_MAGNITUDE[]`, `SKILL_ECONOMY_COEFFICIENT` | `skills-gacha.md` §4 | The whole 36-skill magnitude ladder, indexed by rarity. §4 authors it as "small" → "large" and assigns no number anywhere; the *relative ordering* is design content, so retune the set rather than entries |
| `SKILL_POTENCY_PER_POINT` | none — see #18 | What one point of a Skill copy's `(star × 10 + level)` scalar adds to its effect potency. **Identity at minimum**, so §4's authored bands stay the reference and only levelling multiplies up — ×2.18 at 5★/Lv10 on the placeholder. Its own constant rather than reusing `CHAMPION_INVESTMENT_PER_POINT` (×3.95 at max) because a Champion's scalar is its *only* growth axis while a Skill already carries a rarity band |
| `GOLD_BURST_MINUTES[]`, `GOLD_BURST_COOLDOWN_SECONDS` | `gold-economy.md` §6 | Burst size in minutes of income, and the cadence it repays over. The cooldown is a **decision, not a transcription** — at the shared 6.4s skill base, a 0.5-minute burst repays ~+470% Gold, two orders past §5's ×3 stack target |
| ~~`SKILL_COOLDOWN_RANK_STEP`~~ | none — see #36 | **Locked 2026-10-11, the user's call** (#36) |
| `SKILL_COOLDOWN_REFUND_FRACTION` | none — see #18 | How much shorter a "chance to refund / reset / re-trigger" Active's cooldown is rendered as. One constant for all three such Skills, so the approximation retunes in one place |
| `WEALTH_FACTOR_MIN/MAX`, `WEALTH_NEUTRAL_HOURS` | `skills-gacha.md` §4¹ | The Gambler's Strike family's bounded modulation. §4¹ suggests ×0.5–×2.0 explicitly and calls it not locked; the neutral point is where the factor passes through 1.0 |
| `ARTIFACT_EFFECT_PER_POINT`, `ARTIFACT_ECONOMY_COEFFICIENT` | `artifacts-dig-site-gacha.md` §6 | Per *point* of the investment scalar, unlike Skills' flat magnitude — §6 states the scaling for Artifacts and no doc states it for Skills. See #18's closing note |
| `SKILL_SLOT_BASE_COST`/`_GROWTH`, `ARTIFACT_SLOT_BASE_COST`/`_GROWTH` | `skills-gacha.md` §6, `artifacts-dig-site-gacha.md` §7 | Both mirror the Champion slot track exactly, so all three want deriving together — and all three compete with the two offline tracks for the same Void Shards |
| ~~`GOLD_STEP_BASE`, `BASE_GOLD`, `GOLD_PLATFORM_DISCOUNT`~~ | `gold-economy.md` §3, §3a | **`TUNED ✓` 2026-10-12** (#23.3): 1.075 and 1; the 0.85 discount unchanged, a design number. `GOLD_TENURE_CEILING` is generated, never tuned by hand: regenerate from `scripts/lib/economy-stages.ts` |
| ~~`SEAL_LADDER_GROWTH[]`~~ | `gold-economy.md` §7 | **`TUNED ✓` 2026-10-12** (#23.2): 1.2 re-derived and kept |
| ~~`LOADOUT_SLOT_BASE_COST_GEMS` (4-level doubling, #40)~~ | `loadouts.md` §3 | **Locked 2026-10-11, the user's call** (GitHub issue #17) |
| ~~`ONLINE_THRESHOLD_MS`, `HQ_REFRESH_INTERVAL_MS`~~ | `tech-architecture.md` §9 | **Locked 2026-10-11, the user's call** (GitHub issue #17) |
| ~~`TRAIT_AUTO_ROLL_BATCH`~~ | — (Auto Roll, `build-log.md` #52) | **Locked 2026-10-11, the user's call** (GitHub issue #17) |
| `MAX_EVASION` | `classes-and-combat.md` §7 | **Locked at 0.60** — not open, listed for completeness. Live since Traits (#52): Vital Reflex reaches 0.50 |
| `OVERFLOW_CONVERSION_RATE` | `classes-and-combat.md` §7 | The only crit constant still untuned. Rarely reachable: with LCK off the level curve only a deliberately built crit Hero passes 100% |
| ~~`SEAL_GRANT_PER_BOSS`~~ | `economy-and-currencies.md` §5 | **Locked 2026-10-11, the user's call** (GitHub issue #17) |
| ~~`CONVERGENCE_COOLDOWN_FACTOR`~~ | `capstone-class.md` | **Locked at 2, 2026-10-11, the user's call:** the capstone is meant to be strong. It gets every class-path node of the Passive Skill Tree too (`passivePathsOf`, already so) |
| ~~`MILESTONE_*` (14, the Arena track's three since #59)~~ | `economy-and-currencies.md` §4–5 | **Locked 2026-10-11, the user's call** (#48, #58) |
| ~~`VOID_SHARD_BASE`, `VOID_SHARD_GROWTH`~~ | `economy-and-currencies.md` §3 | **Locked 2026-10-11, the user's call** (GitHub issue #17) |
| `wealthFactor` clamp range for Gambler's Strike family | `skills-gacha.md` §4 | Suggested ×0.5–×2.0, not locked |
| ~~`CHAMPION_SLOT_BASE_COST`, `CHAMPION_SLOT_COST_GROWTH`~~ | `champions-guild-gacha.md` §1 | **Locked 2026-10-11, the user's call** (GitHub issue #17) |
| ~~`CHAMPION_PASSIVE_PER_POINT`~~ | `champions-guild-gacha.md` §7 | **Locked 2026-10-11, the user's call** (GitHub issue #17) |
| `CHAMPION_INVESTMENT_PER_POINT` | `champions-guild-gacha.md` §2 | What a copy's `star × 10 + level` scalar is worth. Sets the payoff on dupe levelling, so it decides whether pulling wide or levelling deep is correct |
| Archetype base stat spreads (`ARCHETYPE_DEFINITIONS[].spread`) | `champions-guild-gacha.md` §2 | Not a constant but the same problem: §2 states outright there is no Champion equivalent of the Hero's §2 table, so all four spreads are a reading of the archetype identities rather than a specified number |
| ~~`SEAL_LADDER_BASE_GOLD`~~ | `gold-economy.md` §7 | **`TUNED ✓` 2026-10-12** (#23.2): 1,000,000 kept, the doc-locked floor. Uncapped per day by design — see the note below |
| `TANK_THREAT_MULTIPLIER`, `TAUNT_THREAT_MULTIPLIER` | none — see #14 | How hard the two documented aggro anchors pull. Any value above 1 already puts a Tank in front of its row-mates; the magnitude only starts mattering once threat becomes contested and continuous |
| `FROSTBIND_STACKS_PER_CAST`, `FROSTBIND_FREEZE_STACKS` | none — see #15 | How fast Frostbind's slow builds and how deep it must get before the freeze lands. Two dials so time-to-freeze can be retuned from either end; a threshold above `STATUS_MAX_STACKS` turns the freeze off entirely |
| The `SKILL_*` magnitude set, `ENRAGE_*`, `KILL_SHOT_CRIT_MULTIPLIER`, `EXECUTE_BONUS`, `FOCUSED_BARRAGE_HITS`, `REVIVE_HP_FRACTION` | none — see #15 | Every ability magnitude in the game. Both rosters describe effects entirely in prose ("a short duration", "a portion", "small") and assign no numbers anywhere. The *relative ordering* is design content and deliberate — wide AoE pays for reach, a pierce beats a basic attack by a little — so retune the set, not individual entries. `HASTE_SPD_BONUS` is excluded: §3 states the doubling |

**On `SEAL_LADDER_BASE_GOLD` — reviewed and closed.** *(Written against the 1.0007 ladder; at 1.2, since 2026-10-04, a 4.9B pile buys ~37 Seals of one gacha in a day — the compounding below does the braking. Gold also buys the Shop's two offline tracks since #55.)* Gold bought nothing in the game except Seals, so this price was the entire Gold sink. The campaign sim banks ~4.9B Gold by prestige 4, which at the base rung and `SEAL_LADDER_GROWTH[champion] = 1.0007` converts to roughly **2,100 Seals in a single sitting** — about two full 1,066-dupe Champions — because `MAX_SEALS_PER_PURCHASE` bounds the per-call size and nothing bounds the per-day total.

**That is intended, and no daily cap is being added.** A player willing to spend an exponentially increasing amount of Gold should be able to keep buying; the ladder's compounding *is* the brake, and it is a smooth one rather than a wall that stops the session dead. Converting a large Gold pile into a large collection is what the pile is for. `SEAL_LADDER_BASE_GOLD` stays an ordinary tuning value in the table above, calibrated at playtest against real Gold income like everything else — not a structural problem to solve first.

---

## Suggested order

~~**Before merging `hero-quest` into `main`: settle the ??? capstone class (#43).**~~ **Done 2026-10-09** as the Ascendant: designed, built and its art locked (`build-log.md` #43). Its power is a standing-tuning row, and #49 (its cinematic in the game) was closed 2026-10-11, kept as it plays. ~~Before the merge, also decide #48.2 (milestone claims for history).~~ Decided 2026-10-09: no migration.

**Reordered 2026-10-02, the user's call: the playtest and the Gold balance (step 2) move to the very end, with step 7.** The battle stage comes first (`build-log.md` #34): the idle stage and the boss replay on the stage both landed that day. The argument below for playing early was weighed and set aside; it is kept as the record of what the reorder gives up.

1. ~~**Phase 3 — the remaining three gachas**~~ **Done — `build-log.md` #18.**
2. **Close out the tuning pass** — *deferred to the end with step 7 (2026-10-02).* Small, and it was meant to come before anything is built on top of the loop:
   - **Play a session against the tuned loop** and log it in `playtest-notes.md`. The predictions table there is refreshed; session 1 is the only one on record.
   - ~~**Decide the Gold consequences (#23)**~~ **Decided 2026-10-12** (the user's call via issue #10): the anchors, first-week income and the Seal ladder, set from the sim. The playtest confirms the first-week half (🔬 below).
   - ~~**Confirm the solo shape (#22.1)**~~ **Decided 2026-10-09:** no prestige without a party is intended.
   - ~~**Check the cleared-run manual re-engage** flagged in #25.~~ Fixed.
3. ~~**World & Enemy Design (#6)**~~ **Closed 2026-10-04** — the art is restyled and locked (`art-style.md`); regular enemies get no abilities. ~~**Boss specials become real (#45)**~~ **built 2026-10-08**, measured on seeded gate fights; the open half is under #45 above.
4. **The last quick call (#2)**, the Arena band — answer it with the Arena. #1 and #3 are decided, and with #3 the raid-rule questions #31 and #32 (2026-10-04); the asset calls (#4, #30) on 2026-09-17.
5. **Phase 4 — endgame systems** (`implementation-plan.md`). ~~Arena~~ built (#58). ~~GPN~~ built (#28); the leaderboard aggregate and Defense GPN built with the Arena (#58). ~~Battle Speed~~ built (#44). ~~Raids~~ built, all five (#46). ~~Traits~~ built, with evasion (#52). ~~Holidays~~ built, the gifts (#53). ~~`loadouts.md` §4's per-raid auto-apply~~ built (#54); the Arena's half with the Arena (#58).
6. ~~**Passive Skill Tree (#7)**~~ **Built 2026-10-11** (`build-log.md` #63), on level-up points instead of a raid.
7. **Playtest, then tune the rest.** The combat and progression block is tuned (#22); the gacha, shop, economy and ability-magnitude constants are settled here — see the standing-tuning section. The balance script and campaign sim stay in use throughout. ~~Once the Gold balance is decided, rebalance the login calendar's Gold and Gem days (#47).~~ Locked as built 2026-10-11.

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

### Does Gold feel like anything in week one? — **new, from #23; the confirmation #23.3 waits on**

**Set from the sim on 2026-10-12, to be confirmed here** (#23.3 was left for the playtest on 2026-10-11). The campaign walk's party of three now earns ~25K Gold an hour at day 1 and ~216K at day 7, about a quarter of the platform's first-week income (it was ~1K an hour, 0.07%); solo is ~7%. The first Gold Seal is about day 2, the Shop's first Offline Cap levels day one. Watch whether the number reads as an income next to the platform's other games without becoming the reason to play, whether the Gold ladder and the Shop's offline tracks get used in week one, and whether the first day (when the walk briefly runs near 70% of a still-tiny platform rate) feels generous or right. The levers are `BASE_GOLD` (level) and `GOLD_STEP_BASE` (slope, kept under 1.08).

### The whole standing-tuning table

Every remaining `// UNTUNED ╧` constant is a playtest deliverable rather than a pre-phase chore — see the standing-tuning section for the reasoning. The watchlist is where they get answered.

