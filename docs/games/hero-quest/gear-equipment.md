# Gear (The Forge Gacha)

Status: **Locked** — decisions confirmed, ready to reference for implementation planning. See `gacha-shared-system.md` for the rarity/leveling/currency/duplicate mechanics, applying here identically as the 4th gacha; this doc covers only what's Gear-specific. Resolves idea backlog item 7.

## Structure recap

- **In-game name: The Forge.** 4th and last of the 4 gachas alongside Guild (Champions), Training Grounds (Skills), Dig-site (Artifacts).
- **Locked: Hero-only equipment** (not party-wide, unlike Artifacts) — 6 fixed slots, one per stat: **Weapon** (PWR), **Boots** (SPD), **Gauntlets** (IMP), **Charm** (LCK), **Armor** (VIT), **Helmet** (DEF). One slot per Hero stat, exactly.
- **Locked: all 6 slots available from the start** — no prestige-shop slot-unlock progression, unlike the other 3 gachas' 2→5 pattern (the deliberate exception among the four). Gear slots map to Hero stats that already exist from day one, not a party/loadout size that grows.
- **Locked: 1 item per slot per rarity** — 36 total (6 slots × 6 rarities), avoiding the dupe-dilution problem 2-per-slot would create for pieces that would otherwise be mechanically identical.
- **Locked: single-stat-only, always** — rarity scales magnitude, never adds a second stat. No effect-line-count table like the other 3 systems.
- **Locked: owning a piece grants a smaller passive stat bonus even when not equipped**, mirroring `champions-guild-gacha.md` §7 exactly.
- Currency: **Forge Seals** (pull) / **Gear Essence** (crafting), following the established naming patterns.

---

## 1. Slots & Roster

| Slot | Governs | Notes |
|---|---|---|
| Weapon | PWR | *(Revised: this was previously "the one dynamic slot," resolving to whichever of STR/DEX/INT the Hero's class used. With those merged into PWR — `classes-and-combat.md` §2 — Weapon is now a flat slot exactly like the other five, and the special-case footnote is gone.)* |
| Boots | SPD | |
| Gauntlets | IMP | |
| Charm | LCK | |
| Armor | VIT | |
| Helmet | DEF | |

**Roster: 36 total — exactly 1 item per slot per rarity** (6 slots × 6 rarities), per your call. Since every piece in a slot does the identical thing at a different magnitude, there's no combinatorial "ability pool" design needed here — unlike Champions/Skills/Artifacts, this doc doesn't need a reuse-math section at all.

**Naming falls out for free.** Reusing the exact rarity epithet ladder already locked in `champions-guild-gacha.md` §5 (Novice/Adept/Veteran/Vanguard/Exalted/Ascendant), every item's name is simply `<Rarity Epithet> <Slot Name>`. No separate title pool needed (unlike Champions' archetype titles) — with only one item per slot+rarity to ever name, the full 36-item roster is completely named by the table below; nothing left to author.

| Rarity | Weapon | Boots | Gauntlets | Charm | Armor | Helmet |
|---|---|---|---|---|---|---|
| Common | Novice Weapon | Novice Boots | Novice Gauntlets | Novice Charm | Novice Armor | Novice Helmet |
| Uncommon | Adept Weapon | Adept Boots | Adept Gauntlets | Adept Charm | Adept Armor | Adept Helmet |
| Rare | Veteran Weapon | Veteran Boots | Veteran Gauntlets | Veteran Charm | Veteran Armor | Veteran Helmet |
| Epic | Vanguard Weapon | Vanguard Boots | Vanguard Gauntlets | Vanguard Charm | Vanguard Armor | Vanguard Helmet |
| Legendary | Exalted Weapon | Exalted Boots | Exalted Gauntlets | Exalted Charm | Exalted Armor | Exalted Helmet |
| Mythic | Ascendant Weapon | Ascendant Boots | Ascendant Gauntlets | Ascendant Charm | Ascendant Armor | Ascendant Helmet |

---

## 2. Effect Formula

Confirmed single-stat, magnitude-only:

```
equippedBonus(slot, rarity, star, level) = SLOT_BASE_BONUS[slot] × RARITY_MULTIPLIER[rarity] × (star × 10 + level)
```

- `RARITY_MULTIPLIER` reuses `champions-guild-gacha.md` §2's table verbatim (1.0x Common → 2.5x Mythic) — same rarity-to-power relationship as everywhere else in the project, no new table invented.
- `(star × 10 + level)` is the same scalar reused everywhere in this project (`gacha-shared-system.md` §6) — 1 at 0★/Lv1, 60 at 5★/Lv10 (maxed).
- `SLOT_BASE_BONUS[slot]` — 6 independent tunable constants, since PWR/SPD/LCK/IMP/VIT/DEF all plug into fundamentally different downstream formulas (cooldown %, mitigation ratio, crit chance/damage, flat HP) with no shared "natural" scale. Tune-via-playtest, same convention as everywhere else.
- All bonuses are expressed as **%** to the target stat (e.g. "+X% SPD"), consistent with how Skills passives and Artifact effects already express stat bonuses.

### Rarity Progression Guarantee — new, confirmed compatible

You asked for two catch-up guarantees. Restating them in scalar terms first, since "level" here means the full `(star × 10 + level)` scalar (1 at 0★/Lv1, up to 60 at 5★/Lv10 maxed) rather than the 1–10 level-within-a-star number used elsewhere — a next-tier piece that's only been leveled within its first star (0★) has scalar equal to its displayed level directly, which is why "next tier at level 1 / level 10" reads naturally even though "level" resets per star everywhere else in this project:

1. **A current-tier piece at scalar ≥ 50 should outperform a next-tier piece at scalar 1** (freshly pulled, 0★/Lv1).
2. **A fully maxed current-tier piece (scalar = 60) should outperform a next-tier piece at scalar 10** (0★/Lv10 — through its first star, no star-ups yet).

Since `SLOT_BASE_BONUS` is identical across rarities for a given slot (only `RARITY_MULTIPLIER` differs), both reduce to one constraint on adjacent-tier multipliers:

```
guarantee 1:  RARITY_MULTIPLIER[next] / RARITY_MULTIPLIER[current] < 50
guarantee 2:  RARITY_MULTIPLIER[next] / RARITY_MULTIPLIER[current] < 6      ← the binding one
```

Guarantee 2 is strictly tighter, so it's the one that actually governs: **as long as no rarity tier's multiplier is more than 6× the tier directly below it, both guarantees hold automatically.**

**Yes, this makes sense, and confirmed compatible with no changes needed:** the rarity multiplier table this doc already reuses from `champions-guild-gacha.md` §2 (1.0 / 1.15 / 1.35 / 1.6 / 2.0 / 2.5) has a maximum adjacent-tier ratio of **1.25×** (Legendary→Epic and Mythic→Legendary) — far under the 6× ceiling, so both guarantees hold with a wide safety margin using the existing numbers as-is. That also means there's real headroom left over: if you ever want rarity itself to feel like a bigger jump, the multiplier could grow up to ~6× per tier before this catch-up promise would break.

**Locking this as an explicit tuning constraint**, not just a one-time check — whoever tunes `RARITY_MULTIPLIER` later (or gives Gear its own table instead of reusing Champions') needs to keep every adjacent-tier ratio under 6× to preserve both guarantees. Worth carrying into `constants.ts`'s eventual comments, not just here.

---

## 3. Equip vs. Collection — Manual Equip, With an Upgrade Indicator

**Revised from the earlier auto-equip proposal — manual equip confirmed.** Every slot holds exactly one manually-chosen equipped piece, freely and unlimited-ly swappable outside combat among the pieces owned for that slot — the same pattern already locked for Skills (`skills-gacha.md` §5) and Artifacts (`artifacts-dig-site-gacha.md` §7).

- **The first piece ever owned for a slot auto-equips immediately** — no reason to leave a brand-new slot empty when there's only one option to begin with.
- **Upgrade indicator, not an auto-swap:** whenever an owned-but-unequipped piece's `equippedBonus` would exceed the currently equipped piece's, that slot shows a badge/highlight prompting the player to swap. The indicator only informs — the swap itself always stays a manual tap.

```
equippedBonus(slot, rarity, star, level) = SLOT_BASE_BONUS[slot] × RARITY_MULTIPLIER[rarity] × (star × 10 + level)
```
(unchanged — this is what the currently *equipped* piece in each slot contributes.)

**Every other owned piece in that slot — including one that's actually stronger but not yet manually equipped — contributes a smaller passive bonus instead**, mirroring `champions-guild-gacha.md` §7 exactly:

```
passiveBonus(slot, rarity, star, level) = GEAR_PASSIVE_COEFFICIENT × RARITY_MULTIPLIER[rarity] × (star × 10 + level)
```
Own tunable coefficient, deliberately smaller than the equipped formula's implicit weight — same "collecting has value independent of what's actively equipped" design intent as the Champions passive.

**Worth naming the consequence of going manual:** a player who ignores the upgrade indicator is leaving real power on the table — their Hero's actual stats (and therefore GPN, `global-power-number.md`) stay lower than what they've already earned until they act on it. That's consistent with GPN being a live snapshot of *actual current* stats rather than "best possible" stats — manual equip makes attentiveness matter, not just collection, and the indicator exists so that gap is never hidden from the player, only left for them to close themselves.

---

## 4. Currency, Rates & Leveling

Fully inherited from `gacha-shared-system.md`, identical to the other 3 gachas — no deviation:

- **Rarity, gacha leveling (1–10), drop-rate table:** identical (§1–3 there).
- **Currency: Forge Seals** (pull) / **Gear Essence** (crafting) — following the established `<Gacha Name> Essence` pattern (`gacha-shared-system.md` §6) and the "Seals" pull-currency convention shared by Guild/Skill/Excavation Seals.
- 1 pull = 1 Seal; 10-pull = 9 Seals, still counts as 10 toward leveling. Extra Seals via the daily escalating Gold ladder (`gold-economy.md` §7). **`SEAL_LADDER_GROWTH[gear]` is 1.2**, like every gacha since the 2026-10-04 repricing. It was 1.0011 before, matching Skills: Gear's roster is structurally identical (36 items, 6 per rarity, ~244,000 pulls to full completion), so the same rate follows directly rather than being assumed from size alone.
- **Leveling/dupes:** identical `dupesToLevelUp` formula, 0★–5★ × Lv1–10, 1,066 dupes to max one piece from scratch. Post-max duplicates convert to Gear Essence, spendable via Crafting for a full RNG bypass on a specific chosen piece, same 5×-per-rarity value/cost table.

---

## 5. Raid Tie-In — Resolves `raid-system.md`'s Reserved Row

**Forge Raid** pairs with this gacha exactly like the other 3, per `raid-system.md` §1 — rewards Forge Seals as its primary payout, plus a calendar-relative Gold burst, on the same win-gated attempt economy (3/day, banks to 21, per-raid prestige-shop upgrade for attempt rate) as every other raid.

**Worth flagging, updated now that equip is manual again:** with the auto-equip version, Forge Raid's themed mechanic (`raid-system.md` §7's "pressure-tests its paired system" framing) was an awkward fit, since there was no real player decision to pressure-test. Manual equip reopens a genuine, if simple, hook — **a mechanic that specifically punishes stale or un-updated gear** (e.g. a check against whether the equipped set matches the player's actual best-owned pieces) is now a natural fit, rewarding players who actually respond to the upgrade indicator (Section 3) rather than just collecting. Still not authored here — worth designing properly whenever Forge Raid's actual mechanic content gets written.

---

## 6. Placement

**Revised: Gear/Forge sits as the 1st gacha overall** — ahead of Champions/Guild, Skills/Training Grounds, and Artifacts/Dig-site (updated from the earlier "2nd, after Guild" placement). Applied directly to `tech-architecture.md` §7's page tab order in this session (see delivered file).

---

## Cross-Doc Edits

**Applied in this session:**
- `tech-architecture.md` §7 — `forge` added to the page tab list, now positioned **1st** per the revised Section 6 above.
- `tech-architecture.md` §3 — `equippedGear` (jsonb: slot → itemId) added to the Loadout column group, since manual equip (Section 3, revised) needs somewhere to persist the player's actual per-slot choice, unlike the earlier auto-computed version.
- `raid-system.md` §1 — reserved 4th-raid row resolved to Forge Raid / Forge Seals (see delivered file).

**All applied:**

| Doc | Section | Edit needed |
|---|---|---|
| `gold-economy.md` | §7, §10, §11 | `SEAL_LADDER_GROWTH[gear] = 1.0011` set, with Gear added to the §7 Step 1 completion table at ~244,000 pulls — derived from its structure (36 items, 6/rarity, same Mythic bottleneck split as Skills), not assumed from size. | ✅ Applied |
| `tech-architecture.md` | §3 | `forgeLevel`/`forgePulls`, `forgeSeals`/`gearEssence`, `'gear'` added to the `hqCollection` system enum and the Seal-ladder counter map. | ✅ Applied |
| `gacha-shared-system.md`, `economy-and-currencies.md`, `core-progression-and-prestige.md`, `artifacts-dig-site-gacha.md`, `gold-economy.md`, `idea-backlog.md`, `tech-architecture.md` | throughout | The full "3 gachas → 4" sweep, incl. Forge Seals / Gear Essence added to the currency master list and Gear noted as the deliberate no-slot-track exception. | ✅ Applied |

---

## Implementation Note

Locked: The Forge as the 4th gacha, Hero-only (not party-wide), 6 fixed always-available slots (Weapon/Boots/Gauntlets/Charm/Armor/**Helmet**) mapping one-to-one onto the Hero's six stats PWR/SPD/IMP/LCK/VIT/DEF (revised — Weapon is now a flat PWR slot, no longer the "one dynamic slot," since STR/DEX/INT merged into PWR), exactly 1 item per slot per rarity (36 total, fully named by the rarity-epithet table alone — no authoring pass needed), single-stat-magnitude-only effects (no effect-line scaling), and a **manually-equipped** best-piece-per-slot with an upgrade indicator (revised from the earlier auto-equip proposal) — every other owned piece contributing a smaller passive bonus that mirrors `champions-guild-gacha.md` §7 (still the reason Gear flows into GPN automatically, though a player who ignores the indicator won't see it reflected until they act). A new **Rarity Progression Guarantee** (Section 2) locks the requirement that a scalar-50+ current-tier piece beats a scalar-1 next-tier piece, and a maxed (scalar-60) piece beats a scalar-10 next-tier piece — both reduce to "adjacent rarity multipliers must stay under a 6× ratio," which the reused Champions table already satisfies with wide margin (max ratio 1.25×). **Gear now sits as the 1st gacha overall**, revised from the earlier 2nd-place placement. `SLOT_BASE_BONUS` (×6) and `GEAR_PASSIVE_COEFFICIENT` join the tunable-constants registry. Placement, the equip-schema field, and the Forge Raid tie-in are applied directly this session; the Gold-ladder growth rate, the schema additions, and the project-wide "3→4 gachas" sweep are all now applied, per the table above.
