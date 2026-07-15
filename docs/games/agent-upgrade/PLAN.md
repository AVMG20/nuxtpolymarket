# HackOps — Agent Upgrade Artifacts (design draft)

Status: **design only**, nothing implemented. Companion to [`docs/games/hackops-redesign/`](../hackops-redesign/PLAN.md) (shipped). Balance numbers below come from [`balance_sim.py`](balance_sim.py) — edit its CONFIG and re-run to re-tune.

## 1. Problem

Rolling a genuinely great agent means rerolling recruits/trait-rolls until RNG lands high on every trait at once — the odds compound (5 independent uniform rolls on a Phantom), so a "perfect" agent is effectively unreachable. There's no deliberate, farmable path from "the agent I have" to "the max this agent could be."

## 2. Concept: Artifacts

**Artifacts** are consumable items that missions drop. Applying one permanently pushes one of an agent's existing rolled traits closer to (never past) that trait's max. They are not gear (gear stays swappable) — an Artifact is applied once, consumed, and permanently changes the agent.

This turns "get lucky" into "grind the right ops," giving high-tier ops a payoff beyond cash/gems/items, while keeping the power/speed/loot ceilings identical to today (nothing exceeds `AGENT_TRAIT_RANGES[type].max`).

### 2.1 Naming

- Called **Artifacts** (not "Directives").
- One Artifact type per existing `AgentTraitType`, named by trait only — **`Power Artifact`, `Speed Artifact`, `Loot Artifact`, `XP Artifact`, `Gem Chance Artifact`, `Bonus Gems Artifact`, `Power % Artifact`**.
- **Rarity is never in the name.** Rarity (Ghost → Phantom) is a property shown by the usual color/badge, and it *only* controls how much the Artifact adds (§4). A "Power Artifact" is a Power Artifact whether it's Ghost or Phantom; the Phantom one just adds more.

### 2.2 Core rules

1. **One Artifact = one trait.** It amplifies an existing rolled trait; it never adds a trait type the agent didn't roll.
2. **Rarity = magnitude only** (§4). Phantom adds ~10× what Ghost adds.
3. **Applies only to a trait the agent already rolled.** No matching trait → can't apply (sellable instead, §7).
4. **Hard-capped at the trait's real max.** `newValue = min(current + add, AGENT_TRAIT_RANGES[type].max)`. Overshoot is wasted — the UI warns before a wasteful apply and refuses on an already-maxed trait.
5. **Consumed on use, one at a time.** Deliberate, same weight as a Crafting Bench re-roll.
6. **Source: mission drops only** (§5). Not purchasable — grinding ops is the whole point.

## 3. The balance goal (what the sim solves for)

Two properties must both hold, verified by [`balance_sim.py`](balance_sim.py):

1. **Higher/longer ops reach a maxed agent *faster*** than spamming short low-tier ops — even though you can run many more short ops per day. No cheesing max agents on 1-hour ops.
2. **Headline target:** ~**1 week** of daily endgame farming to fully max one agent; ~**6 weeks** for a full team of 6.

The mechanism that makes (1) fall out naturally: **Artifact drops scale with an op's base duration**, not a flat per-op chance. A ~30h Ghost Protocol yields a *cache* of artifacts; a ~2h port scan yields a trickle. Longer ops also bank overnight, so endgame nets more artifacts/day *and* at better rarity — short-op spam can never out-farm it.

Drops key off **base** duration (the op's inherent value), not the sped-up time, so speed builds help only by running more ops/day, never by farming more per op.

## 4. Magnitude table (rarity → how much one Artifact adds)

Anchored on the user's call: a Phantom Power Artifact adds **+10** power (20% of Power's 10–60 gap); a Ghost one adds **+1** (2%) — a 10× ghost→phantom ratio. Every other trait uses the same gap-fractions (geometric steps 2% → 20%), so one application is worth a comparable *share* of any trait's range.

| Artifact (trait) | trait range | Ghost | Operative | Specialist | Elite | Phantom |
|---|---|---|---|---|---|---|
| Power        | 10–60  | +1    | +2    | +3    | +6    | +10   |
| Power %      | 5–30%  | +0.5% | +1%   | +2%   | +3%   | +5%   |
| XP Gain      | 5–50%  | +1%   | +2%   | +3%   | +5%   | +9%   |
| Op Speed     | 3–10%  | +0.1% | +0.3% | +0.4% | +0.8% | +1.4% |
| Gem Chance   | 0.5–5% | +0.1% | +0.2% | +0.3% | +0.5% | +0.9% |
| Loot         | 3–6%   | +0.1% | +0.1% | +0.2% | +0.3% | +0.6% |
| Bonus Gems   | 1–3    | +0.05 | +0.1  | +0.15 | +0.25 | +0.4  |

Gap-fractions: Ghost 2.0% · Operative 3.6% · Specialist 6.3% · Elite 11.2% · Phantom 20.0%.

Notes:
- Values are **applied and stored as exact decimals**, and clamped at the trait max; the UI rounds for display. Power/XP are where rarity bites hardest; small-gap traits (Loot, Bonus Gems) have marginal low-rarity artifacts by design — they stack over many applications.
- To fully close a *floor* roll: ~5 Phantom applications of the right type per trait (or ~50 Ghost). That per-trait grind × the random-type spread is what produces the multi-week timeline in §6.

## 5. Drop mechanics

Two independent things per op, both keyed off the op's **base** duration and tier:

**How many drop:** `expected artifacts per op = 0.25 × op_base_hours` (the tuned rate). So:

| Tier | example op | base hrs | ~artifacts/op |
|---|---|---|---|
| Beginner  | Port Scan (2h) → Corp Breach (4h)      | 2–4   | 0.5 – 1.0 |
| Early-mid | Bank Skim (5h) → Crypto Heist (7h)     | 5–7   | 1.2 – 1.8 |
| Mid       | Telecom Tap (9h) → Gov Heist (12h)     | 9–12  | 2.2 – 3.0 |
| Late-mid  | AI Theft (14h) → Black Site (18h)      | 14–18 | 3.5 – 4.5 |
| Endgame   | NSA Breach (22h) → **Ghost Protocol (30h)** | 22–30 | 5.5 – 7.5 |

A drop is realised as N whole artifacts (a "cache"); since inventory stacks by (trait, rarity) they don't flood the UI. Fits the existing crate-opening reveal moment.

**Project Zero (56h) drops nothing** — reaching it means you're already finished, so the farming ceiling is Ghost Protocol. Ghost Protocol itself is reachable by better agents+gear (not by artifacts), so artifacts never gate their own farm.

**Which rarity:** a per-tier weighted table — the user's sliding 3-rarity 60/30/10 window that shifts up with tier:

| Tier | rarity table |
|---|---|
| Beginner / Early-mid | Ghost 60 · Operative 30 · Specialist 10 |
| Mid                  | Operative 60 · Specialist 30 · Elite 10 |
| Late-mid             | Specialist 60 · Elite 30 · Phantom 10 |
| Endgame              | Elite 60 · Phantom 40 |

**Which trait type:** uniform-random across the 7 types on each drop (not tied to the op or squad). So you accumulate a mixed stockpile and spend it across your roster.

## 6. Simulated balance (from `balance_sim.py`)

Days to max a **rock-bottom Phantom agent** (5 floor-rolled traits), farming each tier every day, at rate 0.25 and the tables above:

| Farming tier | ~artifacts/op | max Power | max Power+Power% | max ALL 5 traits |
|---|---|---|---|---|
| Beginner  | 0.7 | 5.7 wk | 6.0 wk | **6.9 wk** |
| Early-mid | 1.5 | 4.7 wk | 4.9 wk | **5.7 wk** |
| Mid       | 2.6 | 2.6 wk | 2.8 wk | **3.3 wk** |
| Late-mid  | 3.9 | 10 d   | 11.5 d | **2.1 wk** |
| Endgame   | 7.4 | 4.7 d  | 5.3 d  | **6.7 d** |

- **Endgame fully maxes one agent in ~1 week; ~6 weeks for a team of 6.** ✓ both targets.
- **Higher tier is strictly faster** (6.9 wk → 6.7 d down the ladder). ✓ no short-op cheese.
- Beginner farming still *works* (6.9 wk) — a valid slow fallback if you can't reach endgame, but ~6× slower, so higher ops are always the reward.
- The `10× ghost→phantom` magnitude is what makes a lucky Phantom drop worth ~10 Ghost drops, so long ops (which roll Elite/Phantom) dominate the grind exactly as intended.

Re-tune by editing `balance_sim.py` CONFIG (magnitude fractions, rarity tables, drop rate, ops/day) — `AUTOSOLVE` back-solves the drop rate to hit a chosen days-to-max target.

## 7. Where Artifacts are applied

New **Upgrade** view hanging off the agent (sub-page of the Agents tab / an in-page panel swap, not a new top-level tab, not a modal — the flow has real depth: filtered inventory → live preview → confirm, mirroring the shipped loadout flow). Behaviour:
1. Pick an Artifact from inventory (stacked by trait + rarity).
2. Target trait's range bar shows current → projected as a brighter overlay fill, clamped at max (see mockup).
3. No matching trait → disabled with a reason; already-maxed → disabled "Already maxed".
4. Confirm → consume, update trait, play the existing stamp/purchase SFX.

## 8. Open questions

- **Unusable (wrong-type) Artifacts:** sell for a flat rarity-based gem/cash price (mirrors `itemSellPrice`)? Recommended, so inventory never holds dead weight. (A gem-cost "reforge type" was considered and set aside to avoid a new mechanic.)
- **Inventory:** a separate stacked bucket keyed by (trait, rarity), no per-item slot cost — they accumulate fast.
- **Precision/display:** small-gap traits store exact decimals; confirm rounding rules per trait so a "+0.5%" apply reads cleanly.
- **Cache presentation:** an endgame op dropping ~7 artifacts — one combined reveal, or fold into the existing post-op collect screen.

## 9. Mockup

[`mockups/agent-upgrade.html`](mockups/agent-upgrade.html) — standalone, reuses the shipped HackOps design system. Shows the Upgrade flow: agent's rolled traits as range bars (min left, bar middle, max right), the stacked Artifact inventory, and the current→projected preview overlay on apply. [`mockups/artifact-drop.html`](mockups/artifact-drop.html) extends the existing mission collect reveal with a normal gear reward plus a five-artifact reward block beneath the success stamp and RELAY bark. (Mockup still to be renamed Directive→Artifact — tracking in this pass.)
