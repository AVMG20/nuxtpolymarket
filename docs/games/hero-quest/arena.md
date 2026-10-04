# The Arena (PvP)

Status: **Locked** — decisions confirmed, ready to reference for implementation planning. Resolves idea backlog item 5. Resolves the open GPN/matchmaking-fairness nuance flagged in `global-power-number.md` §5 and `tech-architecture.md` §4d.

## Structure recap

- **Asynchronous PvP.** The attacker fights live with whatever party is currently live (optionally swapped in first via the existing Loadout system, `loadouts.md`). The defender is never live — they're always resolved by `fight.ts` against their own stored `defenseLoadout`.
- `defenseLoadout` is a single dedicated snapshot per player (not one of the general Loadout slots) capturing all five swappable components — Party/Formation/Skills/Artifacts/Gear — mirroring `loadouts.md` §1 exactly.
- Matchmaking uses a new **Defense GPN** — the existing GPN formula computed off `defenseLoadout` instead of live state — resolving the fairness gap the earlier docs flagged.
- Opponent selection: a refreshable list of 3 candidates within a GPN band of the attacker's live GPN. Refresh costs 10 Gems. If fewer than 3 real candidates exist in-band, empty slots are filled with a **Training Dummy** — a guaranteed win, so a player isolated at either end of the GPN spectrum is never denied a fair shot, and a top player can't farm real opponents just because the dummy exists.
- Attempts: 5 free per day, do not bank. Extra attempts purchasable, starting at 10 Gems and doubling per purchase, resetting daily. An attempt is spent on every attack, win or lose.
- Rating: asymmetric Elo (`K_ATTACK ≠ K_DEFEND`), floor-clamped at 0, everyone resets to 1000 at the start of each season.
- Rewards: a new currency, **Arena Medals**. Only the attacker ever earns Medals — always something on a loss, more on a win, scaled by the same expected-score math the rating update uses. The defender never earns anything from being attacked.
- Arena Shop: Medals buy all 4 gacha Seals, all 5 Raid Keys, Gold, and Gems — with **Gems deliberately priced as a bad deal** (Section 6), so Medals→Gems is only ever worth it for a player who wants nothing else in the shop.
- Seasons: 2 weeks. Leaderboard and Rating reset; rewards paid out by final rank (no tiers yet).
- Battle log: last 20 matches (as attacker or defender), opponent, and rating change.
- A separate Arena leaderboard (new — doesn't reuse the GPN/progression leaderboard), ranked by Rating, showing top 50 plus the player's own rank and neighbors.

---

## 1. Attack & Defense Loadouts

**Attack: no separate stored Arena-attack loadout — but an optional preferred Loadout (revised 2026-10-04).** The attacker fights with whatever party is live at the moment they attack. When a saved Loadout is assigned as the Arena's preferred one, it is applied before the attack's fight resolves and reverted on leaving the Arena, exactly as raids do (`loadouts.md` §4); the picker sits on the Arena screen. With none assigned, nothing changes.

**Defense: a single dedicated snapshot, not a Loadout-slot pointer.** `hqState.defenseLoadout` captures all five components, matching `loadouts.md` §1's capture list exactly:

| Component | Source |
|---|---|
| Fielded Party | `champions-guild-gacha.md` §1 |
| Formation | `classes-and-combat.md` §6, `champions-guild-gacha.md` §8 |
| Equipped Skills | `skills-gacha.md` §5–6 |
| Equipped Artifacts | `artifacts-dig-site-gacha.md` §7 |
| Equipped Gear | `gear-equipment.md` §3 |

This corrects the earlier schema note in `tech-architecture.md` §3, which listed only champion/skill/artifact IDs + formation and omitted Gear.

**Editing the defense loadout is free and unlimited**, same convention as every other equip-swap in this project (`loadouts.md` §2). Editing it never touches live state — it's a pure write to the stored snapshot via `arena/defense-set.post.ts`.

**Only one active defense configuration exists per player** — not multiple saved presets. This is a deliberate scope cut versus the general Loadout system's 2–10 slots; nothing in this design needs more than one defense config yet. Revisit if that changes.

**Battle Speed does not apply to Arena fights** — the one exception to it otherwise applying everywhere in this game. Already locked in `tech-architecture.md` §4d/§9.3; not re-litigated here, just cross-referenced since it's a real player-facing rule of this system.

---

## 2. Opponent Selection & Matchmaking

**New: Defense GPN.** Computed with the exact same formula as live GPN (`global-power-number.md` — `partyEffectiveDPS × partyEffectiveEHP`), but evaluated against `defenseLoadout`'s stats instead of live state. Unlike live GPN, it does **not** need recomputing on every settle tick — it's static between edits, so it's recomputed once whenever `defenseLoadout` is saved and stored denormalized (`hqState.defenseGpn`), same indexing approach as live GPN.

**Matchmaking compares the attacker's live GPN against the pool of other players' Defense GPN** — this is the actual fix for the divergence flagged in `global-power-number.md` §5 and `tech-architecture.md` §4d: defenders are now matched on a number that actually reflects what they'll be fought with, not a proxy that could be stale or unrelated.

**Candidate list: 3 opponents, refreshable.** A GPN-band filter (`ARENA_MATCH_BAND_PCT`, tunable) selects eligible defenders around the attacker's live GPN; 3 are drawn at random from that pool. Refreshing the list — pulling 3 new candidates — costs **10 Gems**, unlimited uses. Self is always excluded from the pool.

**Open, not resolved here:** exact band width. Flagged for the tuning/balance pass, same convention as every other unresolved numeric constant in this project.

**Fallback resolved: see Section 2a — Training Dummy fills empty candidate slots** rather than widening the band.

### 2a. Training Dummy Fallback

**Locked: when the GPN-band candidate pool has fewer than 3 eligible real defenders, the remaining slot(s) are filled with a Training Dummy instead of widening the band.** This protects both ends of the GPN spectrum deliberately:

- A player far below everyone else in the band isn't forced into a mismatched fight against someone well above their power level just to fill the list.
- A player far above everyone else (e.g. the current top of the leaderboard) can't be handed real, much-weaker opponents purely because nothing else fits the band — closing off a farming vector that would otherwise let the strongest players punch down for cheap Medals or Rating.

**A Training Dummy fight is a guaranteed win** — the player is never denied a fair outcome just because the matchmaking pool ran dry. Concretely:

- **Medals:** pays `MEDAL_BASE_WIN` flat — no upset bonus, since there's no real opponent rating to compute `expectedAttacker` against. Still strictly better than a loss, consistent with "the player deserves that" for being outside everyone else's range.
- **Rating: unaffected.** A Training Dummy fight never touches Elo in either direction — it isn't a real match, so it can't be farmed for Rating, which would otherwise trivially break the ladder for anyone isolated at the top.
- **Attempts:** still consumes one, same as any other attack (Section 3) — no special exemption.
- **Battle log:** still logged (Section 8), with the opponent shown as "Training Dummy" and a rating change of 0.

**A candidate list can mix real and dummy entries** — dummies fill only the shortfall (e.g. 2 real candidates found + 1 dummy), not the whole list unless zero real candidates are found. Refreshing (10 Gems) re-rolls the same way; if the real pool is still empty, dummies simply reappear.

---

## 3. Attempts

**5 free attempts per day, hard reset — do not bank.** This deliberately breaks from the Raid Key pattern (3/day banking to 21): Arena attempts are competitive and time-boxed per season, so there's no reason to reward stockpiling the way Raids reward catching up on a backlog.

**Extra attempts:** purchasable, starting at **10 Gems**, doubling per purchase (10 → 20 → 40 → …), resetting to base cost at the daily reset. This reuses the same daily-escalating-ladder shape already established for Gold-purchased Seals (`gold-economy.md` §7) — just priced in Gems instead of Gold, and reset by the attempt-day clock instead of the Seal-ladder clock.

**An attempt is consumed on every attack, win or lose** — unlike Raid Keys, which are win-gated. This is intentional: Arena is competitive PvP against another player's setup, not a progression gate, so a loss is a real outcome that should cost the same as a win, not a free retry.

Tracked via `hqState.arenaAttemptsUsedToday` + `arenaExtraAttemptsPurchasedToday` + `arenaAttemptDate`, mirroring the existing `sealLadderPurchasedToday`/`sealLadderDate` reset pattern (`tech-architecture.md` §3).

---

## 4. Rating System — Asymmetric Elo

**Locked: asymmetric, with separate constants for attacker and defender**, rather than a standard zero-sum Elo trade. The attacker is the active agent choosing to fight; the defender is passive and AI-resolved — so their rating shouldn't necessarily move by the same magnitude for the same outcome.

```
expectedAttacker = 1 / (1 + 10^((defenderRating - attackerRating) / 400))
expectedDefender = 1 - expectedAttacker

attackerRating' = attackerRating + K_ATTACK × (actualScore - expectedAttacker)
defenderRating' = defenderRating + K_DEFEND × ((1 - actualScore) - expectedDefender)
```

Where `actualScore = 1` if the attacker wins, `0` if they lose. `K_ATTACK` and `K_DEFEND` are independent tunable constants — not required to be equal, and not expected to be.

**Rating floor: clamped at 0.** No ceiling.

**Rating resets to 1000 for every player at the start of each season** (Section 7).

**Worth flagging explicitly, matching this project's convention of naming deliberate asymmetries rather than treating them as bugs:** matchmaking (Section 2) runs entirely on GPN, while the leaderboard (Section 9) runs entirely on Rating. These are two independent axes on purpose — GPN keeps fights roughly fair in raw power terms, Rating tracks actual match outcomes over time. A player can have a high GPN and a mediocre Rating (or vice versa), and that's intended, not a mismatch to reconcile.

---

## 5. Rewards — Arena Medals

**New currency: Arena Medals.** Only the **attacker** ever earns Medals from a match — the defender earns nothing, regardless of outcome, since they never opted into that specific fight in the moment.

**The attacker always earns something, more on a win than a loss**, scaled by the same expected-score math the rating update already computes (no second formula needed):

```
medalsOnWin  = MEDAL_BASE_WIN  × (1 + MEDAL_UPSET_BONUS × (1 - expectedAttacker))
medalsOnLoss = MEDAL_BASE_LOSS   // flat, does not scale with opponent
```

Beating a higher-rated opponent pays more (the upset bonus scales with how unlikely the win was per `expectedAttacker`); beating someone well below you still pays the base amount — attacking is never penalized, just rewarded more for punching up. A loss always pays the flat `MEDAL_BASE_LOSS` floor. `MEDAL_BASE_WIN`, `MEDAL_BASE_LOSS`, and `MEDAL_UPSET_BONUS` are tunable constants, placeholder values pending the balance pass — same convention as every other numeric constant in this project.

---

## 6. Arena Shop

**Priced entirely in Arena Medals.** Sells:

| Category | Items | Pricing intent |
|---|---|---|
| Gacha Seals (all 4) | Guild Seals, Skill Seals, Excavation Seals, Forge Seals | Fair — the shop's primary purpose |
| Raid Keys (all 5) | Guild Keys, Skill Keys, Excavation Keys, Forge Keys, Trait Keys | Fair |
| Gold | Gold | Fair, denominated in earn-time per `gold-economy.md` §6 |
| **Gems** | Gems | **Deliberately unfavorable — see below** |

**Confirmed: static per-item prices, no daily ladder, unlimited purchases per item.** Unlike the extra-attempts purchase (Section 3), the Shop itself doesn't need a resetting ladder.

### Gems are priced as a deliberate last resort — locked

**Gems stay in the shop, but at an intentionally bad rate.** The design goal is that converting Medals into Gems should only ever make sense for a player who genuinely wants nothing else on the list — a completionist with every Seal and Key they can use, sitting on surplus Medals. It should never read as an efficient Medals sink.

**Why the guardrail is needed:** `economy-and-currencies.md` §4 defines Gems as *"a trickle, not a parallel earn loop"* — scarce by design, sourced only from milestones and events. But Medals accrue on **every** Arena attack, win or lose, at minimum 5/day forever (Section 3, 5). An attractively-priced Medals→Gems conversion would quietly turn Arena into exactly the parallel Gem earn loop the economy doc rules out — and Gems fund Battle Speed, Loadout slots, Trait save slots, and Arena's own refreshes and extra attempts, so inflating them leaks into five systems at once.

**Concrete calibration target** (a real constraint for the balance pass, not just a vibe): a player converting **100% of a typical day's Medals** into Gems should net meaningfully **less than the daily-equivalent Gem value of a single Battle Speed block** — i.e. grinding Arena purely for Gems is a strictly worse use of the time than almost anything else. `ARENA_SHOP_GEM_PRICE` is set from that target once Medal income per day is calibrated, rather than picked in isolation.

**Deliberately *not* solved with a purchase cap.** A hard limit ("only N Gems per season") would work, but it punishes exactly the completionist this exists for. Bad pricing self-limits without ever telling a player *no* — and it keeps the shop's promise that Medals always convert into something, which is the reason Gems were included at all.

Exact prices for everything else = tuning-pass placeholder, same convention as everywhere else.

---

## 7. Seasons

**2 weeks per season.** At season end:
- The Arena leaderboard resets.
- Every player's Rating resets to 1000 for the new season.
- Rewards are handed out based on final rank at the moment of reset (no tiers — confirmed explicitly, rank-only for now).

**Confirmed: Arena Medals persist across both season resets and prestige** — only Rating and leaderboard position reset each season; Medals follow the same "nothing resets on prestige" convention as every other currency in the game (`economy-and-currencies.md` §1). Season-end rank rewards are paid in Medals, since introducing a second reward currency isn't otherwise motivated.

Exact rank-reward table (how much, at which rank cutoffs) is a tuning-pass placeholder.

---

## 8. Battle Log

**A simple per-account list of past matches** — which battles happened, against whom, and the resulting rating change. Covers both directions: matches where the player was the attacker, and matches where they were the target of someone else's attack.

Each entry: opponent name, role (attacker/defender), win/loss, rating change, Medals earned (attacker entries only).

**Capped at the last 20 entries**, oldest dropped as new ones are added.

---

## 9. Leaderboard

**A separate leaderboard from the main GPN/progression leaderboard** (`tech-architecture.md` §1) — this didn't exist before this doc. Ranked by **Rating**, not GPN.

**Display: top 50 global, plus the player's own rank and nearby neighbors** — same pattern as the general leaderboard convention already implied elsewhere in this project.

Resets alongside Rating at the start of every season (Section 7).

---

## Cross-Doc Edits

**All applied** — listed here as a record of what this doc changed elsewhere:

| Doc | Section | Edit needed |
|---|---|---|
| `tech-architecture.md` | §3 | Correct `defenseLoadout` to include `equippedGear` (currently missing). Add: `defenseGpn` (text/Decimal, denormalized, recomputed on `defenseLoadout` save), `arenaRating` (numeric, default 1000, floor 0, indexed for leaderboard reads), `arenaMedals` balance (integer), `arenaAttemptsUsedToday` / `arenaExtraAttemptsPurchasedToday` / `arenaAttemptDate` (daily-ladder pattern, mirrors existing Seal ladder fields), and a `currentSeasonId`/season-start timestamp for the 2-week reset cadence. |
| `tech-architecture.md` | §3 | New `hqArenaLog` table: `(userId, opponentUserId, role ['attacker'|'defender'], won, ratingChange, medalsEarned, isDummy, createdAt)`, capped/pruned to the last 20 rows per user (Section 8). `opponentUserId` nullable for Training Dummy entries (`isDummy = true`), which never populate the defender side of the table since there's no real opponent. |
| `tech-architecture.md` | §5 | New API routes beyond the two already-anticipated stubs (`arena/defense-set.post.ts`, `arena/attack.post.ts`): `arena/candidates.get.ts` (the 3-candidate list, dummy-filled per Section 2a as needed), `arena/refresh-candidates.post.ts` (10 Gems), `arena/buy-attempt.post.ts`, `arena/shop-buy.post.ts`, `arena/log.get.ts`, `arena/leaderboard.get.ts`. All follow the existing claim-then-reward / lock-then-read conventions (`tech-architecture.md` §5). |
| `economy-and-currencies.md` | §1, new section | Register **Arena Medals** as a new currency: source = Arena attacks and Training Dummy wins (Sections 2a, 5), sinks = Arena Shop (Section 6). Confirmed to persist across both prestige and season resets. |
| `global-power-number.md` | §5 | Update the "Arena matchmaking proximity" note — the attack/defense GPN divergence is now resolved via a dedicated Defense GPN (Section 2 of this doc) rather than left open. |

---

## Implementation Note

Locked: asynchronous PvP with no separate stored attack loadout (live party at time of attack, optionally pre-swapped via the existing Loadout system) against a single dedicated `defenseLoadout` snapshot covering all five swappable components including Gear. Matchmaking runs on a new Defense GPN (same formula as live GPN, computed off `defenseLoadout`, denormalized on save) compared against the attacker's live GPN — resolving the fairness gap flagged in `global-power-number.md` §5. Opponent selection is a refreshable 3-candidate list (10 Gems/refresh) within a GPN band (exact width deferred to tuning), with empty slots filled by a guaranteed-win **Training Dummy** (Section 2a) whenever fewer than 3 real candidates exist in-band — protecting players isolated at either end of the GPN spectrum, and specifically closing off a farm-the-weak vector for top players. Dummy fights pay flat base Medals but never move Rating. Attempts are 5/day, non-banking, extra purchasable on a daily-resetting doubling ladder starting at 10 Gems, consumed on every attack (dummy or real) regardless of outcome. Rating is asymmetric Elo (independent `K_ATTACK`/`K_DEFEND`), floor-clamped at 0, reset to 1000 every 2-week season alongside the separate Arena leaderboard (top 50 + neighbors, distinct from the GPN leaderboard). Rewards are a new Medals currency, attacker-only, always nonzero and scaling with upset likelihood via the same expected-score term the rating update uses; defenders never earn anything. Medals spend in a new Arena Shop (all 4 gacha Seals, all 5 Raid Keys, Gold, and **deliberately unfavorably-priced Gems** — calibrated so a full day's Medals convert to less than a single Battle Speed block's worth, keeping Arena from becoming the parallel Gem earn loop `economy-and-currencies.md` §4 rules out) at confirmed static prices, and persist across both season resets and prestige. A 20-entry battle log covers both attacker and defender roles per account, plus dummy fights.

**Open, flagged rather than decided:** exact GPN matchmaking band width (Section 2); exact tunable constants throughout (`K_ATTACK`, `K_DEFEND`, `MEDAL_BASE_WIN`, `MEDAL_BASE_LOSS`, `MEDAL_UPSET_BONUS`, `ARENA_MATCH_BAND_PCT`, `ARENA_SHOP_GEM_PRICE` — the last one carrying an explicit calibration target rather than a free hand, Section 6) — all deferred to the balance-script pass, consistent with every other numeric value in this project. Also worth a future look: whether Arena should get its own per-raid-style "preferred Loadout" auto-apply for attacking (extending `loadouts.md` §4's pattern) — not requested, not designed here, just a natural extension if manual pre-swapping proves tedious in practice.
