# Economy & Currencies

Status: **Locked** — decisions confirmed, ready to reference for implementation planning. Consolidates every currency referenced across `core-progression-and-prestige.md`, `gacha-shared-system.md`, `champions-guild-gacha.md`, `skills-gacha.md`, and `artifacts-dig-site-gacha.md` into one place, and resolves the sourcing gaps those docs left open.

## Structure recap

**The game is entirely free-to-play — nothing anywhere is purchasable with real money.** Every currency, Gems included, is earned exclusively through gameplay.

Currencies split into two tiers:
- **Universal** — Gold and Gems are **platform-wide currencies**, provided by the underlying platform itself rather than built specifically for this game; Void Shards (new — see §3) is a custom currency built for this project. All three exist once, shared across the whole game.
- **Per-gacha, parallel** — each of the **4 gachas** (Gear/Champions/Skills/Artifacts) has its own pull currency and its own crafting currency, both custom to this project, structurally identical across all four but tracked as separate balances.

---

## 1. Full Currency List

| Currency | Type | Scope | Origin | Persists on prestige? |
|---|---|---|---|---|
| **Gold** | Regular | Universal | Platform-wide | Yes |
| **Gems** | Premium *(scarcity, not a paywall — see §4)* | Universal | Platform-wide | Yes |
| **Void Shards** *(named after The Void — the last zone, per current world-naming; confirmed, not a placeholder)* | Prestige-progression | Universal | Custom to this game | Yes (it's the reward *for* prestiging) |
| **Forge Seals** | Pull | Gear gacha | Custom to this game | Yes |
| **Gear Essence** | Crafting | Gear gacha | Custom to this game | Yes |
| **Guild Seals** | Pull | Champions gacha | Custom to this game | Yes |
| **Champion Essence** | Crafting | Champions gacha | Custom to this game | Yes |
| **Skill Seals** | Pull | Skills gacha | Custom to this game | Yes |
| **Skill Essence** | Crafting | Skills gacha | Custom to this game | Yes |
| **Excavation Seals** | Pull | Artifacts gacha | Custom to this game | Yes |
| **Artifact Essence** | Crafting | Artifacts gacha | Custom to this game | Yes |
| **Trait Gems** | Roll | Traits (not a gacha — see §8) | Custom to this game | Yes |
| **Guild Keys** | Entry | Guild Raid | Custom to this game | Yes |
| **Skill Keys** | Entry | Training Grounds Raid | Custom to this game | Yes |
| **Excavation Keys** | Entry | Dig-site Raid | Custom to this game | Yes |
| **Forge Keys** | Entry | Forge Raid | Custom to this game | Yes |
| **Trait Keys** | Entry | Trait Raid | Custom to this game | Yes |
| **Arena Medals** | Reward | Arena | Custom to this game | Yes (also persists across season resets — the only currency in the game with a season concept at all) |

Nothing resets on prestige (`core-progression-and-prestige.md` §3) — consistent with every gacha collection and Gold already being locked as persistent; Void Shards and Gems follow the same rule since neither is a run-scoped resource.

---

## 2. Gold

**Platform-wide currency** (see Structure recap) — free-to-play throughout; no real-money purchase path exists for Gold or anything else in the game.

**Sources:**
- **Idle stage farming (primary)** — accrues continuously from kill-count progress (`core-progression-and-prestige.md` §2), same loop as XP. **Per-kill value follows its own bounded curve, deliberately decoupled from the exponential `enemyMultiplier`** (which governs enemy stats and, unbounded, everything Decimal-typed) — see `gold-economy.md` (Locked) for the full formula, the account-age tenure ceiling that bounds it (§3a — replaced the earlier calendar-calibrated prestige targets), and why a shared, per-user, non-Decimal-typed platform balance (`numeric(19,4)`) can't ride the same curve as combat stats.
- **Arena Shop (secondary, new)** — Gold is buyable with Arena Medals (`arena.md` §6). Should be denominated in earn-time per `gold-economy.md` §6 rather than a flat amount, so it stays correctly sized at every point on the curve like every other Gold grant in the project.

**Sinks (locked):**
- **Extra pull-currency purchases via a daily escalating ladder, independent per gacha** — the first extra unit of Guild Seals, Skill Seals, or Excavation Seals bought with Gold on a given day costs 1,000,000 Gold, with each subsequent purchase of *that same currency* that day costing more than the last; Guild/Skill/Excavation each track their own daily counter rather than sharing one. Growth rates are calibrated so a player dedicating essentially all Gold income to one gacha can fully complete that gacha's roster in roughly 6 months — a real, if large, banked-wealth splurge (up to ~3% of a roster from an extreme one-time balance) is an accepted consequence of that calibration rather than something separately guarded against. Full mechanics and numbers are in `gold-economy.md` §7 (Locked).

**Resolved (was an open note in earlier drafts):** Gold's sink problem — "a currency that only earns and rarely spends will just pile up" — is closed by the ladder above. Because the ladder's rungs escalate exponentially, a player converting Gold into Seals at their sustainable daily depth spends a substantial fraction of their income (well over half, at typical late-game rates — see `gold-economy.md` §7's table), so the sink scales with income rather than remaining a flat, easily-outgrown 1M tax. Further sink candidates (direct stage-skip/instant-complete costs, cosmetic purchases, a Gold-cost path for slot expansions alongside Void Shards) remain open future-pass ideas, but are no longer load-bearing the way they were before the ladder existed.

---

## 3. Void Shards (new custom currency)

**Named after The Void** — the last zone in the world rotation, giving the prestige payoff a direct lore tie to "reaching the end and resetting stronger." **Cross-doc note (open, and correctly so):** `core-progression-and-prestige.md` §5 ("World Themes") doesn't yet name any specific worlds — the 10 world identities are the remaining greenfield design pass. **The Void is pre-committed as World 10's name** by this doc, and the world pass must honour it or rename this currency; §5 carries a matching note so the constraint isn't lost.

Resolves the "which actual currency backs the prestige currency" question `core-progression-and-prestige.md` §4 left open. **Void Shards is a new, dedicated currency** — not Gems, not Gold.

**Source:** fixed payout on a **full clear of World 10 / Stage 10 only** — no partial credit for an incomplete run. Formula (unchanged, already locked):
```
prestigeCurrencyEarned(prestigeCompleted) = BASE_CURRENCY × CURRENCY_GROWTH^prestigeCompleted
```
Starting point: `BASE_CURRENCY = 100`, `CURRENCY_GROWTH = 2`.

**Sinks (locked, recapped from the progression doc's shop list):**
- Idle/offline efficiency%
- Slot expansions — Champion, Skill, and Artifact slots, each 2→5 via 3 purchase levels apiece (9 total purchase levels across the three systems)
- Kill-count reduction% / boss-timer extension
- Raid Key daily-grant-rate — 5 independent tracks, one per raid

**Cross-doc status: applied.** `core-progression-and-prestige.md` §4 previously read *"which actual currency ... implements it is still open"*; it now names Void Shards and points here. No outstanding edit.

---

## 4. Gems

**Platform-wide currency** (see Structure recap) — **no real-money purchase path exists for Gems or anything else in the game.** "Premium" describes Gems' *scarcity relative to Gold*, not a paywall: it's the same free-to-play earn model, just calibrated to be much slower to accumulate.

**Source (revised — was "architecture deferred," now resolved):** achievements and events, **plus a deliberately-throttled Arena Shop conversion**. Gems trickle in from major one-time milestones (e.g. first prestige, first Mythic pull, first full World-10 clear) rather than routine play. Kept deliberately rare/small so Gems stay meaningfully scarce next to Gold's continuous stage-farming drip — this is a trickle, not a parallel earn loop like Void Shards. **Concrete example, new:** Holiday Events (`holiday-events.md`, Locked) is the first actual instance of the "events" half of this source — a small flat Gem amount as part of each real-world holiday's claimable gift bundle.

**The Arena caveat, stated explicitly:** the Arena Shop (`arena.md` §6) sells Gems for Arena Medals — and Medals accrue on **every** Arena attack, win or lose, at minimum 5/day forever. On its face that's exactly the parallel earn loop this section rules out. It's permitted only because **Gems are deliberately priced as a bad deal there**, calibrated so a full day's Medals converts to less than a single Battle Speed block's worth. The intent is that Medals→Gems is a last resort for a completionist who wants nothing else in the shop, never an efficient Gem tap. If that pricing is ever loosened, this section's "scarce by design" claim stops being true — the two are load-bearing on each other.

**Sinks (now four locked, up from zero):**
- **Battle Speed** — Gem-purchased time-dilation blocks, 250–4,285 Gems per block, 2x–5x (repriced 2026-10-04) (`idle-mechanics.md` §3)
- **Loadout slot expansion** — 2→10 slots, doubling cost across 8 levels (`loadouts.md` §3); the first designed instance of "convenience features," priced in Gems because Loadout slots add no combat power
- **Trait save-slot expansion** — 1→4 slots at **250 / 750 / 1250**, a flat +500/level step rather than Loadouts' doubling curve (`traits.md` §6)
- **Arena** — candidate-list refresh at 10 Gems (unlimited) and extra Arena attempts on a daily-resetting doubling ladder from 10 Gems (`arena.md` §2–3)

Remaining undecided candidates: buying Gold/Seals directly outside Arena, cosmetics, other convenience features (instant-finish timers).

**Worth a balance-pass look now that both sides exist:** Gems went from having no locked sink to four, two of which (Arena refresh, extra attempts) are *unbounded* per day. Against a source that's still an intentionally slow trickle, that's a real squeeze worth modelling rather than assuming.

---

## 5. Pull Currencies — Forge / Guild / Skill / Excavation Seals

Structurally identical across all 4 gachas (`gacha-shared-system.md` §4):
- 1 pull = 1 Seal; 10-pull = 9 Seals (10% discount), still counts as 10 toward that gacha's leveling.
- Extra Seals purchasable via a per-gacha daily escalating Gold ladder, independent counter per Seal type (§2 above; full mechanics in `gold-economy.md` §7) — no longer a flat 1,000,000 Gold/unit, and no longer pooled across gachas.

**New — earn sources through normal play (resolves the gap the other docs left open):**

1. **Milestone/achievement rewards** — tied to core-progression milestones (World clears, boss/super boss kills, Prestige completions) rather than to each gacha's own internal progress. Since these milestones aren't gacha-specific, a milestone grants **all four Seal types simultaneously**, matching the project's existing pattern of the gachas advancing in lockstep (shared rarity table, shared leveling curve, shared dupe formula). Exact milestone list and batch sizes are deferred to the World/enemy design pass, same tune-later convention as everything else — starting shape: small batches (e.g. a few Seals of each type) per World clear, larger batches per Prestige completion.
2. ~~**Time-gated grants**~~ — **removed 2026-09-16, see `open-items.md` #29.** This was a small free grant of each Seal type on a fixed real-time interval (built as one 10-pull's worth every 24 hours, banking up to 7 days). It is gone: free Seals now come only from milestones (source 1) and raid clears (source 3), and the free 10-pull entitlement (`FREE_PULLS_PER_DAY`, session-1 playtest finding 3) is the only thing a clock hands out. A drip that paid whether or not the player ever opened the gacha undercut source 1 and the Gold ladder at once.
3. **Raid clears** — per `raid-system.md` (Locked). Unlike the two sources above, this one is **not** shared across all four types: each of the game's four gacha-paired raids pays out only its own paired gacha's Seal currency on a successful clear — Guild Raid → Guild Seals, Training Grounds Raid → Skill Seals, Dig-site Raid → Excavation Seals, Forge Raid → Forge Seals. Entry to each raid is gated separately by that raid's own dedicated **Key** currency (§9, new), not by Seals — a fresh win or a quick-clear of the frontier level spends a Key, a loss costs nothing. See `raid-system.md` §3 for the full attempt-economy rules, including the `rampaging_boss` exception (Trait Raid) where a Key is spent on every entry unconditionally rather than only on a win.

**Design intent:** deliberately *not* stage-clear drops (unlike Gold/XP, which flow continuously from kill-count progress). Keeping Seals earned in discrete milestone/raid-clear chunks — rather than a continuous drip alongside Gold and XP — preserves "buy extra Seals with Gold" (§2) as a genuine choice (converting banked Gold surplus into more pulls) rather than a redundant option sitting next to an already-flowing Seal tap.

---

## 6. Crafting Currencies — Gear / Champion / Skill / Artifact Essence

Fully inherited from `gacha-shared-system.md` §6, no deviation:

- **Source:** automatic conversion of post-max (5★/Lv10) duplicates — no other source.
- **Sink:** Crafting — spending Essence for a full RNG bypass on a specific chosen item, at the 5×-per-rarity value/cost table already locked (1 → 5 → 25 → 125 → 625 → 3,125 cost to craft, Common through Mythic).

No changes here; recapped for completeness since this is the consolidated economy reference.

---

## 7. Cross-Cutting Design Principles (already established, restated here for one-stop reference)

- **Gold-granting effects (from Skills passives, Artifact Fortune effects, etc.) should stay conservative.** Gold is persistent and compounds forever across prestige, unlike run-scoped resources — already locked in both `skills-gacha.md` and `artifacts-dig-site-gacha.md`.
- **All four gacha systems stay parallel wherever possible** — same rarity tiers, same leveling curve, same dupe formula, and the same Seal-earning structure (milestones + time gates + paired raid) rather than diverging per-gacha. The one deliberate divergence: **Gear has no slot-unlock track** (all 6 Forge slots from account start), where Champions/Skills/Artifacts each run the 2→5/3-level progression.

---

## 8. Trait Gems (new custom currency)

Resolves the currency question left open in `traits.md` (idea backlog item 8). **Trait Gems is a new, dedicated currency** — not Gems (the platform-wide premium currency), not Void Shards, not a per-gacha Seal. Despite the name's similarity to (platform) Gems, the two are unrelated balances; naming collision flagged here explicitly to avoid confusion at implementation time.

**Source:** **Trait Raid** (`raid-system.md`, Locked) — a standalone `rampaging_boss`-type raid, confirmed separate from item 3's (Passive Skill Tree) raid, which is currently left out of the roster entirely. Trait Raid's fight mechanic, level-result formula, and reward-batch formula are fully specified in that doc; entry is gated by **Trait Keys** (§9, new), spent on every attempt unconditionally since `rampaging_boss` raids have no win state to gate on.

**Sinks (locked, from `traits.md` §2 and §6):**
- **Roll action** — rerolls every currently-unlocked trait slot at once. Cost scales with how many slots are *locked* (protected), not how many actually reroll: `5 + locked × 5` Trait Gems, ranging from 5 (nothing locked, full 5-slot reroll) to 30 (all 5 locked — a no-op the client should prevent rather than let the player pay for).
- **Trait save-slot store/load** — unlike the Loadout system's free & unlimited save/apply, storing to or loading from a Trait save slot costs a flat **100 Trait Gems per press**, same price either direction, no repeat-use discount.

Not a sink: expanding the *number* of Trait save slots (1→4) — that's priced in platform Gems instead (**250 / 750 / 1250**, a flat +500/level step rather than this project's usual doubling shape), same convenience-feature logic as Loadout slot expansion (§4 above), since save-slot count adds no combat power on its own.

---

## 9. Entry Currencies — Guild / Skill / Excavation / Forge / Trait Keys (new custom currency)

Resolves the "entry currency" concept introduced in `raid-system.md` §3 (Locked). Each of the 5 raids has its own dedicated **Key**, gating entry to that raid's fights — distinct from that raid's *reward* currency (Seals or Trait Gems). Five separate balances, fully independent per raid, same non-sharing pattern as Seals.

**Source:** daily grant, **3 Keys/day per raid**, banking up to a week's worth (21) at the current rate — the time-gated-grant shape the Seal daily grant used to share (§5.2, since removed; Keys keep the pattern because a raid attempt is a session, not a currency balance). A prestige-shop upgrade raises the daily grant rate per raid (`core-progression-and-prestige.md` §4 cross-doc note), with the bank cap scaling to match. Keys are a first-class currency, so beyond this daily trickle they're also a valid reward payout for *other* systems later (events, milestones, etc.) — flagged as a future source, not designed here.

**Sinks (locked, from `raid-system.md` §3–4):**
- **Guild Raid, Dig-site Raid, Forge Raid** (`solo_boss`/`reinforced_boss`/`boss_gauntlet` fight types; what a win is across the Forge's three bosses is open, `open-items.md` #32) — a Key is spent only on a **win**: a fresh clear or a quick-clear of the frontier level. A loss costs nothing; retry freely.
- **Training Grounds Raid** (`training_dummy` since 2026-09-28) — **open, `open-items.md` #31.** A damage race against a dummy that can't die has no win to gate on, so its Skill Key spend is undecided.
- **Trait Raid** (`rampaging_boss` fight type) — a Key is spent on **every single entry, unconditionally**, since there's no win state to gate consumption on.

---

## 10. Arena Medals (new custom currency)

Resolves the reward-currency question left open in `arena.md` (idea backlog item 5). **Arena Medals is a new, dedicated currency** — not Gems, not Void Shards, not a per-gacha Seal or per-raid Key.

**Source:** Arena attacks (`arena.md` §5) — the attacker earns Medals on every attack, win or lose, scaled by an Elo expected-score term so beating a higher-rated opponent pays more. The **defender never earns Medals**, regardless of outcome — they didn't opt into that specific fight. Training Dummy fights (`arena.md` §2a, fallback when the matchmaking pool has fewer than 3 real candidates) also pay flat Medals on their guaranteed win, same as any other source.

**Sinks (locked, from `arena.md` §6):** the Arena Shop — the first currency in this project to buy across *every* other custom currency at once: all 4 gacha Seals (Guild/Skill/Excavation/Forge), all 5 Raid Keys, plus the two platform currencies Gold and (at a high price) Gems. Static per-item pricing, no daily ladder, unlimited purchases.

**Persistence — the one currency in this game with a season concept at all:** Medals persist across both prestige *and* the Arena's 2-week season reset (`arena.md` §7). Only Rating and leaderboard position reset each season; the reward currency itself is untouched, consistent with this project's "nothing resets on prestige" convention extended to the new season axis.

---

## Implementation Note

New in this doc: the full currency list consolidated in one place (§1), Gold's sink gap flagged rather than silently left (§2), **Void Shards** locked as a new dedicated currency answering the progression doc's open question (§3), Gold and Gems clarified as platform-wide currencies with no real-money purchase path anywhere in the game — Gems are "premium" only in the sense of being far scarcer/slower to earn than Gold, not paywalled (§2, §4), a concrete earn structure for the pull currencies via milestones + time-gated grants (§5), **Trait Gems** locked as a fifth new dedicated currency (§8), sourced from Trait Raid and spent on the Roll action and trait save-slot store/load, distinct from (and easily confused with, by name only) platform Gems — and, added this session, **five new Entry currencies (§9)**: Guild/Skill/Excavation/Forge/Trait Keys, one per raid, gating raid attempts via the daily-grant pattern already established for Seals. **Arena Medals** (§10) is the newest addition: attacker-only reward currency from Arena, sunk in a new cross-currency Arena Shop, and the first currency in the game with a defined season-persistence rule (survives season resets, unlike Rating).

**Still open, flagged rather than decided:** Gold's and Gems' sink lists beyond what's listed above; the exact milestone list/batch sizes and daily-grant cadence for Seals (deferred to the World/enemy design pass, same as kill counts and boss stats). All cross-doc edits this doc previously flagged are **applied** — `core-progression-and-prestige.md` §4 now names Void Shards and carries the 5 raid Key daily-grant-rate upgrade tracks.
