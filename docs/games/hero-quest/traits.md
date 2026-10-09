# Traits

Status: **Locked** — core structure confirmed this session. A handful of numeric constants and the paired raid's own specifics remain flagged for a later pass, same convention as `raid-system.md` and `loadouts.md` carrying flagged-but-unapplied items alongside a Locked status. Resolves idea backlog item 8.

## Structure recap

- **5 trait slots, fixed from account start** — no unlock progression, confirmed explicitly. First slot-based system in the project without one.
- Each slot, when rolled, independently generates a **Stat** (1 of 8, uniform) and a **Set** (1 of 5, uniform), plus a **Grade** (1 of 9, F→SSS — Traits' own dedicated scale, weighted per the Acquisition table). All three roll independently.
- Rolling costs **Trait Gems** — earned from **Trait Raid** (`raid-system.md` §1, Locked), a standalone `rampaging_boss` raid confirmed separate from item 3's (Passive Skill Tree) raid. That raid is now fully specified in its own doc: fight mechanic, level formula, reward formula, and Trait Keys entry gating.
- A slot can be **locked**, free and unlimited. **A single Roll action rerolls every currently-unlocked slot at once**, costing `5 + (locked slots × 5)` Trait Gems — 5 at minimum (nothing locked, full 5-slot reroll) up to 30 at maximum (everything locked).
- Traits are explicitly **not** captured by the Loadout system (`loadouts.md` §1) — they get their own dedicated save-slot track: starts at 1, expandable via Gems up to 4. Unlike Loadout save/apply (free & unlimited), storing or loading a Trait save slot costs Trait Gems.
- **Scope: party-wide.** Every trait effect and every Set bonus applies to the **whole fielded party** — Hero and all active Champions alike — not to the Hero alone. See Section 4a.

---

## 0. Scope — Party-Wide, Locked

**Locked, confirmed explicitly: Traits apply to the entire fielded party**, exactly like Artifacts (`artifacts-dig-site-gacha.md` §1) and unlike Skills/Gear (both Hero-only). Both halves of the system are covered:

- **The rolled Stat on each slot** (Section 4) buffs every fielded party member that has the relevant stat.
- **Set bonuses** (Section 5) apply party-wide too — "Main attack stat +10%" means every member's own main attack stat, "IMP +400%" means every member's IMP, and so on.

This is only possible because of the Champion stat-parity revision in `champions-guild-gacha.md` §2 — Champions carry the full PWR/SPD/LCK/IMP/VIT/DEF spread plus HP, identical to the Hero's since the Hero's own damage stats merged into PWR. Without that, most of this pool would have had nothing to attach to on the Champion side, the same gap that drove the Artifact revision.

**Resolution rule for the two Hero-flavored entries**, so party-wide doesn't create ambiguity:

| Trait stat | On the Hero | On a Champion |
|---|---|---|
| ATK | the Hero's PWR | that Champion's PWR |
| Hero Skill DMG | the Hero's own active skills | **no effect** — deliberately Hero-scoped by name and intent |
| Champion ATK | **no effect** | that Champion's PWR |
| SPD / LCK / IMP / HP(VIT) / EXP Gain | applies | applies |

Note this makes **ATK and Champion ATK partially overlap** — both now target the same stat, PWR; ATK hits everyone, Champion ATK hits Champions only. A party running both gets PWR on everyone plus a second Champion-only stack. That's intended: ATK is the broad roll, Champion ATK is the specialized one, and stacking both is a legitimately strong (and correspondingly lucky) board.

*(Worth a look during the balance pass now that the merge has happened: pre-merge these two rolls named different stats, so the overlap was partly disguised. It's now plainly two rolls on one stat, which makes the stacking more visible — and possibly stronger than intended if both land at high grade.)*

---

## 1. Slots — Fixed at 5, No Progression

**Locked, confirmed explicitly:** all 5 trait slots are available from account start — no unlock track, no prestige-shop line item, unlike Champion/Skill/Artifact/Gear equip slots or Loadout save slots (all progressive). A deliberate asymmetry, flagged plainly per this project's existing convention rather than treated as an inconsistency.

All 5 slots start empty. The first Roll action a player ever takes fills all 5 at once — nothing can be locked yet, since there's nothing rolled to protect.

---

## 2. Roll Mechanics

**Locked: three independent rolls per slot, per Roll action:**

1. **Stat type** — 1 of 8: ATK, SPD, HP, Champion ATK, Hero Skill DMG, LCK, IMP, EXP Gain (renamed from "Skill DMG" — see Section 4).
2. **Grade** — 1 of 9, via the Acquisition table below. Traits' own dedicated scale, deliberately separate from the project's existing 6-tier Common→Mythic gacha rarity — doesn't touch Champion/Skill/Artifact/Gear rarity at all.
3. **Set** — 1 of 5 (Section 5).

Confirmed independent — any Stat can land in any Set, at any Grade.

**Locked:** Stat and Set both roll uniformly — 1/8 per Stat, 1/5 per Set. Grade remains the only weighted axis, per the Acquisition table below.

**A single Roll action rerolls every currently-unlocked slot simultaneously** — this is the mechanical point of locking (Section 3): protect a good roll on one slot while gambling on the rest with one action, one currency spend, rather than 5 separate per-slot rolls.

**Locked: cost scales with how many slots are locked, not how many reroll:**

```
rollCost(locked) = 5 + locked × 5     // locked = 0..5, in Trait Gems
```

| Locked slots | 0 | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| Cost (Trait Gems) | 5 | 10 | 15 | 20 | 25 | 30 |

Counterintuitive at first glance — rerolling *fewer* slots costs *more* — but that's the deliberate shape: a full 5-slot reroll (nothing protected yet) is the cheap, broad gamble; protecting more of a good board and rerolling only the last slot or two is the expensive, surgical one. Pushes players toward committing early on broad rerolls and paying a premium once they're fine-tuning around a near-final board.

**Edge case:** at `locked = 5`, there's nothing left unlocked to actually reroll — the formula still returns 30, but the action would have no effect. Worth disabling the Roll button client-side once all 5 slots are locked, rather than letting the player pay for a no-op.

### Acquisition — Grade Probability (own dedicated scale)

| Grade | Rate |
|---|---|
| F | 19% |
| E | 37.7% |
| D | 28.3% |
| C | 9.5% |
| B | 4.7% |
| A | 0.5% |
| S | 0.2% |
| SS | 0.07% |
| SSS | 0.03% |

Sums to exactly 100% — transcribed directly, no adjustment needed.

---

## 3. Locking

**Locked:** any slot can be locked/unlocked freely, at no cost, any time outside combat — same "free and unlimited" convention already established for Skill/Artifact/Gear equip-swaps and Loadout save/apply. Locking a slot excludes it from the next Roll action; its current (Stat, Grade, Set, value) is untouched.

---

## 4. Stat Pool & Values

**Locked (one rename):** "Skill DMG" → **Hero Skill DMG** — scopes it explicitly to the Hero's own active skills only, not Champion abilities. Champion ATK (below) is the separate, already-distinct axis for party-wide Champion strength.

| Stat | Maps to |
|---|---|
| ATK | **PWR** — the Hero's single damage stat (`classes-and-combat.md` §2). Since Champions use the same stat name, this trait now reads identically on both sides |
| SPD | Hero's SPD |
| HP | Hero's VIT |
| LCK | Hero's LCK |
| IMP | Hero's IMP |
| Champion ATK | All Champions' PWR stat — **all four archetypes including Tank** (revised: Tank carries PWR too per `champions-guild-gacha.md` §2's stat-parity update; its DEF/VIT survivability layer is additional, not a substitute) |
| Hero Skill DMG | Hero's active skills only |
| EXP Gain | Generic XP-gain multiplier |

Transcribed directly from source, no adjustment:

### ATK
| Grade | % |
|---|---|
| SSS | 600% |
| SS | 300% |
| S | 150% |
| A | 100% |
| B | 70% |
| C | 50% |
| D | 35% |
| E | 25% |
| F | 10% |

### SPD
| Grade | % |
|---|---|
| SSS | 20% |
| SS | 15% |
| S | 10% |
| A | 8% |
| B | 6% |
| C | 4% |
| D | 3% |
| E | 2% |
| F | 1% |

### HP
| Grade | % |
|---|---|
| SSS | 100% |
| SS | 50% |
| S | 30% |
| A | 23% |
| B | 17% |
| C | 12% |
| D | 8% |
| E | 5% |
| F | 3% |

### Champion ATK
| Grade | % |
|---|---|
| SSS | 500% |
| SS | 300% |
| S | 150% |
| A | 100% |
| B | 70% |
| C | 50% |
| D | 35% |
| E | 25% |
| F | 10% |

### Hero Skill DMG (renamed from "Skill DMG")
| Grade | % |
|---|---|
| SSS | 600% |
| SS | 300% |
| S | 150% |
| A | 100% |
| B | 70% |
| C | 50% |
| D | 35% |
| E | 25% |
| F | 10% |

### LCK
| Grade | % |
|---|---|
| SSS | 10% |
| SS | 9% |
| S | 8% |
| A | 7% |
| B | 6% |
| C | 5% |
| D | 4% |
| E | 3% |
| F | 2% |

### IMP
| Grade | % |
|---|---|
| SSS | 750% |
| SS | 300% |
| S | 180% |
| A | 120% |
| B | 90% |
| C | 75% |
| D | 45% |
| E | 36% |
| F | 30% |

### EXP Gain
| Grade | % |
|---|---|
| SSS | 100% |
| SS | 50% |
| S | 40% |
| A | 30% |
| B | 22% |
| C | 16% |
| D | 11% |
| E | 7% |
| F | 4% |

---

## 5. Trait Sets

**Locked, with Back to Basics corrected** (transcribed as 3/5/5 — confirmed typo, corrected to **3/4/5**):

Each equipped trait carries a Set regardless of its Stat or Grade. A Set's bonus is evaluated by counting how many of the 5 equipped slots share that Set label — the Stat/Grade rolled on those slots doesn't matter for this count. **Set bonuses apply party-wide** (Section 0), same as the rolled stats themselves.

**The listed value at each piece-count is the total active bonus at that count, not an additive stack** — reaching a higher threshold replaces the lower one rather than adding to it (clear from the numbers themselves: Deep Impact's 400%→800%→1200% would be an absurd 2400% total if stacked). Multiple Sets can be simultaneously active if their respective minimum thresholds are independently met — e.g. 2 Deep Impact + 2 Aggression + 1 Vital Reflex, all active at once, since Deep Impact's floor is 1pc and Aggression's is 2pc.

Below a Set's minimum threshold: no bonus from that Set. Above its max threshold (e.g. a 5th Deep Impact piece, whose top tier is 3pc): the top tier's bonus simply continues — no further gain, no penalty.

| Set | Tiers (pieces → effect) |
|---|---|
| Vital Reflex | 1: HP & Evasion Rate +10% · 3: +25% · 5: +50% — *Evasion Rate is a real combat stat, see note below* |
| Divine Blessing | 1: Recovers 5% Max HP every second |
| Aggression | 2: Main attack stat +10% · 3: +20% · 4: +30% |
| Deep Impact | 1: IMP +400% · 2: +800% · 3: +1200% |
| Back to Basics | 3: Basic Attack DMG +50% · 4: +100% · 5: +200% |

### Note — Evasion Rate is a new combat stat

**Resolved:** Vital Reflex's "Evasion Rate" is not flavor text and not a rename of anything existing — it introduces **EVA**, a genuinely new stat, now specified in `classes-and-combat.md` §7 ("Accuracy & Evasion"). Summary of how it resolves:

- Simple accuracy check on every incoming attack: `hitChance = 1 − EVA_defender`. A miss deals 0 damage and rolls no crit.
- **Base EVA is 0 for every unit in the game** — no class node, Champion archetype, or enemy grants it innately. Traits are currently its only source, which makes Vital Reflex the only way to obtain it at all.
- Rolled per hit, independently, including for multi-strike kits. Offline settle applies it as a flat `× (1 − EVA)` on expected incoming damage rather than rolling, matching the crit-averaging convention.
- **Hard-capped at `MAX_EVASION = 0.60`** (locked) — total EVA from all sources. Deliberately set below the party-reachable ceiling of a 5-piece Vital Reflex board (+50%) so that **future EVA sources still have room to matter**; if the cap sat at Vital Reflex's own maximum, anything added later would be dead on arrival.
- Party-wide like every other trait effect (Section 0), so a 5-piece Vital Reflex board grants +50% EVA to the Hero *and* all fielded Champions — worth watching in balance, since it stacks multiplicatively with DEF mitigation rather than sharing a diminishing curve with it.

---

## 6. Save Slots

**Locked:** starts at 1 trait save slot, expandable via Gems up to 4 — 3 purchase levels. Explicitly separate from the Loadout system (`loadouts.md` §1), which doesn't capture Traits at all.

**Locked: flat +500 per level, not the doubling shape used elsewhere:**

| Level | 1→2 | 2→3 | 3→4 |
|---|---|---|---|
| Cost (Gems) | 250 | 750 | 1250 |

Worth flagging explicitly since it departs from the doubling-cost formula reused everywhere else short Gems-priced tracks appear (`loadouts.md` §3, and the Champion/Skill/Artifact/Gear 3-level slot tracks) — a linear arithmetic step (+500/level) instead of a multiplicative one. Deliberate call, noted here so it isn't mistaken for an inconsistency later.

**Locked:** unlike Loadout save/apply (free & unlimited), storing to or loading from a Trait save slot **costs 100 Trait Gems, flat, every time the button is pressed** — no discount for repeat use, no distinction between store and load pricing (both 100). For reference, that's more than 3× the priciest single Roll action (30 Trait Gems at 5 locked slots), making "bank a good board" a meaningfully bigger spend than "gamble on a reroll."

---

## 7. Relationship to Loadouts

**Locked, explicit exclusion:** Traits are never captured by a saved Loadout (`loadouts.md` §1's five components — Party/Formation/Skills/Artifacts/Gear — remain unchanged, no sixth component added). Applying a Loadout never touches the live Trait slots or which Trait save slot, if any, is currently loaded.

---

## Cross-Doc Edits

**Applied in this session:**
- `economy-and-currencies.md` §1, new §8 — Trait Gems added as a new custom currency, with the Roll-cost sink formula and a flagged-source note (see delivered file).
- `raid-system.md` §1 — Traits' standalone raid row updated to show the confirmed currency name (Trait Gems), raid name itself still TBD.
- `idea-backlog.md` item 8 — marked implemented.

**All applied:**

| Doc | Section | Edit | Status |
|---|---|---|---|
| `raid-system.md` | §1 | Raid named **Trait Raid**, assigned `rampaging_boss`, fully specified in §7. | ✅ Applied |
| `tech-architecture.md` | §3 | `hqTraitSlots` ×5 and `hqTraitSaveSlots` ×≤4 added, plus `traitGems` on `hqState` and the Gems-priced `traitSaveSlots` shop track. | ✅ Applied |
| `tech-architecture.md` | §5 | `trait/roll`, `trait/lock`, `trait/save`, `trait/load` routes added. | ✅ Applied |

---

## Implementation Note

**Revised in a later pass — three additions:** Traits are **party-wide**, applying to the Hero and every fielded Champion (new Section 0), made possible by Champions' stat-parity revision; **Evasion Rate (EVA)** is confirmed as a genuinely new combat stat rather than flavor, now specified in `classes-and-combat.md` §7 with a simple `1 − EVA` accuracy check, base 0 for all units, capped below 1.0, with Vital Reflex as its only current source; and **Champion ATK now covers all four archetypes including Tank**, correcting a carve-out written against the pre-parity Champion stat model.

Locked: 5 trait slots, fixed from account start (no progression — the first slot-based system in the project without one). Each slot's roll independently generates a Stat (1 of 8, uniform), a Grade (1 of 9 on Traits' own dedicated F→SSS scale, separate from Common→Mythic, weighted per the Acquisition table), and a Set (1 of 5, uniform). A single Roll action rerolls every unlocked slot at once, costing `5 + locked×5` **Trait Gems** (5 at zero locked, up to 30 at all five locked) — counterintuitively pricier the more you protect, by design, pushing broad rerolls early and paid precision later; locking itself is free and unlimited. Traits are explicitly excluded from the Loadout system and get their own save-slot track instead: 1→4 slots via Gems at **250/750/1250** (a flat +500/level step, deliberately breaking from the doubling shape used elsewhere), with store/load costing a flat **100 Trait Gems per press** each — over 3× the priciest Roll, making banking a board a bigger spend than gambling on one. "Skill DMG" renamed to "Hero Skill DMG" to scope it to the Hero only; Champion ATK scoped to non-Tank Champions' PWR. Set bonuses are total-at-threshold (not additive), multiple Sets can be simultaneously active, and Back to Basics' piece thresholds are corrected to 3/4/5 (was transcribed 3/5/5). Trait Gems is registered in `economy-and-currencies.md` as a new custom currency. No flags remain: Trait Raid is fully specified in `raid-system.md` (§1, §7), and the schema/route additions are applied in `tech-architecture.md` (§3, §5).

---

## As built — 2026-10-09

Built as `build-log.md` #51 records; what it left open is `open-items.md` #51. In short:

- **Every number above is in `constants.ts`** (`TRAIT_*`), the vocabulary in `content/traits.ts`, the rules in `shared/utils/hero-quest/traits.ts`. Nothing was added as `UNTUNED ╧`.
- **Readings this doc left open:** Vital Reflex's HP is VIT, as the HP stat is (§0); Aggression's main attack stat is PWR; Hero Skill DMG multiplies the damage of the Hero's own skills, not heals or shields; Back to Basics multiplies basic-attack damage; Divine Blessing heals once a second in a fight and counts as sustain in the idle rate.
- **Champion ATK reaches every Champion, Tank included** (§4). The Implementation Note's "non-Tank" sentence above is stale; recorded in `open-items.md` #51.
- **A Roll with all five locked is refused** server-side as well as disabled on the stage, so nobody pays 30 for nothing.
- **A save slot stores the locks** with the five slots, and a load restores them.
