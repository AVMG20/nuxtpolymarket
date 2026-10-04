# Idle Mechanics

Status: **Locked** — core structure and all formulas confirmed across this conversation. Only the two upgrade-cost `BASE_COST` anchor values remain unset, pending your tuning pass.

## Structure recap
- Covers three things: (1) which systems are idle-native vs. tied to active play, (2) how auto-battle behaves while the app is open, including the Gem-purchased Battle Speed option, and (3) how offline progress is calculated and capped.
- Builds directly on `core-progression-and-prestige.md` (enemy curve, kill-count/boss structure, prestige currency, the offline-efficiency% shop line) and `classes-and-combat.md` §3 (flat-cooldown skills, all auto-cast) — this doc doesn't redefine either, just plugs into them.

---

## 1. Idle vs. Active — System Allocation

Mostly already decided by other locked docs; stated here as the single reference point:

**Revised — the table collapsed.** With Manual mode deleted from the game entirely (`classes-and-combat.md` §3, `tech-architecture.md` §9.2), there is no longer an idle-vs-active split to allocate: **every combat system in the game is fully idle-native.**

| System | Idle-native or active-lever? |
|---|---|
| Champion abilities | Always auto-cast — fully idle-native |
| Training Grounds Passives | Always-on, no cooldown, no button (`skills-gacha.md` §3) — fully idle-native |
| Training Grounds Actives | Auto-fire the instant their cooldown completes — fully idle-native |
| Artifacts | Passive-only, party-wide, zero interaction required (`artifacts-dig-site-gacha.md` §1) — fully idle-native |
| Hero class-tree skills | Auto-fire the instant their cooldown completes — fully idle-native |

**What's left as genuinely "active" play is not in-combat input at all.** The player's real levers are being present for boss/super-boss gates (Section 5 — the one hard presence gate; bosses engage automatically while the page is visible, §2), raid engagement (`raid-system.md` §5), Arena attacks (`arena.md`), and every out-of-combat decision: loadout, formation, equip, trait rolls, prestige-shop spending, class selection. Combat itself never waits on a tap.

**Consequence for offline calc, now trivial:** there is no Auto/Manual divergence to reconcile, so offline and live resolve skills identically by construction. The earlier "offline always resolves as if Auto" special case is retired — it no longer describes anything, because Auto is the only mode.

---

## 2. Auto-Battle — Online Behavior

- The core loop is always-auto the instant the app is open: the party fights continuously, kill count accrues automatically, and the run advances stage-to-stage (1→2→3→4, 6→7→8→9) the moment each stage's kill-count threshold is hit — no tap required to move forward through wave stages.
- **Boss stages (5 and 10) — revised 2026-08-18.** A boss **engages automatically while the page is visible**, on first arrival *and* on every re-arrival after a failure sends the run back to farm Stage 4 or 9. This replaces the earlier rule that a failed fight "does not auto-retry" and waits for the player to re-initiate (`core-progression-and-prestige.md` §2, `open-items.md` #25). Presence is still required — it is read from `document.visibilityState` instead of a button press — so a hidden tab, a closed app and an offline settle never engage a boss. The player can still engage manually rather than wait.
  - **The client waits one kill before firing** (`AUTO_ENGAGE_GRACE_KILLS = 1`, clamped to 1–10s). The screen projects kills fractionally so bars move smoothly, while the server floors to whole kills, so the screen reaches a gate up to one kill before the server agrees. An engage sent in that window is rejected with a 400; the client swallows it and retries after 3s rather than showing an error.
  - **Never re-fights a cleared run.** A won World 10 super boss leaves the run parked on the same gate with `runCleared` set; auto-engage holds there, since firing would re-fight the final boss forever and every win pays Milestone Seals.
  - An automatically engaged replay closes itself 2.5s after its outcome; a manually engaged one waits for the player.
- **Skill casting is not a separate axis anymore.** Every skill on every unit auto-fires on cooldown (`classes-and-combat.md` §3), so stage/kill-count auto-advancement and skill firing are simply the same always-on behavior. Nothing about the party's DPS contribution depends on the player being present or attentive.

---

## 3. Battle Speed — Gem-Purchased Temporary Multiplier

**Naming note:** referred to here as **Battle Speed** rather than "speed-up," specifically to avoid collision with the SPD stat (`classes-and-combat.md` §2–3) — the two are unrelated mechanics that happen to share a word. SPD is a per-unit stat that shortens *cooldown length*; Battle Speed is a session-wide clock multiplier. Flagging the naming choice in case you'd rather call it something else in-game.

- **Purchased in fixed-duration blocks with Gems** (the platform's premium currency, `core-progression-and-prestige.md` §4). The purchased window is **pure wall-clock** — it runs down in real time whether the app is open or not, so there's no ambiguity about "was it still running when I closed the app": it was.
- **Revised — Battle Speed does apply offline.** (Supersedes this doc's earlier "live-session only, offline always runs at 1x" rule.) The multiplier applies to **wave-stage kill accrual** (Stages 1–4 and 6–9) both online and offline: the settle function multiplies the boosted portion of elapsed time before offline efficiency is applied. See Section 4 for exactly where it enters the formula, and `tech-architecture.md` §4b for the settle-side mechanics.
- **Scope, stated in full:**

| Context | Battle Speed applies? | What it does |
|---|---|---|
| Wave stages 1–4, 6–9, **online** | Yes | Dilates the live combat clock — genuinely more kills/Gold/XP per real minute |
| Wave stages 1–4, 6–9, **offline** | **Yes (new)** | Multiplies boosted elapsed seconds in the settle, before offline efficiency |
| Boss / super boss (Stages 5, 10) | Yes, live only | Playback pacing only — the sim is a fixed 30 sim-seconds either way, so the outcome and rewards are unchanged. Bosses never engage offline (Section 5), so no offline case exists |
| Raids | Yes, live only | Same as bosses — playback pacing only (`raid-system.md` §5) |
| **Arena** | **No — the one exclusion** | Asynchronous PvP against another player's stored data; a paid multiplier touching it reads as an advantage even though it wouldn't change the deterministic outcome (`tech-architecture.md` §4d) |

- **The two mechanisms are genuinely different, worth separating in the UI.** Wave-grinding is *"earn more"* — real economic throughput. Boss/raid fights are *"watch it faster"* — zero reward change, purely your own real-world time saved. Same currency, materially different value proposition.
- **Offline interaction with efficiency, worth surfacing to the player.** Speed and efficiency multiply, so a boost spent offline is never *worse* than no boost — but at the starting `BASE_OFFLINE_EFFICIENCY = 50%` it realizes only half what the same purchase would deliver live (a 2x boost offline at 50% efficiency nets ×1.0, versus ×2.0 live). That gap closes to zero as the Offline Efficiency shop track climbs to its 100% cap. Intentional early-game nudge toward being present for a purchased boost — a soft tax, not a hard block — and worth a UI hint rather than leaving it a silent trap.
- **No free tier — locked.** Every speed tier is Gem-only; there's no baseline free multiplier.
- **Tiers: 2x, 3x, 5x**, each purchasable at **4 durations: 30 min, 1 hour, 2 hours, 4 hours** — 12 total purchasable options. **10x was cut on 2026-10-04, the user's call:** at 10x the largest offline collect (`gold-economy.md` §9.4) cleared the balance column by 1.87 orders of magnitude against the specs' 2; at 5x it clears by ~2.2. Refreshable/re-purchasable before the current block lapses.
- **Mechanically a uniform time-dilation on the combat clock**, not a reward multiplier layered on top: cooldowns, animations, and the flat 30-second boss/super-boss timer (`core-progression-and-prestige.md` §2) all tick at the accelerated rate together — e.g. under 5x, that 30-second boss timer resolves in 6 real seconds. One clock, one multiplier, applied everywhere at once, so there's no separate bookkeeping for "which things does speed-up affect."
- **Stacks multiplicatively with SPD**, not redundantly — SPD shortens a skill's cooldown length itself; Battle Speed then compresses how fast that already-shortened timer plays out in real time. Distinct layers, same direction of effect.
- Net player-facing result is more kills/Gold/XP per real-world minute, but that's a side effect of time compression, not an added economy bonus — Battle Speed doesn't touch Gold%/XP%/offline-efficiency% math anywhere.

### Pricing formula (anchor: 2x/30min = 250 Gems)

**Repriced 2026-10-04, the user's call:** the anchor moved from 50 to 250 Gems, so the cheapest block now costs what the old 10x/30min did and the scale continues from there. Both axes keep their rules; only the anchor moved. Built as `BATTLE_SPEED_ANCHOR_GEMS`.

Two axes, two different scaling rules:

- **Speed axis — strictly proportional ("even") to the raw multiplier**, for a fixed duration:
```
price(speed, 30min) = 250 × (speed / 2)
```
- **Duration axis — each step up is double the time at a 5% discount off the naive double**, compounding from the 30-min anchor for that speed tier:
```
price(speed, nextDuration) = price(speed, currentDuration) × 2 × 0.95
                            = price(speed, currentDuration) × 1.9
```

| Speed | 30 min | 1 hour | 2 hours | 4 hours |
|---|---|---|---|---|
| 2x | 250 | 475 | 905 | 1,715 |
| 3x | 375 | 715 | 1,355 | 2,570 |
| 5x | 625 | 1,190 | 2,255 | 4,285 |

All values rounded to the nearest 5 Gems — locked. Each cell is computed from the unrounded formula chain (speed-axis proportionality, then successive ×1.9 down the duration axis) and only rounded at the point of display, so rounding doesn't compound tier-to-tier.

---

## 4. Offline Progress — Rate-Based Formula

**Snapshot calculation, not iterative:** offline progress is computed once, in a single lump sum, using the party's stats and current stage/prestige exactly as they were the moment the player left. It does not re-simulate incremental leveling or gear changes mid-projection — there's nothing to recompute mid-flight since nothing about the party changes while no one's playing. This is the practical reason a rate formula (rather than a full tick-by-tick replay) is the right fit: the outcome is fully determined by the snapshot, so there's no RNG or evolving state offline time actually needs to resolve.

### Formula

```
partyEffectiveDPS = Σ memberDPS, across all fielded party members (Hero + active Champions)
```
Each member's effective DPS uses its own already-locked damage formula (`classes-and-combat.md` §7 for the Hero, `champions-guild-gacha.md` §2 for Champions), averaged over crit chance/damage rather than rolled per-hit — this doc doesn't redefine that math, just treats it as a known input.

```
enemyEffectiveHP(stage) = BASE_ENEMY_HP × enemyHpMultiplier(prestige, world, stage) × [elite or boss modifier if applicable]
secondsPerKill(stage) = max(MIN_SECONDS_PER_KILL, enemyEffectiveHP(stage) / partyEffectiveDPS)
```
Enemy HP rides `b^(n × ENEMY_HP_STEP_EXPONENT)` rather than the plain `enemyMultiplier` — HP is the one enemy stat matched against a product (DPS) rather than a single stat, so it needs its own exponent. Both, and the elite/boss modifiers, are exactly `core-progression-and-prestige.md` §1. **`MIN_SECONDS_PER_KILL` is a new floor** (starting point ~0.5s, tunable): once party DPS outruns the enemy curve badly enough that kills would resolve faster than this floor, the rate clamps rather than continuing toward zero. Two independent reasons this exists, not just one: it's a sane pacing floor for the live Pixi battle scene (nothing sane renders 1,000+ kills/second), and — the reason it's load-bearing rather than cosmetic — it's the second half of what makes Gold/hour provably bounded. `gold-economy.md` (Locked) bounds the *value* half of the equation (per-kill Gold follows its own capped curve, decoupled from `enemyMultiplier`); this floor bounds the *rate* half (kills/second can't run away even as DPS scales indefinitely against the fixed enemy ceiling within a prestige tier). Both halves are needed together — a bounded per-kill value times an unbounded kill rate is still unbounded income. Live and offline use the identical `secondsPerKill` function, so the floor applies consistently either way.

```
MAX_OFFLINE_CAP_LEVEL   = 32                                             // 8 + 2×32 = 72 hours, the fixed ceiling
offlineCapHours(level)  = OFFLINE_CAP_BASE_HOURS + 2 × level             // level = 0..32
offlineSecondsCapped    = min(realElapsedSeconds, offlineCapHours(level) × 3600)

// Battle Speed (new — Section 3): the boosted portion of the capped window is
// dilated BEFORE efficiency is applied. `boostOverlapSeconds` is the intersection
// of the capped offline window with the active [.., speedBoostExpiresAt] window.
boostedSeconds          = boostOverlapSeconds × speedBoostMultiplier
                        + (offlineSecondsCapped - boostOverlapSeconds)

offlineEfficiency       = min(1.0, BASE_OFFLINE_EFFICIENCY + 0.10 × shopLevel + Σ(other stacking sources))
effectiveOfflineSeconds = boostedSeconds × offlineEfficiency

// Revised: a settle is lossless. The part-kill a window cannot bank carries into the next one.
killBudget              = effectiveOfflineSeconds / secondsPerKill(currentStage) + killFractionCarriedIn
offlineKillsAccrued     = floor(killBudget)
killFractionCarriedOut  = killBudget − offlineKillsAccrued        // always [0, 1), persisted as hq_state.kill_fraction
```

**Why the carry exists (2026-08-25).** Every read is a settle — polling, mutations, reloads — and flooring each window to whole kills lost up to one kill per settle. A player refreshing faster than `secondsPerKill` earned **nothing at all**, because every window floored to zero. The remainder is carried **in kills, not seconds**: seconds are only worth kills at the rate that measured them, so a player parked at a wall would bank hours of unspent time and cash it all the moment an upgrade cut the rate. A fraction of a kill is a fraction of a kill at any rate and can never exceed one. A stored value outside `[0, 1)` is treated as corruption and dropped rather than clamped, since a clamped `1` would hand out a free kill on every read. A window that earns nothing keeps the carry rather than zeroing it.

The same window applies the **Gold tenure ceiling** at the account age of the window's *start* (`gold-economy.md` §3a) — the ceiling only rises, so a 72-hour offline window is paid at the price the account had when it went away.

**Ordering matters and is deliberate:** the offline *cap* clamps real elapsed time first (a boost can't extend how much offline time counts), then the boost dilates the covered portion, then efficiency taxes the result. This is what produces the "a 2x boost spent offline at 50% efficiency nets ×1.0" number in Section 3.

- **`BASE_OFFLINE_EFFICIENCY = 50%`** — **locked.** Prestige-shop upgrade line: **+10% per purchase level, hard-capped at 100%** — 5 total levels (50→60→70→80→90→100). Once maxed, the shop line alone delivers full live-rate offline progress.
- **`OFFLINE_CAP_BASE_HOURS = 8`** — **locked.** Prestige-shop upgrade line: **+2 hours per purchase level, hard-capped at 72 hours total** — **32 levels** (8, 10, 12, ... 70, 72). No longer uncapped; this now fits the same "fixed-level-count shop track" shape as every other prestige-shop lever, just with far more levels than the 3-level Champion/Skill/Artifact slot tracks.

### Upgrade cost formulas

Two different curve shapes, matched to how many levels each track has:

- **Few-level tracks (doubling cost per level)** — applies to the **Offline Efficiency** line (5 levels), and fits the same shape already implied for the Champion/Skill/Artifact slot tracks (3 levels each) if you want one unified rule across all short prestige-shop tracks:
```
cost(level) = BASE_COST × 2^(level-1)          // level = 1..5 for Offline Efficiency
```
So Offline Efficiency's 5 levels cost `BASE_COST × [1, 2, 4, 8, 16]` — each level exactly double the last.

- **Long track (smoother exponential)** — the **Offline Cap** line has far more levels (32) than a flat doubling curve could reasonably support, so it uses a gentler base:
```
cost(level) = round(BASE_COST × 1.72^(level-1))     // level = 1..32
```
Illustrative growth shape (multiplier on `BASE_COST`, not a final currency amount — no anchor value given yet, unlike Battle Speed's Gem anchor):

| Level | Hours unlocked | Cost multiplier (×`BASE_COST`) |
|---|---|---|
| 1 | 10 | 1 |
| 4 | 16 | 5 |
| 8 | 24 | 45 |
| 12 | 32 | 390 |
| 16 | 40 | 3,411 |
| 20 | 48 | 29,857 |
| 24 | 56 | 261,269 |
| 28 | 64 | 2,286,153 |
| 32 | 72 | 20,012,145 |

Steep by level 32 on purpose — same spirit as the project's other endgame numbers (e.g. the ~50,240 pulls to take a single gacha's *drop table* to level 10 — not to be confused with the ~244k–317k needed to complete a *roster*, `gold-economy.md` §7 — or the enemy curve's ≈×2,200 per prestige loop): the curve doesn't need to stay reasonable all the way to the cap, it just needs to gate the *last* few levels hard enough that reaching 72 hours is a genuine long-term milestone rather than an early buy.

- **Stacking, confirmed additive:** the prestige-shop offline-efficiency% purchase, **Night Owl** (`artifacts-dig-site-gacha.md` §3, Fortune), and **Tycoon's Vault**/**Emperor's Treasury** (`skills-gacha.md` §4, Legendary/Mythic passives) all add together into one combined `offlineEfficiency` value — same "layered, not siloed" convention already used project-wide for Gold%/XP% stacking.
- **Design intent, confirmed:** the shared 100% ceiling across shop + Night Owl + Tycoon's Vault/Emperor's Treasury is deliberate, not a gap. Early on, before the shop line is maxed, those gacha-sourced bonuses give a cheap way to patch toward full offline efficiency without spending prestige currency. Once the shop line alone reaches 100% on its own, those same Artifact/Skill picks go "dead" for offline-efficiency purposes specifically — which is the intended pivot point: a player at that stage is expected to reallocate those Artifact/Skill slots toward Offense/Tempo (or other non-Fortune picks) instead, since the economy lever no longer needs the help. No further change needed here.

**Out of scope for this doc:** the exact Gold/XP granted *per kill* at a given stage is an economy-tuning question, now resolved in `gold-economy.md` (Locked) — this doc defines the mechanism by which offline (and live) kills convert into whatever those per-kill rates are, via `secondsPerKill` above; that mechanism is what `gold-economy.md`'s `MIN_SECONDS_PER_KILL` and per-kill curve both plug into.

---

## 5. The Boss Wall — Offline Behavior

**Locked: offline calculation never engages a boss.** If accrued offline kills would carry the run past a wave stage's threshold into Stage 5 or Stage 10, the surplus doesn't attempt the boss — it redirects into re-clearing the wave stage immediately before it (Stage 4 or Stage 9) instead, for continued Gold/XP, and keeps looping there for the remainder of the offline duration.

- **If the player was already parked on an unengaged boss stage when they went offline**, the same redirect applies retroactively — offline calc treats the whole absence as if they'd been farming Stage 4 or 9 the entire time, not standing idle at the boss doing nothing.
- **On return, the player lands back at the boss stage** with the fight ready to engage — automatically, a moment after the page is visible again (§2) — exactly as if they'd farmed up to it live. Offline time never resolves the boss on the player's behalf, win or lose.
- This is the same grind-and-retry loop already described in `core-progression-and-prestige.md` §2 ("fall back, farm the previous wave for gold/XP/levels, then attempt the boss again at will") — offline mechanics simply extend that existing loop into unattended time rather than introducing a new one.

**Notable emergent consequence, worth stating outright:** prestige currency is only paid on a full World 10/Stage 10 clear (`core-progression-and-prestige.md` §4), and every world's clear requires passing two boss gates (Stage 5 and Stage 10) that — per this section — can *only* be resolved through active play. **Prestige currency can therefore never be earned purely from offline time.** Only Gold, XP, and kill-count progress up to the next wall accrue unattended. This cleanly reinforces the split implied by this whole session: idle time handles routine farming, while the run's actual defining milestone (prestige) still requires the player to come back and push through.

---

## Implementation Note

Everything above reflects decisions made across this conversation, **plus a later revision pass**: the idle-vs-active system table now collapses to "everything is idle-native" (Manual mode deleted game-wide, `classes-and-combat.md` §3), auto-battle as the default always-on online behavior with boss-retry unchanged from the Progression doc, Battle Speed as a Gem-only (no free tier) wall-clock time-dilation across 4 speed tiers × 4 durations with its pricing formula and Gem costs locked (rounded to nearest 5) — **now applying offline to wave accrual as well as online, with Arena as the sole exclusion** — the rate-based (snapshot, non-iterative) offline formula, and both prestige-shop upgrade lines fully specified: Offline Efficiency (50%→100% in 5 doubling-cost levels) and Offline Cap (8→72 hours in 32 levels on a smoother `1.72^(level-1)` curve) — plus additive offline-efficiency stacking and the boss-skip/redirect-to-prior-wave rule with its prestige-currency consequence.

**Open lever remaining:** the actual `BASE_COST` value for each of the two upgrade-cost formulas — no anchor was given for these (unlike Battle Speed's Gem anchor), so both are pure formula shapes awaiting a starting number during your tuning pass.
