# Global Power Number (GPN)

Status: **Locked, and built 2026-09-15** — see *As built* at the end. Resolves `tech-architecture.md` §8's "exact formula = tuning pass" placeholder, and is idea backlog item 1.

> **Reconfirmed 2026-09-15.** A proposal to turn GPN into an account-wide, never-decreasing "big number" built from collection size and progress was considered and **rejected in favour of this locked design**, because Arena matchmaking needs a number that predicts fights. What came out of it instead: every collected piece now raises stats even when unequipped (§1), so the collection reaches GPN through real stats rather than a separate term.

## Structure recap

- **Locked scope: GPN is a pure function of the Hero + currently fielded Champions' actual current stats.** Nothing else contributes directly — not a weighted sum of collection counts, gacha levels, or shop-purchase counts. If it doesn't actually make the party stronger right now, it doesn't move GPN.
- Because it's a live read of real stats rather than a stored/accumulated total, **GPN is the one progression-adjacent number in this project that's allowed to decrease** — e.g. benching a strong Champion or unequipping an Artifact drops it immediately.
- Everything that already makes the party stronger flows into GPN automatically and requires no special-casing here — that's the point of deriving it from real stats instead of a separate weighted formula.

---

## 1. Why Stats-Only, No Separate Collection Term

Earlier drafts of this doc considered a two-part formula: a dominant "combat power" term plus a smaller additive term for collection breadth (owned-but-unequipped Champions/Skills/Artifacts), matching the original backlog note that Champions count even when benched.

That's unnecessary. **Champions already count while benched without any extra term**, because a benched Champion still grants the Hero a passive stat buff (`champions-guild-gacha.md` §7) — so its contribution is already sitting inside the Hero's real stats by the time GPN reads them. Deriving GPN purely from current stats gets that "counts even benched" behavior for free, with no separate collection-scalar math to maintain.

**The flip side — resolved 2026-09-15.** This section used to record a two-and-two split: Champions and Gear had a passive-collection mechanic, Skills and Artifacts did not. **All four now do.** An owned-but-unequipped Passive Skill or Artifact gives the Hero `SKILL_COLLECTION_PASSIVE_FRACTION` / `ARTIFACT_COLLECTION_PASSIVE_FRACTION` (0.1, untuned — Gear's equipped-to-passive ratio) of its own combat-stat lines (the six stats, max HP, crit chance, crit damage), at its own rarity and investment. Economy, cooldown and utility lines stay equipped-only. As predicted here, GPN needed no change — the passives land in the stats GPN reads.

The one remaining gap is **Active Skills**: they carry no stat lines, so an unequipped Active still adds nothing.

**One consequence worth naming for Gear specifically:** because unequipped Gear contributes passively but a *stronger* unequipped piece contributes only that smaller passive, a player who ignores the upgrade indicator (`gear-equipment.md` §3) sees a GPN below what they've actually earned. That's intended — GPN reads actual current stats, not best-possible ones — and the indicator exists precisely so the gap is visible rather than hidden.

---

## 2. Formula

```
partyEffectiveDPS = Σ memberDPS, across the Hero and all currently fielded Champions
```
Exactly `idle-mechanics.md` §4's existing definition, reused verbatim — already crit-averaged, already reflects each member's full active-skill kit at whatever cooldowns their current SPD allows.

```
memberEHP = HP_member × (1 + DEF_member / EHP_DEF_CONSTANT) / (1 - EVA_member)
partyEffectiveEHP = Σ memberEHP, across the same fielded set
```
**Evasion term added (new).** Since EVA (`classes-and-combat.md` §7) makes a share of incoming attacks miss outright, it multiplies effective survivability by exactly `1 / (1 − EVA)` — a 50% evasion party takes half as many landed hits, so it's genuinely twice as durable. Folding it in here keeps GPN honest as a "how much punishment can this party take" number; leaving it out would let a heavy Vital Reflex board (`traits.md` §5) roughly double real durability while GPN reported no change, which would quietly break Arena matchmaking fairness.

Base EVA is 0 for every unit, so this term is `/ 1` — a no-op — for any party without evasion sources, and the formula reduces to its previous form. The `MAX_EVASION` cap of **0.60** (`classes-and-combat.md` §7) bounds the term at **×2.5** — so evasion can at most multiply a party's effective durability by 2.5, never run away.
**New formula, GPN-specific.** Deliberately *not* the Combat doc's mitigation math (`mitigation = min(1, DEF/(PWR × K))`, `classes-and-combat.md` §7) — that formula is defined relative to a specific attacker's PWR and has no meaning without one. GPN needs an absolute "how much punishment can this party currently take" number, untied to any particular enemy, so DEF converts straight into an effective-HP multiplier via its own new constant, `EHP_DEF_CONSTANT` — tuned independently of combat's `K`, same tune-via-playtest convention as everything else.

```
globalPowerNumber = sqrt(partyEffectiveDPS × partyEffectiveEHP) × GPN_DISPLAY_SCALE
```
**Revised 2026-09-16: the root is back, with a flat display scale.** The 2026-09-15 pass dropped the `sqrt` to make the number bigger; the bare product overshot — it blows past either stat it is made of by so much that it reads as a balance rather than as a power rating. The root is restored and `GPN_DISPLAY_SCALE` (**10**, `constants.ts`, UNTUNED) does the enlarging instead, which gets the intended size without the intended meaning getting lost. Still presentation only:
- **Ranking is unchanged.** Both a square root and a positive flat factor are monotonic, so every ordering under the product is the ordering here too. Arena matchmaking bands are taken on this value, and a percentage band is unaffected by the flat factor — set `ARENA_MATCH_BAND_PCT` against the root (a 10% band on the root was ~21% on the product).
- **Balance is still rewarded.** Against a straight **sum**, where huge DPS masks paper-thin EHP, the geometric mean pulls a lopsided party down: for a fixed budget it peaks when neither side is neglected.
- **Scale, measured.** A level-1 Hero opens at ~945 and crosses 1,000 within a few levels; a level-100 party of three reads ~33,000; deep into the curve it is Decimal-large like everything else. That was the target — big and visibly climbing from the first minute, without the first-hour number already being in the tens of thousands.

All Decimal-typed throughout (`DPS`, `HP`, `DEF` are already Decimal per `tech-architecture.md` §2), so GPN inherits that automatically — no new numeric-type concern.

---

## 3. Live Snapshot Behavior

Recomputed on every settle (`tech-architecture.md` §4a, unchanged) from the party's current baseline stat block — **not** a per-frame read during an active fight. Taking damage mid-fight doesn't move GPN; only an actual loadout/stat change does (leveling, specializing, fielding a different Champion, equipping/unequipping a Skill or Artifact, a new prestige-shop stat purchase).

**Confirmed: this number can go down.** Swapping a strong Champion for a weaker one, or unequipping an Artifact, drops GPN immediately on the next settle. This is the intended, honest behavior — the number reflects current strength, not a historical peak — and it's what makes GPN usable for Arena matchmaking fairness later (see §5).

---

## 4. What Flows In vs. What Doesn't

**Flows in automatically — no special-casing needed anywhere:**
- Hero leveling and specializing (stat growth, `classes-and-combat.md` §2/§4)
- **Equipped Gear** (`gear-equipment.md` §2) — `equippedBonus` modifies real Hero stats directly
- **Owned-but-unequipped Gear** (`gear-equipment.md` §3) — every non-equipped owned piece contributes a smaller `passiveBonus` to the same stats, exactly mirroring the Champion passive. *(This means Gear is the second system after Champions where collection counts without being fielded — see the revised note in §1.)*
- **Traits** (`traits.md`) — all rolled stats and Set bonuses apply party-wide to the Hero and every fielded Champion, so they land in both the DPS and EHP sums. Evasion from Vital Reflex enters via the EHP formula's `1/(1−EVA)` term (§2)
- **Any** owned Champion leveling/star-ing up, fielded or benched — via the passive collection bonus buffing the Hero directly (`champions-guild-gacha.md` §7)
- Fielding a stronger Champion into an open party slot — their own DPS/EHP joins the party sum directly
- Equipped Skills, Active or Passive (`skills-gacha.md` §3) — modify Hero stats/damage directly
- Equipped Artifacts (`artifacts-dig-site-gacha.md` §2) — party-wide passive modifiers apply to every fielded member's stats directly
- Party slot unlocks — indirectly, once an unlocked slot is actually filled with a fielded Champion

- **Owned-but-unequipped Passive Skills and Artifacts** (new 2026-09-15) — a tenth of their combat-stat lines, Hero only, via their collection passives (§1)

**Does not flow in, under current mechanics:**
- Unequipped **Active** Skills — no stat lines to pass on
- The economy, cooldown and utility lines of unequipped Skills and Artifacts
- *(Unequipped Gear, and unequipped Passive Skills and Artifacts, used to belong on this list and no longer do — see above)*
- Gacha level (1–10 per system) — reflects drop-rate progress, not a stat
- A weaker benched Champion sitting behind a stronger fielded one — its own stat block was never in the sum to begin with (only its passive contribution, already counted via the Hero, applies)

---

## 5. Known Uses

- **Platform leaderboard aggregate** (`tech-architecture.md` §1) — unchanged.
- **Profile display** — raw big number, same notation as combat stats (e.g. `3.2e18`), per your call. No compression/normalization pass.
- **Arena matchmaking** (`arena.md`, Locked — resolves `tech-architecture.md` §4d, backlog item 5) — **RESOLVED.** The nuance this section originally flagged (attacker's live GPN not reflecting a defender's actual `defenseLoadout` strength) is answered by a dedicated **Defense GPN**: the exact same formula above, computed off `defenseLoadout` instead of live state, recomputed only when that loadout is saved (not every settle, since it's static between edits) and denormalized to `hqState.defenseGpn` (`tech-architecture.md` §3). Matchmaking compares the attacker's live GPN against the pool of defenders' Defense GPN — the two numbers are finally comparable apples-to-apples. See `arena.md` §2.

---

## Cross-Doc Edit Applied

`tech-architecture.md` §8 updated in this session (see delivered file) — replaced the stale "folding party stats, collection breadth/levels, gacha levels, and shop purchases (exact formula = tuning pass)" description with a pointer to this doc's locked formula.

---

## Implementation Note

Everything above is locked: GPN as a pure live function of the Hero + fielded Champions' actual DPS/EHP (no separate collection term), the new GPN-specific EHP formula (distinct from combat's attacker-relative mitigation), the geometric-mean combination with a flat display scale (dropped to a bare product 2026-09-15, restored 2026-09-16), live-snapshot behavior (can decrease), and raw big-number display. `EHP_DEF_CONSTANT` joins the rest of the project's tunable constants in `constants.ts`, calibrated during the balance-script pass same as everything else. **Revised in a later pass:** the EHP formula now carries a `1/(1−EVA)` evasion term (`classes-and-combat.md` §7), and the "what flows in" lists are updated for Gear (both equipped and passively owned) and Traits (party-wide), neither of which existed when this doc was first written. **The Arena defense-loadout nuance (§5) is now resolved** — see `arena.md` (Locked), which introduces a Defense GPN computed off `defenseLoadout` specifically so Arena matchmaking compares like with like.


---

## As built — 2026-09-15, GPN scale revised 2026-09-16

- **`shared/utils/hero-quest/power.ts`** — `globalPower(hero)` returns the GPN (`sqrt(dps × ehp) × GPN_DISPLAY_SCALE`, §2), party DPS, party EHP and a per-unit breakdown; `memberEhp(unit)` is §2's EHP. Pure, so any client or script can recompute it. Specced in `test/hero-quest/power.spec.ts`.
- **DPS is taken against zero DEF and a single target.** GPN has no enemy, so there is no mitigation, and an AoE ability is counted for the one body it is guaranteed to hit. Autoattacks come from `partyDps` and abilities from `partyAbilityDpsByUnit` — the idle rate's own functions. **Ability self-buffs projected from uptime (Haste) are not included**: they belong to a fight, and GPN is a snapshot of the stat block.
- **`EHP_DEF_CONSTANT = 10`, `// UNTUNED ╧`** — a level-1 Hero's DEF doubles its EHP. DEF rides the level curve like HP, so EHP grows as the stat curve squared, the same order as DPS.
- **Computed on read, not stored.** It ships on the hero payload (`serializeHero` → `power: { gpn, dps, ehp }`) rather than being written to `hqState.globalPowerNumber` on every settle as `tech-architecture.md` §8 describes. Nothing reads a stored value yet, and a settle-time write would be stale the moment the player equipped something without settling. Add the column when the leaderboard aggregate or Arena's Defense GPN needs one.
- **Shown** as the battle screen's headline (`GlobalPower.vue`): it counts up to a new value on a log scale, shows a `+12%` / `×3.2` chip on a gain and a red one on a loss, and lists party DPS and effective HP beneath. It updates when a payload lands, not between polls — the stats need a snapshot only the server has. The wiki's Combat page has an entry, with its formula interpolated from the constants.
- **Measured** (root × 10, 2026-09-16), un-invested Beginner stand-ins, no collection: level 1 → 945 (solo) / 2.4K (party of 3); level 100 → 14.0K / 35.4K; level 500 → 3.4e10 / 1.1e11; level 2000 → 4.0e35 / 1.2e36. (Product form, for comparison: level 1 → 8.9K / 55K; level 2000 → 1.6e69 / 1.5e70.)
- **The evasion term is live** since Traits (2026-10-09, `build-log.md` #51): a 5-piece Vital Reflex board puts every member at 0.50 EVA, doubling its EHP before the VIT the same Set adds.
- **Not built:** the platform leaderboard aggregate, the profile display, and Defense GPN (Arena).
