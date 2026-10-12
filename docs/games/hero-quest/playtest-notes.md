# Playtest Notes

**Raw capture. Not a design doc — nothing here is decided.**

This is where observations land while playing, in whatever shape they arrive. They get distilled into `open-items.md` afterwards: model findings against the constants they move, presentation findings into the requirements list for the Pixi battle scene. Keeping the two files separate is the point — three months from now, `open-items.md` will say *what* changed and this will say *why it felt wrong*, which is the half that normally gets lost.

Append freely. Nothing here needs to be tidy, sorted, or complete.

---

## How to write an entry

Position, hero level, what you noticed. That's the whole format.

```
W3S4, ~level 180 — sat here 40 min, no idea what would break it
P1W5 — pulled a Mythic and the next two worlds were a walkover
Forge — couldn't tell which of two pieces was better
```

**Don't pre-sort.** You should not have to hold a taxonomy in your head while playing. Sorting happens later.

---

## Two buckets (for the distilling pass, not for you)

**Model findings survive the renderer untouched.** Kills per stage, whether hero level keeps pace with the ceiling, where walls land, whether a Mythic trivialises a stretch, whether you can afford to pull, whether a maxed Skill is numerically felt. `tech-architecture.md` §7 makes this structural, not incidental — the Pixi scene "renders, it never decides." Nearly all of the 62 remaining `// UNTUNED ╧` constants live here, and this is the entire reason playtesting on placeholder presentation is worth doing.

**Presentation findings are provisional but still worth capturing.** Whether the wipe loop reads as "you are too weak here", whether `1 damage` misleads, whether the screen ever says what would break a wall. These genuinely will change under a real battle scene — so they do not feed tuning. They feed **the spec for `BattleCanvas.vue`**, and they are far more accurate written during the confusion than reconstructed later.

`asset-list.md`'s own phase 0–1 row already anticipates this: *"even 1–2 of the 16 node appearances is enough to validate the loop before committing to all 80 spritesheets."* Playing against placeholder chrome is the sequencing the project chose, not a compromise being made.

---

## Falsifiable predictions to check against

The campaign sim (`bun run sim:hero-quest --report=campaign`) projects the run below. It projects *what the formulas say* — the value of playing is finding where lived experience departs from it.

**Current — after the combat tuning pass, refreshed 2026-09-15 at `55ff15b`** (`open-items.md` #22). Grind budget 72h per blocked stage; stand-in Champions are Common and un-invested; no Gear, Skills or Artifacts. Run both — the solo figure is what a brand-new account experiences.

| Prediction | Solo Hero (`--party=1`) | Party of 3 (`--party=3`) |
|---|---|---|
| **First wall** | W1S5 boss timer — needs level 20, arrives ~13 | none — passes W1S5 at level 1 |
| **Grind wall** | P0 W8S10 (super boss) | P1 W2S10 (super boss) |
| Level at the wall | 401, needs 430 | 559, needs 588 |
| Prestiges reached | **0** | 1 — the first in ~6½ days |
| Total time | 10d 11h — 2h 38m fighting | 10d 13h — 3h 31m fighting |
| Gold earned | 147,254 | 311,851 |
| Live Gold/hr from W1S1, level 1 | ~530 (2.72s/kill) | ~1.2K (1.21s/kill) |
| **Gold/hr at day 1 / 3 / 7** (2026-10-12) | 11.3K / 23K / 48K | 25.5K / 51K / 216K |
| **Share of platform, first week** (2026-10-12) | ~7% | ~24% (it was 0.07%) |
| **First Gold Seal** (2026-10-12) | day 3 | day 2 |
| One-hour online settle, fresh account | reaches level 52, parked at the W1S5 boss | reaches level 68, parked at the W1S5 boss |
| Level to clear the first loop | 524 | 494 |

**What the sim says the week should feel like:** fights are short and nearly constant in length per world (~10–22 min of fighting per world); everything else is waiting in front of Stage 5 and Stage 10 gates, from under an hour in World 1–2 to about two days in World 10. Bosses fire on their own while the tab is visible. Elite waves can wipe a solo account in World 1 without costing ground. ~~Gold is small — the ceiling does not bind at P0~~ **Gold is about a quarter of the platform's first-week income for a party of three** (`build-log.md` #23, decided from the sim 2026-10-12; the next session confirms it): enough to buy a Seal by day 2 and the Shop's first offline levels on day one.

⚠ **The rows above the 2026-10-12 ones are as of 2026-09-15 and the walk has moved since** — at 2026-10-12 a party of three walls at P0 W10S10 (level 472, needs 502) after 9d 20h with 151,074 Gold before the Gold retune and 37,202,074 after, and makes its first prestige at ~13 days on a 200-hour budget (`open-items.md` #36); solo walls at P0 W8S10 (level 394, needs 425) after 9d 17h, 107,942 → 9,444,030 Gold. Recorded, not refreshed: the rest of the table wants re-running with the pacing pass.

<details><summary>Earlier baselines</summary>

**After the session-1 HP change (2026-08-17):** solo P1 W1S6 (elite), level 410, 1 prestige, 3d 6h, 19.5M Gold; party of 3 P2 W2S6, level 808, 2 prestiges, 4d 14h, 61.5M Gold. **Pre-session-1:** solo P2 W8S6, level 1,025, 2 prestiges, 3d 13h, 91.6M Gold; party P4 W3S6, level 1,567, 4 prestiges. Gold figures from both predate the account-age ceiling and are not comparable.

</details>

**The single most important things to judge next session:** whether a week of mostly-waiting reads as rhythm or as a stall, whether an automatic boss still feels like an event, and whether the solo opening's World 1 boss wall is legible as "get a party".

**The most valuable data point is reaching the wall and seeing whether it walls where and how the sim says.** If it feels *worse* than projected, the other power sources — Champions, Gear, Skills, Artifacts — are not carrying what the model thinks they carry, which is a larger finding than any individual constant.

---

## The four questions Phase 1 exists to answer

From `implementation-plan.md`. Not a checklist to work through — just what to stay alert to.

1. **Does `ENEMY_STEP_BASE = 1.08` feel right?** Now `TUNED ✓` on the sim. Watch especially for the consequence nobody has felt yet: **there is no prestige difficulty reset any more.** P2 W1S1 is harder than P1 W10S10, continuously. Does the run keep a rhythm — push, wall, farm, break through — or is it one flat grind?
2. ~~**Can a persistent, uncapped hero level keep pace with a ×T-per-prestige ceiling?**~~ **Answered on paper by #22** — the level curve is derived from the enemy curve, so it keeps pace by construction, and walls come from fight length at boss timers instead. What only play can answer: does a wall *read* as "need a party / need gear", or as arbitrary?
3. **Is boss-gating-requires-presence tolerable?** Prestige currency can never be earned offline, by design. **Changed since this was written:** bosses now engage automatically while the tab is visible (`open-items.md` #25), so "presence" means having the tab open, not pressing a button. Anticipation, chore — or does it now go unnoticed?
4. **Is 30 kills × 100 stages the right run length?** At ~a week for a party of three, with ~3 hours of it fighting.

Plus the two already queued in `open-items.md` §🔬: whether a Mythic is too far ahead of a Common (three compounding payoffs now ride one rarity roll, and only the ×2.5 was ever signed off), and whether the slow wall reads better than a hard one.

And three things Phase 3 shipped that nobody has ever felt: **Skill potency** (×2.18 at 5★/Lv10 — is levelling a Skill visible at all?), **reflect** (inert until Phase 3 wired it — does Guardian's Reflect now do anything?), and **whether you can actually afford to pull** against real income.

---

## Known-inert — not bugs, don't chase

- **`controlResist` does nothing.** Unshaken, Unbreakable Will and Immortal Vanguard are declared against a real modifier kind, but `EnemyStats` is HP/PWR/DEF and enemies have no abilities — there is no control to resist. Goes live the day enemy kits do.
- **Six effects are flat approximations.** Ramping-over-a-fight buffs (Momentum, Steady Ground, Flow State, Compound Interest) render flat because the idle rate is one frozen average per window with no "later in the fight". On-kill and once-per-fight procs (Lucky Dig, Windfall, Unbroken, Bulwark's Legacy) become rates.
- **No world or enemy art yet.** Artifact, World and enemy names are all real as of 2026-09-15 — do note if a name reads wrong on screen or doesn't fit what the item does.
- **Presentation is placeholder chrome**, not the intended Pixi 8 canvas (`tech-architecture.md` §7). The battle screen does walk forward between server payloads now (`open-items.md` #26), so a jumping bar or a stage counter that snaps back on refresh *is* worth reporting.
- **`STAT_PACES_ENEMY_CURVE` does nothing while `XP_PACE_SLACK` is 1.0** — both stat curves are numerically identical.
- **Ability magnitudes are still placeholders** (`SKILL_*`, `ENRAGE_*` and the rest). Note if a kit feels useless or dominant, but that is not yet a tuning finding.

---

## Harness shortcuts worth using

`/hero-quest/dev` (development builds only). Three comparisons it makes nearly free:

1. **Skip 8h offline, then 8h online.** That difference *is* the offline cap and the efficiency tax. Punishing enough to matter, or so small the shop track is pointless?
2. **Unlock everything at 0★/Lv1, then at 5★/Lv10.** The full `(star × 10 + level)` investment curve in two clicks. The top of it has never been observed.
3. **Wipe and replay the first hour.** Once you have seen the endgame the opening reads completely differently — and it is the only part of the game you normally get one shot at.

---

## Session log

<!--
Append below. Newest session at the bottom. Anything goes.
-->

> **Not a session — a pointer.** Between session 1 and 2026-09-15 the combat and progression loop was retuned on the campaign sim, Gold moved onto account age, and bosses started engaging automatically (`open-items.md` #22–#27). Several session-1 decisions below were later superseded — notably `BASE_HP` 2000 → 150. No session 2 is logged; if one happened, its observations are not recorded anywhere.

### Session 1 — 2026-08-17
- Player health feels absurdly large compared to other stats from both the hero and enemies, especially because I haven't taken a single point of damage in 3 worlds. Can be lowered by a factor of 20.
- Hero level progression pace feels like, but the numbers feel a bit high. Lower everything by a factor of 10.
- I currently start out with 1 gacha pull for each gacha (I guess this resets daily to one). I want the players to 
  start out with enough seals for a 10-pull
- The gacha pages are very cluttered at the moment. Move all gacha's to one gacha page and place them in a 2x2 
  square. Also for each gacha add an information icon which shows its specific drop rates for all level when clicked.
- Collections should be moved to a generic collections page with a submenu per collection. There each collection 
  should firstly be sorted by rarity, then archetype. Add filters where it makes sense.
- A new player currently has no idea what each skill of stat means. Add more information icons, and also definitely 
  add a wiki page like some other games have.
- In the collections, instead of the word dupes add a small progress bar

#### Decisions taken on the above — 2026-08-17

Resolved item by item rather than assumed. Where a decision goes against something already written down, that is called out, because #1 and #2 both do.

**1 — HP. ✅ Applied.** `HP_PER_VIT` 200 → 10 **and `BASE_HP` 100 → 2000.** The second constant was not requested and is what makes the first one safe.

The sim confirmed the observation outright and then blocked the naive fix:

- **The complaint is real and larger than reported.** `HP_PER_VIT` at 100 and at 200 produce byte-identical campaigns — same wall, same level, same prestige count, solo *and* with a party. The top half of the old value was doing nothing whatsoever.
- **A straight cut breaks a fresh account.** Phase 1's derivation still reproduces: at `HP_PER_VIT` 10 with `BASE_HP` at 100, a level-1 solo Hero cannot clear World 1 Stage 1 and the run is unfarmable from the first screen. A new account *is* solo, so this was a hard blocker rather than a theoretical one.
- **`BASE_HP` resolves it because it is flat.** It dominates at level 1 and is arithmetic noise once VIT has compounded — a party of 3 walls at exactly P2 W2S6 / level 808 for every value from 1000 to 8000. So it carries the opening while `HP_PER_VIT` governs everything after. Phase 1 could not see this split because it was tuning a solo Hero, where the two ends are the same number.

Chosen over the two safer options at `BASE_HP` 2000: `HP_PER_VIT` 25 (3 prestiges, 3d 7h) and 50 (3 prestiges, 2d 22h). Both remain available if ÷20 proves too punishing.

Also still true and worth re-checking in play: mitigation is `min(1, DEF / (PWR × K))` with damage floored at `MIN_DAMAGE`, so **if the party has clamped to 100% mitigation, enemies deal 1 per hit regardless of pool size** and no HP change addresses it. The sim says HP was genuinely the binding issue here, but that is a model result — confirm it by actually taking damage next session.

**Four specs broke and were repaired rather than re-pinned.** Three encoded party durability against the old HP (`fight.spec` needed level 80 rather than 30 to reach the boss timer without wiping; `settle.spec`'s elite gate needed 80 rather than 40; the "unreachable wipe" threshold came from 1000 stage clears to 100, with the level-200 fixture kept). The fourth was more interesting: `applyXp`'s remainder spec hard-coded an overshoot of 25, which was a quarter of a level at `XP_TO_LEVEL_BASE` 100 and **more than two whole levels** at 10 — it had been asserting "overshoot by a bit" while supplying something else entirely, and only passed because the two coincided at the original base. It is now expressed as a fraction of the level's own price and survives any future re-denomination.

**2 — XP. ✅ Applied.** `XP_TO_LEVEL_BASE` 100 → 10 and `XP_BASE_PER_KILL` 10 → 1. A pure re-denomination: level pace, level count and wall position are all set by the *ratio* of the two, so dividing both is provably neutral. Confirmed empirically as well as on paper — the post-change campaign lands on exactly the levels (410 solo, 808 party) that the HP sweep produced while still running the old XP constants.

**Rejected: lowering `XP_TO_LEVEL_GROWTH`.** It was the intuitive lever and it is the wrong one — cheaper levels mean *more* levels, so it works against the stated goal. Swept, campaign report:

| `XP_TO_LEVEL_GROWTH` | Wall | Level | Prestiges | Grind |
|---|---|---|---|---|
| 1.16 (current) | P2 W8S6 | 1,025 | 2 | 3d 11h |
| 1.12 | P3 W2S6 | 1,185 | 3 | 5d 9h |
| 1.08 | P3 W10S6 | 1,505 | 3 | 9d 17h |
| 1.06 | P4 W7S6 | 1,785 | 4 | 11d 9h |

`XP_STEP_EXPONENT` is derived from the growth and compensates for XP *income*, not for the level count — which is why the pace does not self-preserve here. Worth keeping: the sweep also shows lower growth buys 4 prestiges instead of 2 out of the same curve, so it is a real lever for *run length* if that ever becomes the question.

**3 — Free pulls. ✅ Applied, and revised 2026-09-16 (`open-items.md` #29).** Originally: `SEAL_GRANT_AMOUNT` 1 → `TEN_PULL_COST` so the daily grant was one free 10-pull, plus 2 further free 10-pulls per gacha per day on a 30-minute cooldown. **The daily Seal grant has since been removed entirely** and the entitlement retuned to **3 free 10-pulls per gacha per day on a 10-minute cooldown** — still a true entitlement, spendable only as a 10-pull, never banked or split, and now the only free pulls in the game.

Built as a **payment branch on `gacha/pull.post.ts`, not a second route.** A free pull *is* a pull: same rarity roll, same dupe merge, same level bump, same Gear auto-equip. Only the payment differs, and duplicating the route would have meant two copies of the roll loop — exactly what `CLAUDE.md` §3's one-route rule exists to prevent.

**The two payment paths need different concurrency guards, which is the one genuinely interesting thing here.** Seals use claim-then-reward — the conditional `WHERE seals >= cost` debit *is* the mutex. Entitlements cannot: availability is three coupled values (the per-system counter, the day key that resets it, and the last claim time), so there is no single column to conditionally decrement. `claimFreePull` therefore uses lock-then-read — `SELECT … FOR UPDATE`, read inside the lock, write before releasing. A conditional update on the claim timestamp was specifically not an option, per the standing warning about microsecond-vs-millisecond CAS. It lives in `server/utils/hero-quest.ts` rather than the route so the race is testable: **10 concurrent claims resolve to exactly 1 winner and 9 rejections.**

Storage mirrors the Gold ladder exactly — `freePullsUsedToday` (per-system map) + `freePullDate` (`YYYY-MM-DD`) + `freePullClaimedAt`. Nothing runs at midnight; a stale day key simply reads as zero. The cooldown deliberately carries *across* the day boundary so claiming at 23:59 does not hand out another at 00:00.

One spec was wrong before the code was: it advanced a third claim by twenty cooldowns expecting a refusal, but twenty cooldowns is ten hours, which crosses UTC midnight and legitimately refills the allowance. Worth remembering that "long enough later" and "still today" are different questions here.

**Consequence, accepted:** this takes a gacha from 1 pull/day to 30 free pulls/day and *no* free Seals (was 9 Seals plus 20 free pulls before the 2026-09-16 revision), ×4 systems. 30 a day is the intended hard ceiling for a player who never buys Seals. The collection curve, Essence income and the crafting economy all move with it and none has been re-derived — worth a look in a tuning pass, not a problem to fix.

Note the Guild page predates `GachaHeader` and still renders its own pull row, so the free-pull button is duplicated there. Finding 4 folds all four gachas onto one page, which deletes that copy.

**4, 5 and 7 — the UI restructure. ✅ Applied together**, because they are one change. Moving Collections off the gacha pages is precisely what leaves a gacha small enough to be a card, so neither half lands on its own.

**Navigation went from nine tabs to six.** The four gacha tabs (Forge / Guild / Training Grounds / Dig-site) became **Gacha** and **Collections**. The split is by *action*, not by system: every pull button is on one screen, everything you own is on the other.

| Was | Is |
|---|---|
| `hero-quest/{forge,guild,training,dig-site}.vue` | `hero-quest/gacha.vue` — 2×2 of `GachaCard.vue` |
| — | `hero-quest/collections/{gear,champions,skills,artifacts}.vue` under one submenu |
| `GachaHeader.vue` (full-width, ×4 pages) | `GachaCard.vue` (a quarter of one page) |
| four near-copies of a collection grid | `CollectionCard.vue` + `CollectionToolbar.vue`, written once |

⚠ **This departs from the docs' four-tab layout**, which `gear-equipment.md` §6 and its siblings name as *places*. The names survive as the card headings and the submenu, and no rule, formula or number moved — but it is a real deviation from a locked design, taken on a playtest call rather than a doc revision, and it is written down here rather than left for someone to discover.

**4 — Drop rates.** The info icon opens the **whole ladder**, all 10 levels × 6 rarities with the player's current rung marked, plus the pulls needed to leave each level. Derived on the client from `dropRatesFor`, the same pure function the server rolls against — not a server-authority violation, because the drop table is public content and a tampered client can only lie to itself about odds it cannot influence. What stays server-side is the *roll*.

**5 — Ordering and filters.** Rarity low→high, then the system's own axis, then **name**. The name tiebreak is the non-obvious one: without it the order inside a rarity/axis cell falls back to array order, so a content edit that reorders a roster silently reshuffles a grid the player has learned the shape of. `hqSortCollection` is the only part of this restructure that is logic rather than layout, so it is the only part with a spec — nine of them, including that it does not mutate the payload it is handed.

Three filters, identical on all four grids: rarity, the system's axis, and owned/missing. Unowned entries stay **inline as locked `???` cards** rather than being hidden or pushed to the end — that is what makes the grid a checklist, and "Missing" is how you look at only the gaps.

**Equipping moved with the grids**, which is what makes the split hold up: a party, a gear slot, a skill loadout and an artifact set are all decisions about things you own. Gear keeps its six slots and the §3 upgrade badge; Champions keep the party editor and formation rows; all of it moved verbatim rather than being rewritten.

**7 — Dupes.** `DupeBar.vue`: the count sits *inside* the bar, centred over the fill rather than within it (a label inside the fill vanishes at 0% and clips at every width between). Maxed copies read `MAX` instead of a ratio.

Four intervals became one: `useHqClock` is a single shared ticker for all four free-pull countdowns, refcounted and torn down with the last subscriber. It still drives labels only — the server decides whether a pull is owed.

*Verified:* typecheck clean, 967 tests (9 new), lint clean, build succeeds, and the compiled route table contains exactly the six intended tabs with the four old ones gone. **Not verified: how any of it looks with live data** — the pages sit behind a global auth middleware, so rendering is what the next session checks.

**6 — Wiki. ✅ Applied.** `/hero-quest/wiki`, five pages: Basics, Combat, Economy, Gacha, Content.

**The staleness problem was the whole design constraint.** Roughly a hundred constants still carry `// UNTUNED ╧` and six rosters are still being authored, so a hand-written wiki would be wrong within a week. Two mechanisms:

- **Every number is interpolated from `constants.ts`**, never typed. Prose describes *shape* — "a clamped ratio, not a curve" — and magnitudes come from the source of truth or are not stated.
- **The Content page is a `v-for` over the content modules.** All 16 classes, 48 Champions, 36 Skills, 36 Gear, 48 Artifacts, the 33-effect pool and 10 Worlds render from the same arrays the gacha rolls against. A roster edit updates the wiki; there is no second copy to forget.

**That claim is enforced, not just intended.** `test/hero-quest/wiki.spec.ts` asserts each formula string actually contains its constant's rendered value, so replacing an interpolation with a literal fails the build. Verified by mutation — hard-coding `HP = 100 + VIT × 200` (the pre-retune values) failed two specs. The expected substrings deliberately carry context (`never below 1`, not `1`), because `MIN_DAMAGE` is currently `1` and every formula already contains a `1` somewhere; asserting on the bare digit would have passed no matter what.

**What generation cannot do is read an `// UNTUNED` marker** — it lives in a comment, not a value, so no page can list which constants are provisional. Rather than fake it, Basics carries one banner saying every figure is live but most are still being tuned.

**Info icons, the other half of the finding.** `InfoTip.vue` on the battle screen's four stat tiles and on the auto-cast line, reading from `HQ_STAT_DOCS` — the same table the wiki renders, so a tooltip and a wiki entry can never describe a stat differently. **Tap to open, not hover:** `UPopover`'s `mode="hover"` is a Radix HoverCard, which is desktop-only and does nothing on touch — the exact failure a `title` attribute has, and the one the icons exist to avoid.

The Economy page lists Trait Gems, Raid Keys and Arena Medals and **marks them as not in this build**. Listing them as working would send players hunting for a currency they cannot earn; omitting them leaves anyone who has read a design doc confused instead.

*Verified:* typecheck clean, 982 tests (15 new), lint clean on changed files, build succeeds, and all five wiki routes are in the compiled route table. Rendering with live data is still unverified for the same reason as the UI restructure — the global auth middleware.

Consistent with precedent, incidentally: `app/pages/hack/wiki.vue` already took the same import-the-config-and-render approach, so this is the house pattern rather than a new one.
