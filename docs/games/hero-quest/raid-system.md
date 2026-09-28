# Raid System

Status: **Locked** — decisions confirmed, ready to reference for implementation planning. Resolves idea backlog item 2, and reuses the seeded boss-fight pattern already anticipated in `tech-architecture.md` §4c.

## Structure recap

- **Every gacha has one paired raid** — **Guild Raid** (Champions), **Training Grounds Raid** (Skills), **Dig-site Raid** (Artifacts), **Forge Raid** (Gear). New gacha → new paired raid, same pattern — extensible by construction. **Raids aren't required to be gacha-paired, though** — a standalone raid rewarding its own dedicated non-gacha currency is equally valid under this structure (see idea backlog item 8, now named **Trait Raid**). Item 3 (Passive Skill Tree) is left out of the roster for now.
- Each raid has its own independent infinite level ladder and its own independent Key-gated attempt pool (Section 3), and rewards **only** its own paired reward currency — that's its paired gacha's Seals for a gacha-paired raid, or a dedicated currency of its own for a standalone raid. No secondary Gold reward.
- Difficulty is a **fixed, static curve** — every player at raid level N faces an identical fight regardless of prestige or GPN. Account growth is what lets you push the ladder further, not the ladder adjusting to you.
- **Live-engagement only** — raids never resolve offline, exactly like bosses.
- Reuses the seeded server-resolved tick-sim + client replay pattern (`tech-architecture.md` §4c) — no new fight-resolution mechanism needed.

---

## 1. Roster & Extensibility

**Locked: every gacha gets exactly one paired raid (4 at launch: Guild/Training Grounds/Dig-site/Forge) — but a raid is not required to be gacha-paired.** A standalone raid, tied to no gacha and rewarding its own dedicated currency instead of Seals, is an equally valid instance of this structure. **5 raids in current scope** — the 4 gacha-paired raids plus **Trait Raid** (standalone, backlog item 8). Item 3 (Passive Skill Tree) is left out of the roster for now — no raid currently planned for it; revisit if that item gets its own design pass later.

| Raid | Paired gacha | Reward currency | Entry currency (Key) | Fight Type |
|---|---|---|---|---|
| Guild Raid | Champions (Guild) | Guild Seals | Guild Keys | `solo_boss` |
| Training Grounds Raid | Skills | Skill Seals | Skill Keys | `training_dummy` (2026-09-28, `open-items.md` #31) |
| Dig-site Raid | Artifacts | Excavation Seals | Excavation Keys | `reinforced_boss` |
| Forge Raid | Gear (The Forge) | Forge Seals | Forge Keys | `boss_gauntlet` (was `phased_boss` until 2026-09-29, `open-items.md` #32) |
| Trait Raid | — standalone, item 8 (Traits) | Trait Gems | Trait Keys | `rampaging_boss` |

**Key names are locked** — mirroring each raid's existing Seal-name convention (`<prefix> Seals` → `<prefix> Keys`). **Fight Type assignment is locked** — see Section 7 for each type's mechanics. Training Grounds was `solo_boss` alongside Guild until 2026-09-28, when it became `training_dummy` (the user's call, `open-items.md` #31); nothing about the structure requires unique assignments.

Worth closing the loop on Forge Raid's earlier flagged concern: `phased_boss` naturally tests build flexibility, which reads fine for Forge even without an active mid-fight loadout swap — with manual equip restored (`gear-equipment.md` §3), surviving all phases means the account's gear spread has to actually hold up across the whole fight, which is a reasonable proxy for "is your gear current."

New gacha-paired raids follow this pattern automatically as new gacha content is added — no structural redesign needed, just a new row in this table. A standalone raid follows every other structural rule in this doc identically (its own ladder, its own Key-gated attempt pool, live-engagement-only, quick-clear) — the only difference is what it pays out and that it has no gacha to pair with.

---

## 2. Level Track & Difficulty

**Locked: infinite ladder per raid, fixed/static difficulty curve.** Every player at a given raid level faces an identical fight, independent of prestige, world/stage, or GPN. This is deliberately a second, parallel measuring stick from the main enemy curve — your account's actual growth (prestige cycles, gacha collection, Hero leveling) is what lets you climb a fixed ladder further, not the ladder scaling to match you.

```
raidDifficulty(raidLevel) = RAID_BASE_STATS × RAID_LEVEL_GROWTH^(raidLevel - 1)
```

Own dedicated constants **per raid** (`RAID_BASE_STATS[raid]`, `RAID_LEVEL_GROWTH[raid]`) — independent of `core-progression-and-prestige.md`'s `b^n` enemy curve, and independent of each other. No reason all 4 raids need the same growth rate; one meant as a longer-term chase can climb slower than one meant to gate content earlier. Tune-via-playtest, same convention as everywhere else in this project.

**Big-number consequence, same as the enemy curve:** since this climbs forever with no prestige reset to bound it, `raidDifficulty` needs the same Decimal/text treatment as `enemyMultiplier` (`tech-architecture.md` §2) — a dedicated player exceeds float precision here too, just on its own independent clock.

**Level selection — revised: farm or progress, exactly two options.** At any time, the player selects between **their best-ever cleared level** (farm — a guaranteed win, via quick-clear or a fresh fight, Section 4) or **exactly one level higher** (progress — an unproven attempt at extending the frontier). No jumping further ahead, and no reaching back into older cleared levels below the frontier — the earlier "any cleared level stays selectable" model is retired in favor of this simpler binary. Clearing the +1 level advances the frontier, and the farm option updates to match.

**Exception:** `rampaging_boss` raids (Section 7) have no discrete level-select at all — see that section.

---

## 3. Attempts & Keys

**New concept, locked: each raid gates its attempts with its own dedicated entry currency — a Key** — distinct from that raid's reward currency (Section 1's table has proposed names). Keys are a first-class currency, same as anything else in `economy-and-currencies.md`, which means beyond the daily grant below they're also a valid reward payout for *other* systems later (events, milestones, etc.) — flagged as a future source, not designed here.

- **3 Keys/day per raid**, banking up to a week's worth (21) at the current daily rate. Fully independent per raid — Guild Keys never touch Training Grounds Keys, etc.
- A prestige-shop upgrade raises the daily grant rate — **one upgrade track per raid** (5 total, now including Trait Raid), matching the existing per-system pattern already used for Champion/Skill/Artifact slots (`core-progression-and-prestige.md` §4). Bank cap scales with the upgraded daily rate.

**Locked: for raids where the boss can be defeated (`solo_boss`, `reinforced_boss`, `phased_boss`), a Key is spent only on a WIN, never on a loss.** A timeout or party wipe costs nothing — the player can re-engage the same level immediately, as many times as they want, at no Key cost. A Key is spent only at the moment a level is actually cleared, whether via a freshly-fought win or a quick-clear replay of the frontier level (Section 4).

**Worth stating plainly:** this makes the Key pool functionally "successful clears/claims per day" rather than "tries per day" — a level that's currently too hard for an account never burns its limited daily resource while the player is stuck on it. More forgiving than the flat "every attempt costs a resource" pattern common in the genre, and consistent with this project's existing soft-fail philosophy (World bosses already never punish failure beyond a stage fallback).

**Exception: `rampaging_boss` raids (Section 7) have no win state to gate on, so a Key is spent on every single entry, unconditionally.** *(Ordering note: where a preferred Loadout is assigned, the swap completes before the Key debit — `loadouts.md` §4. This only matters here, since it's the only raid where a Key is spent regardless of outcome.)* Win-gating simply doesn't apply — there's no "win" to gate. This is a cleaner replacement for the earlier "consumed on new personal-best" idea: the Key mechanic answers the same underlying problem more generally, and keeps the currency's meaning identical across all five raids ("this is what it costs to try") instead of needing a bespoke consumption rule for one raid type.

---

## 4. Quick-Clear

**Locked: quick-clear costs a Key, identical to a fresh live engage** — the only difference is it skips the fight and instantly grants that level's reward. Since Keys are win-gated for defeatable-boss raids (Section 3), quick-clear is simply "spend a Key to redeem a level you've already proven you can beat" — no re-fighting, no re-rolling any outcome (a previously-cleared level is a guaranteed win by definition, nothing left to roll).

**With Section 2's farm-or-progress model, quick-clear now only ever applies to the frontier (best-ever cleared) level** — that's the only "already cleared" option available for selection, since older cleared levels aren't individually reachable anymore. Attempting the +1 level always requires a fresh fight — it hasn't been proven yet, nothing to quick-clear.

Quick-clear bypasses `fight.ts` entirely — once the level's "cleared" flag is confirmed server-side, it's a pure reward-grant call, no seed/sim needed. A fresh engage still goes through the full seeded tick-sim + client replay exactly like a boss fight (`tech-architecture.md` §4c).

**Exception:** `rampaging_boss` raids (Section 7) have no discrete "cleared" level to flag — quick-clear there re-grants the reward for the account's current best-ever level reached instead, still at the cost of a Key.

---

## 5. Live-Engagement Only

**Locked: raids never resolve offline**, exactly matching bosses (`idle-mechanics.md` §5, unchanged) — this closes the question `tech-architecture.md` §4c left open ("whether raid attempts... can be triggered while offline at all"). Consequence for Battle Speed: same treatment as bosses (`tech-architecture.md` §4b) — a purchased multiplier compresses live playback pacing only, since the fight is a fixed-duration seeded sim regardless of speed. No offline-raid case exists to define, because there isn't one.

Fight duration itself is bounded by `RAID_ENRAGE_SECONDS` (Section 7) for three of the four fight types; `rampaging_boss` has no player-facing timer, only a technical safety cap — see Section 7.

---

## 6. Rewards

**Locked: the only reward is that raid's own reward currency — no secondary Gold burst.** Removed this session; raids pay out their specified currency only, full stop. Batch size scales with raid level, deeper levels paying more per clear:

```
raidRewardGranted(raidLevel) = RAID_REWARD_BASE[raid] × RAID_REWARD_GROWTH[raid]^(raidLevel - 1)
```

Renamed from `sealsRewarded`/`RAID_SEAL_BASE`/`RAID_SEAL_GROWTH` — not every raid pays Seals (Trait Raid pays Trait Gems), so the generic name is the correct one going forward.

**Not rewarded directly:** Essence (crafting currency) stays exclusive to post-max gacha duplicates (`gacha-shared-system.md` §6) — no new source added here. Void Shards stay tied to the World 10/Stage 10 full clear only (`core-progression-and-prestige.md` §4), unchanged. Gold is no longer part of raid rewards at all — no entry needed in `gold-economy.md`.

---

## 7. Fight Types

**Locked: every raid is assigned one Fight Type, chosen from four archetypes** (five since 2026-09-28: `training_dummy` joined for the Training Grounds, `open-items.md` #31). This replaces the earlier "bespoke mechanic layered per raid" proposal — the fight type itself is now the source of per-raid differentiation, not a separate mechanic stacked on top of a generic fight.

| Identifier | Name | Shape |
|---|---|---|
| `solo_boss` | Solo Boss | Single enemy unit, no adds. Pure stat/rotation check — no structural mechanic beyond raw output vs. mitigation. |
| `reinforced_boss` | Reinforced Boss | Boss unit + periodic add-wave spawns on a timer/HP trigger. Forces split attention — naturally pressure-tests party composition (does the party have an answer for adds without dropping boss damage). |
| `phased_boss` | Phased Boss | Single boss, HP-threshold crossings trigger phase changes (new attack pattern, a mechanic that must be answered within the phase). Tests build flexibility — naturally pressure-tests skill loadout choices. |
| `rampaging_boss` | Rampaging Boss | No HP pool — boss is fully unkillable by design. See dedicated subsection below. |
| `boss_gauntlet` | Boss Gauntlet | Three bosses back to back, each walking out as the last falls. See dedicated subsection below. |
| `training_dummy` | Training Dummy | A static dummy that can't die and can't attack. The result is the damage the party lands before the timer ends. See dedicated subsection below. |

**Raid → Fight Type assignment is locked** — see Section 1's roster table. Per-tier mechanic *content* (specific add-wave patterns, phase specifics, exact timer values) is still deferred to implementation, same "structure now, content later" convention already used for Champion abilities and Artifact effects.

### Session Timer

**Locked, general case: hard timer / enrage.** `solo_boss`, `reinforced_boss`, and `phased_boss` fights run against `RAID_ENRAGE_SECONDS` — tunable, likely per fight-type, since a `reinforced_boss` fight probably wants a longer window than `solo_boss`. If the boss isn't down when the timer expires, it enrages and the attempt is called as a loss. No new attempt-cost rule needed here — this already falls under Section 3's existing "a timeout... costs nothing."

**`rampaging_boss` is an explicit exception — no player-facing timer.** The mechanic depends on unbounded real-time escalation ending in death, not a clock; a hard timer would frequently cut runs short before they reach their natural resolution. A large technical safety cap on sim tick-count still exists as an implementation guard rail, but it's not a design-facing enrage.

### Rampaging Boss

**No HP pool — the boss is fully unkillable by design.** There is no secret cap-level kill; death is always the outcome, by design. Cumulative damage the party deals feeds a level-up gauge instead of reducing a health bar. Each time it crosses a threshold, the boss's level increases and a single abstracted power scalar governing its offense scales up with it, feeding into the combat math already defined elsewhere (`classes-and-combat.md`'s PWR stat and clamped mitigation formula) — no new combat resolution mechanism needed.

```
raidRampageDamageToLevel(level) = RAID_RAMPAGE_DMG_BASE × RAID_RAMPAGE_DMG_GROWTH^(level - 1)
raidRampageBossPower(level)     = RAID_RAMPAGE_POWER_BASE × RAID_RAMPAGE_POWER_GROWTH^(level - 1)
```

- `damageToLevel` is **incremental** (resets each level), not cumulative-since-start — each level takes more added damage than the last to trigger, same "amount-needed grows per step" shape used everywhere else in the project.
- Both curves are exponential, which makes "the party always eventually dies" a **structural guarantee, not a tuning outcome** — as long as `RAID_RAMPAGE_POWER_GROWTH > 1`, boss output outpaces any finite party's HP/mitigation eventually, regardless of where the constants land. A stronger account levels the boss up faster (more damage per tick, thresholds cross sooner) *and* survives longer per level — net effect, stronger accounts reach a higher final level. That's the progression hook.
- **The level reached at the moment of death is the run's result.** It plugs directly into the existing reward formula (`raidRewardGranted(raidLevel)`, Section 6) with that level standing in for `raidLevel` — no new reward math needed.
- Same big-number consequence as `raidDifficulty` (Section 2) — an escalating exponential with no upper bound needs the same Decimal/text treatment eventually.

**Two structural exceptions to the rest of this doc, specific to `rampaging_boss` raids:**

1. **No discrete level-select (Section 2 doesn't apply).** Every engage starts the boss at level 1 and free-runs until death — there's nothing to pick in advance. The raid's "level" is your best-ever result, not a selection.
2. **Quick-clear reclaims your current PB (Section 4, reinterpreted).** Same pattern as everywhere else in the doc — spend a Key, instantly re-grant the reward for your best-ever level, no re-run of the full escalation required.

**No longer an exception:** Key consumption (Section 3) now has a clean general answer for this type — a Key is spent on every entry, unconditionally, since there's no win state to gate on. That falls directly out of Section 3's Key rule rather than needing its own bespoke carve-out.

### Boss Gauntlet

**Decided 2026-09-29 (the user's call), for the Forge Raid:** in place of one boss changing through three phases, **three bosses back to back**, each coming out as the last falls: the forge's own ranks, **the Apprentice** (an ogre striker with a sledgehammer), **the Journeyman** (a clockwork automaton whose hammer arm is a piston) and **the Forgemaster** (the giant master smith, the finale). The art is `raid-forge.ts` (`art-style.md` Round 5). `phased_boss` is no longer assigned to any raid.

**Still open, `open-items.md` #32:** how the rules above (the enrage timer, what counts as a win for the Key, the difficulty and reward curves) apply to three bosses rather than one.

### Training Dummy

**Decided 2026-09-28 (the user's call), for the Training Grounds Raid:** the boss is a massive, static training dummy. It **can't die and can't attack**. The raid measures **how much damage the party deals before the timer ends**, a pure damage check with no survival side.

- **The timer is the round length, not an enrage.** When it runs out the round ends and the damage dealt is the result.
- **Three animations only:** Entry (it falls out of the sky and drives its stake into the ground), Idle and Hit. It has no Attack and no Death. The art is the Great Dummy (`raid-dummy.ts`, `art-style.md` Round 5).

**Still open, `open-items.md` #31.** The rest of this doc assumes a fight that ends in a win, a wipe or a death. How a damage race fits Sections 2–4 and 6 (Keys, the ladder, quick-clear, the reward curve) and the new timer constant are not decided. Rampaging Boss's answers are the nearest precedent, but they have not been adopted.

---

## Cross-Doc Edits

**Applied in this session:** `economy-and-currencies.md` §5 — raids added as a third Seal-earn source alongside milestones and the daily grant (see delivered file). Still accurate for the four Seal-paying raids; Trait Raid's Trait Gems already registered per `traits.md`.

**Applied in a later session:**

| Doc | Section | Edit |
|---|---|---|
| `economy-and-currencies.md` | new §9 | Registered the 5 Key currencies (Guild/Skill/Excavation/Forge/Trait Keys) with their daily-grant source and win-gated/unconditional sink split. |
| `core-progression-and-prestige.md` | §4 | Added the 5-track raid Key daily-grant-rate prestige-shop upgrade line. |
| `tech-architecture.md` | §3 | Added `hqRaidState` schema (`highestLevelCleared`, `keyBalance`, `lastKeyGrantAt`, ×5 raids) and the 5 new `hqShopUpgrades` track IDs. |
| `tech-architecture.md` | §4c | Closed the stale "raids anticipated, not yet designed" note — now points to this doc as Locked. |
| `tech-architecture.md` | §5 | Added `raid/engage.post.ts` and `raid/quick-clear.post.ts`. |

No further flagged edits remain outstanding from this doc.

---

## Implementation Note

Locked: **5 raids in current scope** — 4 gacha-paired (Guild/Training Grounds/Dig-site/Forge) plus **Trait Raid** (standalone, pays Trait Gems). Passive Skill Tree's raid (backlog item 3) is left out of the roster for now. Every raid has its own infinite fixed-difficulty ladder independent of `enemyMultiplier` and independent of GPN, its own independent Key-gated attempt pool, live-engagement-only (never offline, matching bosses), and rewards paying **only** its own reward currency — no secondary Gold burst (removed this session).

**Key names are locked** (Section 1): Guild Keys, Skill Keys, Excavation Keys, Forge Keys, Trait Keys — one per raid, mirroring each raid's Seal-name convention.

**Fight Type assignment is locked** (Section 1): Guild Raid → `solo_boss`, Training Grounds Raid → `training_dummy` (was `solo_boss` until 2026-09-28, `open-items.md` #31), Dig-site Raid → `reinforced_boss`, Forge Raid → `boss_gauntlet` (was `phased_boss` until 2026-09-29, `open-items.md` #32), Trait Raid → `rampaging_boss`. Per-tier mechanic content for the three timer-based types is still deferred to implementation.

**Attempts are now gated by a dedicated Key currency per raid (Section 3), replacing the earlier abstract attempts counter.** 3 Keys/day, banks to 21, per-raid prestige-shop upgrade track. For defeatable-boss raids (`solo_boss`/`reinforced_boss`/`phased_boss`), a Key is spent only on a win — exactly how attempts worked before. For `rampaging_boss`, a Key is spent on every entry unconditionally, since there's no win state to gate on — this cleanly replaces the earlier "consumed on new-PB" carve-out with a rule that holds generally across all five raids. Keys are first-class currencies and can be granted by other systems later (events, milestones) beyond the daily trickle — flagged as a future source, not designed here.

**Level selection is now a binary farm-or-progress choice (Section 2), not full history.** The player selects between their best-ever cleared level (farm, guaranteed win via quick-clear) or exactly one level higher (progress, unproven). Reaching back into older cleared levels below the frontier is retired. Quick-clear (Section 4) is consequently always the frontier level — there's nothing else left to quick-clear.

**Fight Types (Section 7), locked as the differentiation mechanism, replacing the earlier bespoke-per-raid-mechanic proposal:** four archetypes — `solo_boss`, `reinforced_boss`, `phased_boss`, `rampaging_boss` — each raid assigned exactly one, assignment itself still TBD. Three run against a shared hard-timer/enrage rule (`RAID_ENRAGE_SECONDS`, tunable per type); `rampaging_boss` is an explicit exception with no player-facing timer. `rampaging_boss` has no HP pool (fully unkillable by design, no secret cap-kill), levels up on cumulative damage taken via `raidRampageDamageToLevel`/`raidRampageBossPower` (single power-scalar, both exponential — guaranteeing eventual party death structurally, not just by tuning), and reuses the general reward formula keyed off level-reached-at-death.

`RAID_BASE_STATS`, `RAID_LEVEL_GROWTH`, `RAID_REWARD_BASE/GROWTH` (renamed from `RAID_SEAL_BASE/GROWTH`, all per-raid), `RAID_ENRAGE_SECONDS` (per fight-type), and `RAID_RAMPAGE_DMG_BASE/GROWTH` + `RAID_RAMPAGE_POWER_BASE/GROWTH` (rampaging_boss-specific) all join the project's tunable-constants registry, calibrated during the balance-script pass. `RAID_GOLD_MINUTES` is retired. All previously-flagged cross-doc edits are now applied — see the Cross-Doc Edits section above.
