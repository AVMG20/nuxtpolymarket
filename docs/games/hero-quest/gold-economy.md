# Gold Economy — Curve, Ceiling & Sinks

Status: **Locked, revised 2026-08-18** — the per-kill curve (§3) and its calibration (§9) were replaced when Gold moved onto account age; see §3a. Everything else — the decoupling (§2), the throughput floor (§4), stacking (§5), burst denomination (§6), the Seal ladder's *shape* (§7) and the Gambler's redesign (§8) — stands. Resolves `tech-architecture.md` §9.1.

## Structure recap

- **Coins (in-game: Gold) is `user.balance`, Postgres `numeric(19,4)`** — a hard ceiling of **~10¹⁵** (999,999,999,999,999.9999). Per-user, not shared between players; no real money anywhere on the platform. Shared *across the user's games* (Xeno, Colony, Miner, Hack Ops, Shapezz, Pirates, Bank), so this game's income must live on the same scale as theirs.
- **Core resolution: Gold is decoupled from the enemy curve entirely.** The enemy curve crosses the column ceiling at **prestige ~4.5** — so no formula pegged to it survives, dampened or not. Gold instead follows its own shallow curve over the same index, **capped by a ceiling indexed on wall-clock account age** (§3, §3a), while all infinite scaling routes through Void Shards, the gacha collections, and combat stats (which are text-column Decimals and don't care).
- **Target (revised): parity with the platform at equal account age, discounted.** A Hero Quest account keeping pace earns `GOLD_PLATFORM_DISCOUNT = 0.85` of what the geometric mean of Colony and Xeno pays an account of the same age. That **supersedes** the earlier calendar anchors (Colony endgame ~235.6M/hr at ~3 months, 60% of Xeno's ceiling ~0.71B/hr at ~6 months, a +2%/prestige crawl past a cap) — see §3a for why a prestige-indexed curve could never hit them. Longevity past the platform's own endgame is a +20%/year crawl, and is otherwise carried by the non-Gold systems by design.

---

## 1. The Constraint, Restated With the Platform Data

Two facts from the cross-game analysis frame everything:

1. **The platform's games don't share an absolute scale** (65,000× spread at the same "Beginner" label) — each game's income is only meaningful against its own cost ladder plus the cross-game pacing metric ("hours to next upgrade"). So this game is free to pick its own scale, as long as its *endgame* lands where you've anchored it.
2. **The ceiling is comfortable at your chosen anchors.** At the Xeno-end rate (1.18B/hr) running 24/7, the balance column takes **~97 years** to fill; at a 2B/hr plateau, ~57 years; even under a hypothetical *perpetual* 10x Battle Speed at plateau, ~5.7 years of literally never spending. The max single offline collect (72h cap, 100% efficiency, plateau rate) is ~1.44×10¹¹ — four orders of magnitude under the ceiling. **Your targets are column-safe with enormous margin.** The ceiling only ruled out pegging Gold to the enemy curve; it does not constrain the curve you actually want.

The 6-month anchor question is resolved: the analysis doc flags Xeno's End figure as a **continuous, zero-downtime, perfect-play ceiling**, not a realized average — and this game, being fully idle-native with offline accrual, will *realize* much closer to its own ceiling than Xeno players realize theirs. ~~**Locked: the 6-month realized target is 60% of Xeno's ceiling (~0.71B/hr)**~~ **Superseded by §3a.** The target is now the platform's own income at the same account age, ×0.85, which lands far lower than that anchor (≈52M/hr at day 180). The column-safety conclusion above is unaffected — a lower target only widens the margin.

---

## 2. The Decoupling — What Scales With What

| Quantity | Scales with | Bounded? |
|---|---|---|
| Enemy stats | `b^n`, `n = prestige × 100 + (world-1) × 10 + (stage-1)` | No — infinite by design |
| Hero/Champion combat stats, damage, HP | Levels, stars, gear — chases the enemy curve | No — text-column Decimals, fine |
| Void Shards | `100 × 2^prestige` | No — **must move to text/Decimal storage** (already flagged in tech doc; ~prestige 56 breaks bigint) |
| XP | Free to follow enemy value — never touches `user.balance` | **No longer run-scoped** — Hero level persists across prestige (`core-progression-and-prestige.md` §3, revised), so XP is a permanently accumulating quantity. Still unbounded and still fine, since it's text/Decimal like combat stats, but the original "it resets anyway" justification no longer applies |
| **Gold** | **Its own shallow curve on the shared index, `min`'d against an account-age ceiling (§3, §3a). Never `enemyMultiplier`.** | **Yes — by construction** |

This is less of a redesign than it sounds: nothing locked anywhere routes real power progression through Gold at high prestige — that already all flows through Void Shards and the four gacha systems. Gold's defined role (Seal top-ups, future sinks) was always mid-loop convenience. This doc just gives it a formula that admits that.

---

## 3. The Gold Curve

### Per-kill formula — **revised 2026-08-18**

```
n = prestige × 100 + (world-1) × 10 + (stage-1)          // the enemy curve's own index

goldProgressionFactor(n) = GOLD_STEP_BASE^n               // 1.017
goldTenureCeiling(days)  = GOLD_PLATFORM_DISCOUNT × platformCeiling(days)   // §3a

goldPerKill = BASE_GOLD × min(goldProgressionFactor(n), goldTenureCeiling(accountAgeDays))
```

- **Progression earns Gold; the calendar only refuses to pay out ahead of itself.** Pushing deeper and prestiging raise the first term; an account that stops progressing stops growing. The ceiling never *grants* income.
- **One base over one index, so there is no seam.** Looping back to World 1 on prestige never cuts Gold per kill — the old `1.25^(w-1) × 1.05^(s-1) × prestigeGoldFactor[p]` shape did: the within-run factor climbed ×11.6 across a run and then the prestige rung paid only ×2.8, so finishing World 10 *cut* Gold per kill by about ×4.
- **It needs no cap of its own.** `GOLD_PRESTIGE_CAP` and the +2% plateau crawl existed to keep an unbounded prestige chain inside `numeric(19,4)`. The `min` makes the tenure ceiling the bound for every position, forever, so both are **deleted**, along with `PRESTIGE_GOLD_FACTOR[]`.
- **`GOLD_STEP_BASE = 1.017`** is the only progression dial. It was chosen as the shallowest base at which the weakest roster the campaign sim walks never leaves the platform's 0.4–2.5× cross-game band while still spending a real share of its time below the ceiling — so falling behind on power still costs Gold. ⚠ That measurement predates the week-long prestige loop (`open-items.md` #22) and has not been repeated; see `open-items.md` #23.
- **`BASE_GOLD = 0.4`**, calibrated so the ceiling's day-0 rung pays a fresh account ~3.5k Gold/hour, in line with Colony and Xeno on their own first day. It was 5 while Gold was prestige-driven, which put a three-hour-old account at ~500× the platform's day-one income.
- **Account age is evaluated at the *start* of the settle window.** The ceiling only rises, so the first instant is the cheapest; settling a 72-hour offline window at its end price would pay three days of kills at a ceiling the account only reached on the last of them.

### ~~Target table~~ and ~~plateau crawl~~ — **superseded**

The previous revision of this section held a prestige-indexed target table (p≈11 → ~235M/hr at month 3, p≈16 → ~0.71B/hr at month 6, a crawl from `GOLD_PRESTIGE_CAP` ≈ 17 at +2%/prestige). It is gone because the prestige→calendar mapping it depended on (§9, step 1) was measured and **does not exist** — see §3a. Nothing in it survives except the principle it served: Hero Quest's Gold lives on the platform's scale, not its own.

## 3a. The Tenure Ceiling — **new 2026-08-18**

`scripts/lib/economy-stages.ts` and `test/economy/cross-game.spec.ts` cite this section.

### Why account age

§9 assigned the balance script the job of deriving a prestige→calendar mapping so the prestige column of the target table could be pinned to calendar anchors. Measured on the campaign walk at the time, **no such mapping exists**: a party of Commons cleared four prestige loops in under three hours and then spent 29 days on the fifth, while a strong roster cleared six in the same three hours. Prestige count tracks accumulated *power*, not elapsed *time*, so whatever value sits at `PRESTIGE_GOLD_FACTOR[5]`, one account reaches it in two hours and another in six weeks. *(The loop has since been slowed to about a week — `open-items.md` #22 — but the argument does not depend on the speed: prestige count still varies with roster strength.)*

Wall-clock account age is the one measure that cannot be front-loaded, farmed or lost. The alternatives each fail:

- **Progression** is circular — the ceiling exists *because* progression is front-loaded.
- **Time since the run began** resets every prestige, which punishes the loop the game is built around.
- **Settled playtime** is capped by `offlineCapHours`, so a once-a-day player banks 8 of every 24 hours forever — an engagement tax on an idle game that rewards leaving the tab open.

Because the ceiling is a `min`, a dormant account is not a hole: six months of age buys a high ceiling, but a Stage 1 hero's progression factor is still ~1. **Waiting cannot skip the game.**

Account age is `hq_state.created_at` (written once at row creation, never updated — which also keeps it clear of the timestamp compare-and-swap trap) to `last_settled_at`, in days.

### The table is generated, not chosen

```
GOLD_TENURE_DAYS    = [0, 0.14, 0.25, 0.5, 1.03, 1.23, 3, 3.93, 5.84, 11.62, 15.84, 34.35, 41.97, 81.91, 145.09, 229.47]
GOLD_TENURE_CEILING = [17.24, 37.18, 46.43, 74.17, 200.2, 262.8, 1082, 1887, 3360, 8624, 13320, 38680, 53350, 130400, 206300, 342200]
```

> **Regenerated 2026-09-16 at the real kill rate — every rung is 12× what it was** (`open-items.md` #23). The divisor used to be `BASE_GOLD × 3600 / MIN_SECONDS_PER_KILL`, i.e. 7,200 kills/hour — the throughput *floor*, treated as the typical case. The campaign walk kills at 523–620/hour depending on party size, so the table described an account killing twelve times faster than the game produces and every "Hero Quest pays 0.85× platform" claim was that much too optimistic. The divisor is now `GOLD_REFERENCE_KILLS_PER_HOUR = 600`, measured.

- **Each ceiling entry** is the geometric mean of Colony and Xeno income (uninvested and invested, both games) at that day, divided by `BASE_GOLD × GOLD_REFERENCE_KILLS_PER_HOUR`. Geometrically interpolated between rungs, because the platform economies grow geometrically. **Emit it, never hand-edit it: `bun run balance:compare --emit-hq-ceiling` prints the table.**
- **The rung days sit on every Colony habitat and Xeno tier boundary**, where the platform curve bends. Evenly spaced rungs sagged up to 22% below the curve; landing on the bends holds it to ~1.5% (worst case 0.989× at day 0.17).
- **`GOLD_PLATFORM_DISCOUNT = 0.85`** is applied on the way out rather than baked in, so the table stays literally "what Colony and Xeno pay" and the deliberate discount is one visible number. Parity is the wrong target: an invested roster spends most of its time with the ceiling binding rather than progression, so the ceiling is effectively what the economy pays, and a game idling at exactly the platform rate would be the platform's best idle game.
- **`GOLD_TENURE_CRAWL = 1.0005`/day past the last rung** (+20%/year, ~5.5× over a decade) — the tenure analogue of the old plateau crawl.

⚠ **Regenerate the table from `scripts/lib/economy-stages.ts` whenever Colony or Xeno is retuned.** It is downstream of those economies by construction. `bun scripts/economy-compare.ts` and `test/economy/cross-game.spec.ts` are the staleness guard: they compare a keeping-pace Hero Quest account against the platform at equal age and fail if the ratio drifts more than 5% off 0.85.

### What it pays

At the throughput floor, before any Gold% stack (`bun run balance:hero-quest --table=tenure`):

| Account age | Hero Quest ceiling Gold/hr | Platform Gold/hr |
|---|---|---|
| day 0 | 3.5K | 4.2K |
| day 1 | 38.6K | 45.4K |
| day 7 | 828K | 975K |
| day 30 | 6.1M | 7.2M |
| day 90 | 28.2M | 33.2M |
| day 180 | 51.9M | 61.0M |
| day 365 | 74.7M | 87.9M |

This is a **ceiling**, reached only by an account whose progression factor has outrun it. How long progression takes to catch the ceiling is a function of prestige: at mid-run (World 5 Stage 5) the progression factor overtakes the ceiling from day 1 at P0–P1, day 3 at P2, day 8 at P3, day 27 at P4, day 88 at P5, ~4.8 years at P6, and never within ten years from P7 onward (`--table=gold-curve`).

⚠ **At the current week-long loop, the ceiling does not bind early on.** A P0 account's progression factor tops out at `1.017^99 ≈ 5.3`, i.e. at most ~15K Gold/hour before Gold% — against ~975K/hour on the platform at day 7. The campaign sim's party of three earned 311,851 Gold across its first 10½ days. Open, not reconciled: `open-items.md` #23.

---

## 4. The Second Axis — Throughput Floor

Per-kill bounding alone doesn't bound Gold/hour: `secondsPerKill = enemyEHP / partyDPS` approaches zero whenever DPS outruns the enemy curve (which is the entire designed "steamroll after prestige" feel). Fix:

```
secondsPerKill = max(MIN_SECONDS_PER_KILL, enemyEHP / partyDPS)
```

- **`MIN_SECONDS_PER_KILL = 0.5s`** (tuned) — diegetically a spawn-pacing floor, which the battle scene needs anyway (nothing sane renders 1,000 kills/sec), and which the settle math applies identically so live and offline agree.
- With both axes capped, max Gold/hour is **provably bounded by construction**: `BASE_GOLD × goldTenureCeiling(horizon) × (3600 / MIN_SECONDS_PER_KILL) × maxGold%Stack × maxBattleSpeed`. It takes no position — the progression factor is unbounded, so the ceiling is the bound — but it does take a **date**, because the tenure crawl never goes flat. `GOLD_BOUND_HORIZON_DAYS = 3650` (ten years) is the one the specs use. **At that horizon, after the 2026-09-16 regeneration: 4.63B/hr with no stack, 74.1B/hr at a ×4 stack under ×4 Battle Speed** — 12× the figures this line used to quote (385.8M and 6.17B), and ~13,500× headroom under the column rather than ~162,000×.
- **The floor is now the abuse bound rather than the description of play.** Since the ceiling is generated at 600 kills/hour and `MIN_SECONDS_PER_KILL` still allows 7,200, the worst case an account can reach is **12× platform income** — the old calibration did not disappear, it moved from describing the typical case to bounding the extreme. ⚠ **Battle Speed multiplies straight through this**, and there is no second ceiling underneath it.

---

## 5. Gold%-Stacking — Bounded Base Makes This Cheap

With the base curve bounded, the uncapped-stack problem from the earlier analysis mostly dissolves: an uncapped % multiplier on a plateaued base shifts the plateau, it can't restore exponential growth. Resolution:

- **No hard cap needed** (unlike Offline Efficiency's 100% ceiling) — instead, the target table above is defined *inclusive* of a typical ~×1.5–2 realized stack, and effect magnitudes across Skills (Apprentice's Ledger family), Artifacts (Fortune), and the prestige-shop Gold% line are tuned so a maximal dedicated stack lands around **×3, ~×5 absolute worst case**. The balance script (§9) verifies the worst-case stack against the §4 bound.
- The existing project principle "keep Gold-granting bonuses small" gets its first quantitative meaning here.

---

## 6. Burst Effects — Denominate in Earn-Time, Not Flat Gold

Every flat-Gold-granting effect (Coin Toss, Prospector's Instinct, Lucky Dig, Windfall, King's Ransom's Gold line) should grant **a duration of current income, not a fixed amount**:

```
burstGold = MINUTES_OF_INCOME × currentTargetGoldPerHour / 60
```

e.g. Coin Toss ≈ 0.5–2 minutes' worth, Windfall ≈ 5–10 minutes' worth (rarity-scaled). This makes every burst automatically correctly-sized at every point on the curve forever — no per-stage tuning, no early-game irrelevance, no late-game exploit — and it inherits the curve's boundedness for free. Recommend adopting as a blanket rule for all current and future Gold-granting effects.

---

## 7. Critical Catch #1 — The 1,000,000-Gold Seal Price Breaks

> ⚠ **Calibration stale since §3a (2026-08-18) — the ladder's shape stands, its numbers do not.** Every income figure below (48M/day at month 1, ~5.7B/day at month 3, ~17B/day at month 6) comes from the superseded calendar anchors. The keeping-pace ceiling now pays roughly 147M/day at day 30, 677M/day at day 90 and 1.25B/day at day 180 — one to two orders of magnitude less at the back end — so the "complete one gacha's roster in ~6 months" target behind `SEAL_LADDER_GROWTH` no longer holds at these rates. Not re-derived; tracked in `open-items.md` #23.
>
> The 2026-09-16 ceiling regeneration left these keeping-pace figures **numerically unchanged** — the table went up 12× and the rate it is stated at came down 12× — but they now describe the kill rate the game actually produces instead of the throughput floor, so they are true rather than optimistic. What #23 measured on top of that is worse for the ladder than "stale": a real prestige-0 account is nowhere near keeping pace, earns ~29.6K Gold/day, and needs **33.8 days for the ladder's first 1,000,000-Gold Seal**. Re-deriving the growth rates is therefore blocked on #23.3 (the progression half), not parallel to it.

The locked flat price (1M Gold per extra Seal, `gacha-shared-system.md` §4) collides fatally with the target curve:

- At the **3-month anchor** (235M/hr), one Seal costs **~15 seconds** of farming.
- At the **6-month anchor**, income buys **~28,000 Seals per day** — pulls stop being a resource at all; the entire gacha economy (~50,240 pulls to max a gacha, 1,066 dupes to max an item, the whole Essence/crafting layer) is trivialized wholesale by month 4–5.

This wasn't visible before because Gold's earn rate was undefined; with a real curve it's arithmetic. The fix must also satisfy two constraints you set:

1. **New players should be able to join and play quickly** — no wall in front of the game itself.
2. **Veteran platform players must not pay higher prices for the same content** — pricing must not discriminate by who you are.

Those two constraints jointly kill *both* obvious pricing shapes. **Prestige-scaled pricing** (the earlier §7 proposal) fails a subtler version of #2: a Hero Quest veteran at prestige 16 pays ~700× what a newcomer pays for the identical Seal — progression itself becomes the price hike. **Wealth-scaled pricing** fails #2 directly. And **keeping the flat 1M** fails on its own: it also creates a mirror-image problem for constraint #2's beneficiaries — a Xeno-end platform veteran arriving with billions banked can buy tens of thousands of Seals on day one, blasting the gacha to level ~9 and skipping the game's entire progression arc. That's not a reward for veterancy, it's the game failing to exist for exactly the platform's most engaged users.

### The fix: a daily escalating ladder, split per gacha, calibrated to a 6-month completion target

**Design goal, set explicitly:** a player who dedicates their Gold income entirely to buying one gacha's Seals should be able to fully complete that gacha's roster — every item at 5★/Lv10, not just owned — in roughly 6 months. This is a stronger, more concrete target than the original "convert banked surplus into pulls" framing, and it drives everything below.

**Step 1 — what "fully complete a roster" actually costs in pulls.** Not previously computed anywhere in this project (the ~50,240 figure elsewhere is pulls to level the *gacha's drop table* to 10, a different and much smaller quantity). Simulated pull-by-pull through the real leveling curve (§2/§3 of `gacha-shared-system.md`) through to every item hitting its full 1,066-dupe max (§6 there), assuming uniform item selection within a rarity:

| Gacha | Roster | Pulls to 100% completion |
|---|---|---|
| Champions (Guild) | 48 items, 8/rarity | **~317,000** |
| Artifacts (Dig-site) | 48 items, 8/rarity | **~317,000** (identical structure to Champions) |
| Skills (Training Grounds) | 36 items, 6/rarity | **~244,000** |
| **Gear (The Forge)** | 36 items, 6/rarity | **~244,000** (identical structure to Skills — 6 per rarity, so the Mythic bottleneck splits the same 6 ways) |

Mythic is the bottleneck in every trial, by a wide margin: at level-10 rates, Mythic's 3.0% splits 8 ways (Champions/Artifacts) or 6 ways (Skills), so a *specific* Mythic item lands roughly once every 270–320 pulls — getting all of them to 1,066 copies each dominates the timeline; every other rarity finishes en route unnoticed.

**Step 2 — split the ladder per gacha, not pooled.** Each of the four gachas gets its **own independent daily counter and price ladder** — buying your 5th Champion Seal today is priced off *only* today's Champion purchases, completely independent of how many Skill or Artifact Seals you've also bought today. This reverses the earlier pooled decision: pooling was right for a conservative, minor-supplement ladder, but a ladder sized to actually complete a specific roster has to be sized to that roster, and Champions/Artifacts (317k target) and Skills (244k target) need different growth rates to hit the same 6-month mark.

> **Repriced 2026-10-04, the user's call: `SEAL_LADDER_GROWTH = 1.2` for all four gachas**, set by feel rather than derived. Platform Gold income had moved far past this doc's figures (the keeping-pace rate now outearns every other source), so the near-flat rates below no longer meant anything; income is to be rebalanced later (`open-items.md` #23). At 1.2 a day's 10-pulls cost ~21M, ~107M, ~554M, ~2.9B and ~14.7B for the first five (~18.3B for all five), per gacha. **This reverses the Step 2 goal below:** Gold-bought Seals are a few extra 10-pulls a day, not the primary path to completing a roster. The derivation is kept as the record of what the old rates were for.

```
sealGoldCost(gacha, k) = SEAL_BASE_COST × SEAL_LADDER_GROWTH[gacha]^(k-1)
    k = Seals of THIS gacha already Gold-purchased today (independent per gacha)
    SEAL_BASE_COST = 1_000_000 (the locked floor, unchanged)
    SEAL_LADDER_GROWTH[champion]  = 1.0007
    SEAL_LADDER_GROWTH[artifact]  = 1.0007   (same roster size/target as Champions)
    SEAL_LADDER_GROWTH[skill]     = 1.0011   (smaller roster, smaller target, can afford to be a touch steeper)
    SEAL_LADDER_GROWTH[gear]      = 1.0011   (identical roster shape to Skills — 36 items, 6/rarity,
                                              ~244,000 pulls to complete; same rate follows directly)
    resets daily, same cadence as the free daily Seal grants
```

These growth rates are dramatically gentler than the earlier pooled 2.0 — expected, since 2.0 was calibrated to make Gold-buying a token supplement (~172 years to full completion); making it the *primary* path to completing one gacha in 6 months instead necessarily means near-flat pricing at real income scale. Calibration is a first-pass estimate, same as everything numeric in this project — it interpolates the §3 target table's calendar checkpoints and will get refined once `scripts/hero-quest-balance.ts` (§9) can simulate the real prestige→calendar mapping directly.

**What hitting 6 months actually costs the player, worth being upfront about:** it requires spending close to 100% of daily income on that one gacha's Seals for most of the window, not a comfortable side purchase:

| Milestone | Daily income | Sustainable Champion/Artifact Seals per day | % of income spent |
|---|---|---|---|
| Month 1 | ~48M | 40 | ~98% |
| Month 3 (Colony-end) | ~5.7B | 579 | ~99.9% |
| Month 6 (0.71B/hr target) | ~17B | 3,569 | ~99.9% |

A direct consequence: **this 6-month figure is per gacha, not for all four at once.** Each ladder alone demands essentially the full income stream at month 6+, so funding all three simultaneously would need ~3× the income the target curve provides — a player chasing full completion across all three gachas via Gold realistically takes closer to **~18 months** (sequential 6-month pushes, or a 3-way income split that stretches each proportionally). Worth keeping in mind if "6 months" was meant as a completionist milestone rather than a per-gacha one.

### The reopened splurge — accepted

A ladder this gentle inevitably lets a large *banked* balance (as opposed to earned income) buy a meaningfully bigger head start than the earlier steep ladder allowed — this is an unavoidable trade-off of the same lever, not a separate bug: a curve gentle enough for earned income to complete a roster in 6 months is also gentle enough for banked wealth to buy a real chunk of it on day one.

| Banked Gold | One-day splurge (Champions/Artifacts ladder) | % of the 317,000-pull roster |
|---|---|---|
| 1B | 758 Seals | 0.2% |
| 10B | 2,971 Seals | 0.9% |
| 100B | 6,091 Seals | 1.9% |
| 1T | 9,364 Seals | 3.0% |

Spreading a static balance across multiple daily resets doesn't meaningfully extend this — the within-day escalation still consumes nearly all of a large one-time balance on its first day, leaving little for subsequent days. So the ceiling holds at roughly 3% of a roster even for an absurdly large one-time Gold injection (e.g. a cross-game platform veteran's existing balance) — a real, bigger head start than the old ladder's ~16-seal splurge, but nowhere near a skipped game.

**Explicitly accepted, not mitigated.** The alternative — decoupling the price curve from a calendar-elapsed-time lifetime cap instead of a resettable daily one, so no amount of banked wealth can ever exceed what elapsed calendar time allows — was considered and would close this gap entirely while still hitting the 6-month target for earned income. It's noted here as the fallback if the splurge ever proves to feel bad in practice, but the simpler daily-reset ladder above is what's locked.

Three further properties preserved from the original design:

- **Still the Gold sink, and a stronger one.** A player pursuing completion burns effectively their entire income for months — this closes the "Gold only piles up" flag more thoroughly than the original pooled ladder did.
- **Still price-neutral by wealth or progression.** The price at rung `k` is identical for every player regardless of who they are — only *how many rungs deep* today's purchases go varies, and that's driven by today's income, not identity.
- **Platform-native shape, unchanged.** Daily-reset economics already exist elsewhere on polynux (Miner's daily lootbox); implementation is still one counter + date column per gacha, claim-then-reward like everything else — now three counters instead of one.

**Interaction with other Seal-earn sources — unchanged, still clean.** The ladder counter tracks only *Gold-purchased* Seals per gacha; the milestone/achievement grants and daily free-Seal grant already locked in `economy-and-currencies.md` §5 are untouched and don't advance or interact with any of the three counters. This matters given Seals are planned to be earnable elsewhere in-game too — any future earn path stays free of the ladder by the same rule: **the ladder is a Gold-conversion throttle, not a Seal-possession throttle.**

Cross-doc edits to `gacha-shared-system.md` §4 and `economy-and-currencies.md` §2/§5: **applied** (see §11).

## 8. Critical Catch #2 — The Gambler's Strike Family Inverts

The Skills doc's ¹-flagged family (Gambler's Strike → Treasure Hunter's Gambit → Fortune's Gambit → King's Ransom) deals damage scaled off banked Gold, flagged there as a future *trivializes-combat* risk needing √/log dampening. **The bounded curve flips the problem to the opposite failure:** Gold now plateaus (~10¹²–10¹³ realistic standing balances) while enemy stats grow exponentially forever — so any damage scaled off Gold, dampened or not, **decays toward zero relevance** at high prestige instead of exploding. The family goes from landmine to dead content.

Proposed redesign preserving the flavor: scale off the Hero's **PWR** (like every other damage skill) **modulated by relative wealth**, e.g. `damage = PWR × abilityMultiplier × wealthFactor(bankedGold / targetGoldPerHour(p))` — "how many hours of income are you sitting on" — bounded modulation (say ×0.5–×2.0) on a stat that does keep pace with enemies. Keeps the gambler fantasy (hoard Gold, hit harder; spend it down, hit softer), works at every prestige, exploits nothing. Adopted in `skills-gacha.md` §4 footnote ¹ — applied.

---

## 9. Calibration — How the Curve Meets the Calendar — **revised**

The original plan here was to model a prestige→calendar mapping and fit a prestige-indexed factor table to it. Step 1 was carried out and showed the mapping does not exist (§3a), so the calendar is now the curve's input rather than something it is fitted to. What calibration means now:

1. **The ceiling is regenerated, not fitted.** `GOLD_TENURE_CEILING` is derived from Colony's and Xeno's live constants via `scripts/lib/economy-stages.ts`. Regenerate it after any retune of either game; the cross-game spec catches it when someone forgets.
2. **`GOLD_STEP_BASE` is the one Hero Quest dial**, and it trades how early an account reaches the ceiling against how much falling behind on power costs. ⚠ Measured 2026-09-16 (`open-items.md` #23), it is **not** currently reaching the ceiling at all: the campaign walk is progression-bound end to end and earns 0.07% of platform. Raising it now has room it did not have before the regeneration — the walk saturates at 138.8M rather than 11.57M — but the value has not been moved, pending the #23.3 decision. Measure it with the campaign walk (which runs on its own clock, so the ceiling is visible there) and `scripts/economy-compare.ts`. Re-run after any change to run pacing — it is calibrated against how fast the loop turns, and the loop has since slowed (`open-items.md` #23).
3. **`GOLD_PLATFORM_DISCOUNT` is a design number**, not a measurement. Move it to change how Hero Quest sits against the platform.
4. **Asserted in the specs:** worst-case Gold/hour (max stack × max Battle Speed × throughput floor, at the ten-year horizon) and the max offline collect clear the column ceiling by ~13,500× and **≥2 orders of magnitude** respectively. ⚠ **The collect assertion was ≥3 orders until 2026-09-16** — regenerating the ceiling 12× came straight out of that margin, taking the largest single collect from ~4.4e11 to ~5.3e12 against a ~1e15 column, so 187 consecutive worst-case collects fill it instead of 2,250. Recorded in `open-items.md` #23 rather than reconciled quietly; `test/hero-quest/settle.spec.ts` asserts the two-order figure and says why.

---

## 10. Dial Status — all locked

1. ~~**6-month anchor: 60% of Xeno's perfect-play ceiling (~0.71B/hr realized).**~~ **Replaced (§3a): 0.85× the platform's income at equal account age.**
2. ~~**Plateau: +2%/prestige crawl.**~~ **Replaced (§3a): +20%/year tenure crawl past day 229.**
3. **Seal pricing: the daily ladder (§7), split per gacha** — shape locked; ⚠ calibration stale since §3a. `SEAL_LADDER_GROWTH[champion] = SEAL_LADDER_GROWTH[artifact] = 1.0007`, `SEAL_LADDER_GROWTH[skill] = SEAL_LADDER_GROWTH[gear] = 1.0011`, calibrated so pure Gold-buying completes one gacha's full roster (317k/317k/244k/244k pulls respectively) in ~6 months. The reopened banked-wealth splurge (~3% of a roster max, from an extreme one-time balance) is explicitly accepted rather than mitigated.

## 11. Cross-Doc Edits — **ALL APPLIED**

| Doc | Section | Edit | Status |
|---|---|---|---|
| `tech-architecture.md` | §9.1 | Mark resolved → reference this doc; Void Shards to text/Decimal storage. | ✅ Applied |
| `gacha-shared-system.md` | §4 | Replace flat 1M with the per-gacha daily ladder (now four counters incl. Forge). | ✅ Applied |
| `economy-and-currencies.md` | §2, §5 | Same Seal-price change; Gold sink note updated. | ✅ Applied |
| `skills-gacha.md` | §4 footnote ¹ | Wealth-factor redesign replacing √/log dampening. | ✅ Applied |
| `artifacts-dig-site-gacha.md` / `skills-gacha.md` | Gold-effect entries | Earn-time denomination for flat-Gold bursts. | ✅ Applied |
| `core-progression-and-prestige.md` | §4 | Cite this doc for Gold; Void Shards named. | ✅ Applied |
| `idle-mechanics.md` | §4 | `MIN_SECONDS_PER_KILL` floor added to `secondsPerKill`. | ✅ Applied |

## Implementation Note

**Revised 2026-08-18:** Gold per kill is `BASE_GOLD × min(GOLD_STEP_BASE^n, tenureCeiling(accountAge))`, the ceiling generated from Colony and Xeno at 0.85× (§3, §3a). The prestige factor table, `GOLD_PRESTIGE_CAP`, the plateau crawl and the calendar anchors below are superseded; the rest of this note stands, with the Seal ladder's numbers flagged stale (§7).

Every decision in this doc is locked: Gold decoupled from `enemyMultiplier` onto a ~~capped, table-driven prestige curve calibrated to calendar anchors (Colony-end at 3 months, 60%-of-Xeno at 6, full Xeno ceiling as an earned post-cap crawl milestone ~10–14 months)~~ shallow curve bounded by an account-age ceiling; the `MIN_SECONDS_PER_KILL` throughput floor making Gold/hour bounded by construction; earn-time denomination for all Gold bursts; four independent per-gacha daily-ladder Seal prices calibrated to a ~6-month full-roster-completion target (`SEAL_LADDER_GROWTH[champion/artifact] = 1.0007`, `SEAL_LADDER_GROWTH[skill/gear] = 1.0011`), with the resulting banked-wealth splurge (~3% of a roster max) explicitly accepted (Critical Catch #1); and the Gambler's-family wealth-factor redesign (Critical Catch #2). Everything numeric beyond the growth constants — the factor table values, `GOLD_PRESTIGE_CAP`, `MIN_SECONDS_PER_KILL`, burst minute-values, and the growth constants themselves — remains a balance-script-calibrated starting point per project convention (§9). Cross-doc edits (§11) have all been applied across the seven affected docs. `SEAL_LADDER_GROWTH[gear] = 1.0011` is now set too (§7), matching Skills' identical 36-item/6-per-rarity roster shape.
