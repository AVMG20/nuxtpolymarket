# Champions (Guild Gacha)

Status: **Locked** — decisions confirmed, ready to reference for implementation planning. See `gacha-shared-system.md` for the rarity/leveling/currency/duplicate mechanics, which apply identically across all 4 gachas; this doc covers only what's specific to Champions.

**Revision note:** Section 2's Champion stat-block was updated for full stat parity with the Hero to support the Artifacts/Dig-site gacha's party-wide effects (see `artifacts-dig-site-gacha.md`), and again once the Hero's STR/DEX/INT merged into PWR (`classes-and-combat.md` §2) — Hero and Champion now share one identical 6-stat set with no substitution layer at all.

## Structure recap
- **Party size is now variable, not fixed at 5.** Slot 1 = Hero + 2–5 Champion slots (Guild gacha), starting at 2 and growing to 5 via prestige-shop upgrades — see Section 1, "Party Slot Progression." Max party is Hero + 5 Champions = 6 total.
- **Hero and Champions are now fully separate systems.** The Hero stays on the 16-node class tree exactly as locked in the Combat doc, and gets no archetype tag. Champions never touch the class tree at all — they're built entirely from Archetype (Section 1) + Rarity (Section 2) + a unique name (Section 5) and unique ability kit (Section 6).

---

## 1. Roles & Archetypes

Every recruitable Champion is one of 4 archetypes — no class node involved:

| Archetype | Function |
|---|---|
| Damage | Primary function is direct damage output |
| Tank | Front-line mitigation / aggro draw |
| Support | Buffs, healing, shields for allies |
| Control | Debuffs, crowd control, battlefield disruption |

**Design intent:** gives the damage/utility mix you wanted — Damage and Tank lean combat-impact, Support and Control lean utility — as a clean, standalone system independent of the Hero's Warrior/Mage/Archer tree.

### Roster size — resolved

**Total roster: 48 unique Champions** — a flat **2 per archetype per rarity**:

| Rarity | Champions per archetype | Total this rarity |
|---|---|---|
| Common | 2 | 8 |
| Uncommon | 2 | 8 |
| Rare | 2 | 8 |
| Epic | 2 | 8 |
| Legendary | 2 | 8 |
| Mythic | 2 | 8 |

Flat across the board rather than weighted toward Epic — every archetype is fully available at every rarity regardless (a Common Tank is just as "real" a Tank as a Mythic one, only weaker per the Section 2 stat multiplier), and keeping it to 2 per slot means only 48 ability kits to author total. That's the real payoff: fewer unique abilities needed overall, so more design effort can go into making each Champion's kit an interesting *combination* (especially at Epic+, where multi-ability slots open up) rather than spreading thin across a big flat list of single-note effects.

### Party Slot Progression — new

Champion party slots are no longer fixed — they're a prestige-shop upgrade:

- **Starting party: 2 Champion slots** (Hero + 2 Champions = 3 total party members).
- **Maximum party: 5 Champion slots** (Hero + 5 Champions = 6 total party members), unlocked via prestige-shop purchases.
- That's **3 upgrade levels** to buy: 2→3, 3→4, 4→5 slots. Persists across prestige, same as any other prestige-shop purchase (Progression doc §3).

**Both previously-flagged cross-doc conflicts are now RESOLVED** (this section originally flagged them as open):

1. ~~Progression doc §4 has no Champion party-slot line item.~~ **Fixed** — `core-progression-and-prestige.md` §4 now lists Champion, Skill, and Artifact slots together under one 2-start/5-cap/3-purchase-level pattern.
2. ~~Combat doc's formation grid is undersized at max upgrade.~~ **Fixed** — `classes-and-combat.md` §6 is now a flat **3 front / 3 back** grid (6 positions, matching the maximum party), with rows treated as capacities rather than quotas so smaller parties can distribute freely. This also fixed a second problem the old front-2/back-(size−2) formula caused: a starting 3-person party had only 1 back slot while three of the four Champion archetypes default to Back (Section 8), making the default configuration unassignable.

---

## 2. Rarity, Stats & Abilities

Rarity uses the shared 6-tier system (`gacha-shared-system.md`, Section 1) — Common through Mythic.

**Base stats scale with rarity** (flat multiplier, tunable starting point):

| Rarity | Base stat multiplier |
|---|---|
| Common | 1.0x |
| Uncommon | 1.15x |
| Rare | 1.35x |
| Epic | 1.6x |
| Legendary | 2.0x |
| Mythic | 2.5x |

**Ability count scales with rarity:**

| Rarity | Abilities |
|---|---|
| Common / Uncommon / Rare | 1 |
| Epic / Legendary | 2 |
| Mythic | 3 |

**Each Champion is unique** — a distinct name plus a distinct ability (or ability combination, for Epic+) that differentiates it from every other Champion, even ones sharing the same archetype and rarity. Archetype sets the theme (a Support Champion's abilities should read as support-y regardless of rarity), rarity sets the count; the specific ability designs themselves are content.

**Champion stat-block — now full, exact parity with the Hero.** Champions carry the identical stat spread the Hero does: **PWR, SPD, LCK, IMP, VIT, DEF**, plus secondary HP. *(Revised twice: this section originally described PWR as a "deliberate substitution" for the Hero's class-locked STR/DEX/INT triplet. That triplet no longer exists — `classes-and-combat.md` §2 merged it into PWR, so there's nothing left to substitute. Hero and Champion now use the same six stat names, with no translation layer anywhere.)*

PWR is the single input driving every Champion's kit magnitude, across all 4 archetypes including Tank — Damage's damage, Support's heal/shield amount, Control's debuff potency/duration:

```
damage        = PWR × (1 - mitigation) × abilityMultiplier   (Damage kits)
healAmount    = PWR × abilityMultiplier                       (Support kits)
debuffPotency = PWR × abilityMultiplier                       (Control kits — magnitude and/or duration, per ability)
```

**Identical to the Hero's damage formula, not merely the same shape** (`classes-and-combat.md` §7) — same stat, same mitigation term, same structure. One damage formula for every unit in the game.

**Tank still leans on DEF/VIT for its own survivability numbers** (mitigation %, reflect %, etc., per its existing kit in Section 6) — that doesn't change. What's new is that Tank, like every other archetype, now *also* carries the full SPD/LCK/IMP/VIT/DEF spread instead of being the only archetype with anything beyond PWR.

**Why:** the old simplified block left gaps — non-Tank Champions had no DEF/VIT/HP at all, and no Champion had a SPD stat — which meant party-wide systems (the Artifact/Dig-site gacha, specifically) couldn't apply a Defense or Tempo effect to most of the roster. Full parity closes that gap.

**Knock-on effects worth stating explicitly, since they weren't true before:**
- **Champion abilities now crit-roll**, using the same LCK/IMP formula as the Hero (Combat doc §7) — Champions previously had no crit stats at all.
- **Champion ability cooldowns are now reduced by their own SPD**, exactly like Hero skills (Combat doc §3's universal SPD rule) — Champions previously had no SPD stat to hook into that rule.
- **Champion HP is now derived the same way as Hero HP:** `HP = BASE_HP + VIT × HP_PER_VIT` (Combat doc §7) — previously undefined for non-Tank Champions.
- **Champions are subject to the same Evasion check as the Hero** (Combat doc §7, "Accuracy & Evasion"). Base EVA is **0** for every Champion of every archetype, exactly as it is for every Hero class — Champions gain it only from party-wide sources, which today means the Vital Reflex trait set (`traits.md` §5). No archetype grants evasion innately; Tank's survivability identity stays expressed through DEF/VIT and its own kit, not through dodging.

PWR is still the thing that actually grows as a Champion levels via stars/dupes (Section 4); the rarity multiplier above is a flat, level-independent baseline on top of it.

**Two axes, and which is which — resolved.** This section used to say the other stats "scale with level the same way the Hero's do", which quietly conflated two different quantities: the Hero has an **uncapped XP level**, while a Champion has only the bounded `star × 10 + level` dupe scalar, which maxes at 60. A Champion cannot chase an exponential enemy curve on a bounded scalar, and because mitigation clamps at `DEF ≥ PWR × K`, one that falls behind contributes **exactly zero** rather than merely less — dead weight, not diminished weight. So:

```
championStat = statAtLevel(archetypeBase, heroLevel) × rarityMultiplier × investmentMultiplier(star × 10 + level)
```

The **Hero's level supplies the unbounded axis** — every Champion rides the Hero's own stat curve, so the party scales together and no member can be left behind by the curve. Rarity and dupe investment supply a **bounded multiplier the player earns**, which is what makes pulling and starring matter. Neither replaces the other.

Still unspecified, and owned by the Phase 2 content pass: the per-archetype base spread (there is no Champion equivalent of `classes-and-combat.md` §2's table), absolute base magnitudes, and how the 1→60 scalar converts to a multiplier (`CHAMPION_INVESTMENT_PER_POINT` is a placeholder). The *shape* above is what the math layer implements. Note the Section 7 Hero-facing passive is still a *separate* channel from this: PWR governs a Champion's own kit magnitude, while §7 governs what owning that Champion hands the Hero. They now happen to name the same stat for the Damage archetype, but they remain two distinct mechanics.

---

## 3. Recruitment

- **Currency:** Guild Seals. 1 pull = 1 Seal; a 10-pull = 9 Seals but still counts as 10 toward gacha leveling. Extra Seals are bought with Gold on a **per-gacha daily escalating ladder** — 1,000,000 Gold for the day's first purchase, rising with each further purchase that day (`gacha-shared-system.md` §4; full mechanics and `SEAL_LADDER_GROWTH[champion] = 1.2`, repriced 2026-10-04 in `gold-economy.md` §7). No longer a flat 1M each.
- Full leveling curve, drop-rate table, and the no-pity rule: see `gacha-shared-system.md`, Sections 2–5.

---

## 4. Leveling, Stars & Duplicates

Follows the shared formula (`gacha-shared-system.md`, Section 6) exactly: `dupesToLevelUp(x, y) = round(min((x×10+y) × 1.618, 20))`, items start at 0★, 10 levels per star, 5★ Lv10 = maxed, **1,066 dupes** total to fully max a Champion from scratch.

Post-max duplicates convert to **Champion Essence**, spendable via **Crafting** to directly obtain any specific Champion outright (same conversion/crafting tables as the shared doc). Note: the shared doc frames Crafting as picking "a chosen rarity," but that doesn't quite apply here — a Champion's rarity is fixed to its identity (Section 1), so crafting one just means crafting it at its own, already-fixed rarity.

---

## 5. Naming Convention

Template: **`<Given Name>, the <Rarity Epithet> <Archetype Title>`**

Given Name is pre-decided per Champion (authored content, decided ahead of time, not generated by this system) — this template just defines how the Rarity Epithet and Archetype Title attach onto it.

Rarity epithet ladder (one rung per rarity, reads at a glance alongside the existing rarity color-coding):

| Rarity | Epithet |
|---|---|
| Common | Novice |
| Uncommon | Adept |
| Rare | Veteran |
| Epic | Vanguard |
| Legendary | Exalted |
| Mythic | Ascendant |

Archetype title — a small pool of interchangeable nouns per archetype, so 12 Champions of the same archetype aren't all called the same thing:

| Archetype | Title pool |
|---|---|
| Damage | Blade, Reaver, Fury, Ravager |
| Tank | Bulwark, Aegis, Bastion, Guardian |
| Support | Sage, Anchor, Blessed, Warden |
| Control | Binder, Trickster, Weaver, Shade |

**Worked examples** (Given Names here are placeholders standing in for pre-decided names):

- Common Damage: **Rask, the Novice Blade**
- Uncommon Tank: **Borin, the Adept Bulwark**
- Rare Support: **Meret, the Veteran Sage**
- Epic Control: **Ilyx, the Vanguard Binder**
- Legendary Damage: **Kaira, the Exalted Reaver**
- Mythic Tank: **Thoraxx, the Ascendant Guardian**

---

## 6. Ability Design Guidelines

Since abilities are fully bespoke per Champion rather than inherited from a tree, here's the intended design space per archetype — a brief for whoever authors the actual 48-Champion ability list, not a fixed formula:

| Archetype | 1st ability (all rarities) should... | 2nd ability (Epic/Legendary) can... | 3rd ability (Mythic only) can... |
|---|---|---|---|
| Damage | Deal direct single-target or AoE damage — this is the non-negotiable core | Add a damage-amp condition (execute, stacking debuff, crit-fishing) | Add minor self-utility (cooldown reset, mobility) without diluting the damage identity |
| Tank | Draw aggro and/or mitigate incoming damage | Add a party-wide mitigation or reflect effect | Add a control tool (taunt-lock, knockback) |
| Support | Heal or shield an ally/the party | Add a buff (ATK%/SPD%/crit) on top of the heal/shield | Add a revive or cleanse — the strongest support tools reserved for Mythic |
| Control | Apply a debuff or disable to one or more enemies | Add a secondary CC (chain/spread the debuff) | Add a party-wide utility payoff (e.g. extend all active debuffs' duration) |

**Rule of thumb:** the first ability is always archetype-pure so a Champion reads correctly at a glance even at Common. Additional slots (Epic+) are where hybrid flavor comes in — a Damage Champion's 2nd ability can still feel distinct from another Damage Champion's 2nd ability even though both start from the same shared PWR stat (Section 2).

### Starting Ability Pool

**7 abilities per archetype (28 total)** — the 6 originals plus one addition each, sized specifically to cap reuse at 3 (see the math below). Every ability is independently valid as a Champion's sole ability (satisfies the "1st ability" rule above), which is what makes the mix-and-match work cleanly:

**Damage**

| Ability | Effect |
|---|---|
| Cleave | Melee AoE hit to the 2–3 frontmost enemies |
| Piercing Bolt | Single-target hit that also strikes whatever's directly behind it |
| Rising Flame | Burn (damage over time) on current target; re-application stacks |
| Execute Strike | Bonus damage that scales up the lower the target's HP% is |
| Volley | Hits 3 random enemies for smaller damage each |
| Focused Barrage | Several smaller hits on one target instead of one big hit — more crit rolls per cast |
| **Rupture** *(new)* | Deals damage immediately, then a second burst after a short delay |

**Tank**

| Ability | Effect |
|---|---|
| Provoke | Forces nearby enemies to prioritize this Tank for a short duration |
| Bulwark Stance | Temporary flat % damage reduction, self only |
| Guardian's Reflect | Temporary chance to reflect a portion of incoming damage back at the attacker |
| Rallying Shout | Brief party-wide % damage-reduction buff |
| Iron Skin | Each hit taken slightly raises this Tank's DEF for the rest of the fight |
| Ground Slam | AoE knockback/brief stun on nearby enemies |
| **Guardian's Vow** *(new)* | Redirects a portion of damage aimed at one chosen ally onto this Tank instead, for a duration |

**Support**

| Ability | Effect |
|---|---|
| Mending Light | Single-target heal |
| Sanctuary | Shield (damage absorb) on a single ally |
| Tide of Renewal | Small heal-over-time applied to the whole party |
| Empower | Buffs one ally's damage output for a duration |
| Haste Blessing | Buffs one ally's SPD (i.e. shortens its cooldowns) for a duration |
| Second Wind | Revives a fallen ally with partial HP |
| **Purify** *(new)* | Removes all debuffs from a target (or the whole party) and grants brief debuff immunity |

**Control**

| Ability | Effect |
|---|---|
| Weaken | Reduces target's damage output for a duration |
| Slow | Reduces target's SPD (lengthens its cooldowns) |
| Silence | Forces target's abilities into cooldown — they can't trigger for a duration |
| Shatter Armor | Reduces target's DEF for a duration |
| Chain Bind | Applies its debuff, with a chance to also spread it to a second nearby enemy |
| Unraveling Curse | Extends the remaining duration of all debuffs currently active on its target |
| **Frostbind** *(new)* | Stacking slow; at max stacks, fully disables (freezes) the target for a short duration |

*Purify* rounds out Support's Section 6 "revive or cleanse" guideline (Second Wind already covered revive), and *Rupture*/*Guardian's Vow*/*Frostbind* each open a mechanic the original 6 didn't have per archetype (delayed burst, single-ally protection, build-up-to-lockdown).

### Mixing into 12 Champions per archetype

The math this pool is built around: 12 Champions per archetype (2 per rarity × 6 rarities), needing 20 total ability-slot fills — 6 solo (Common/Uncommon/Rare), 8 across pairs (Epic/Legendary), 6 across triples (Mythic). With only 6 abilities, 6×3=18 falls short of 20, forcing at least 2 abilities to hit 4 uses no matter how the assignment is arranged — that's what happened to Execute Strike in the original example. Adding a 7th ability per archetype fixes exactly that:

- **20 total uses ÷ 7 abilities** — most even split is six abilities at 3 uses, one at 2. **Max reuse: 3.**
- **6 solo slots, 7 abilities available** — one ability sits out of the solo tier entirely, debuting only in Epic+ combos. Worth deliberately making that ability the new one each time (as below), so it doubles as a small "you haven't seen this before" hook at higher rarity, on top of fixing the reuse math.
- **4 pairs needed, 21 possible pairs from 7 abilities** (7 choose 2); **2 triples needed, 35 possible triples from 7** (7 choose 3) — even more room than before to avoid repetitive-feeling combos.

Reused instances can still optionally get their own name/flavor text per Champion (e.g. a Mythic-tier "Execute Strike" reskinned as "Merciless Execution") even though the underlying mechanic and formula are shared; power itself already scales through each Champion's own PWR stat combined with the rarity multiplier (Section 2), so no separate per-instance tuning is required unless you want the extra flavor.

**Worked example (Damage, illustrative only — not the final roster):**

| Rarity | Champion A | Champion B |
|---|---|---|
| Common | Cleave | Piercing Bolt |
| Uncommon | Rising Flame | Execute Strike |
| Rare | Volley | Focused Barrage |
| Epic | Rupture + Execute Strike (delayed burst into finisher) | Cleave + Volley (double-AoE nuker) |
| Legendary | Piercing Bolt + Focused Barrage (precision/crit-fishing) | Rupture + Rising Flame (layered damage-over-time) |
| Mythic | Cleave + Execute Strike + Volley (AoE opener into execute, with spread backup) | Piercing Bolt + Focused Barrage + Rising Flame (precision + sustained-burn generalist) |

Every ability here now appears exactly 3 times except **Rupture** (2, since it skipped the solo tier as intended) — no ability shows up on more than 3 Champions. Same method applies to Tank/Support/Control; full 48-Champion assignment (plus actual names, per Section 5) is the remaining piece saved for last.

---

## 7. Passive Collection Bonus (Champion → Hero)

Every recruited Champion grants the Hero a small **passive stat buff, whether or not that Champion is actually in the active party.** This is the collection layer: pulling and leveling Champions has value independent of which 2–5 you actually field, since fielding is meant to be driven by ability kits (Section 6), not by which stats you're farming.

**Archetype → Hero stat mapping:**

| Archetype | Hero stat(s) buffed | Note |
|---|---|---|
| Tank | DEF, VIT | Matches Tank's own survivability stats (Section 2) |
| Damage | PWR | **Asymmetry resolved.** This row previously buffed all three of STR/DEX/INT and was flagged as a deliberate exception. With the Hero's damage stats merged into PWR (`classes-and-combat.md` §2), it collapses to a single clean stat like every other row — no exception left to flag. |
| Support | IMP, LCK | Crit-flavored passive, independent of Support's own heal/shield-flavored kit |
| Control | SPD | Tempo-flavored passive, independent of Control's own debuff-flavored kit |

**Clean coverage, no exceptions:** the Hero's 6 stats are covered as **2 / 1 / 2 / 1** — Tank grants DEF+VIT, Damage grants PWR, Support grants IMP+LCK, Control grants SPD. Every stat is covered exactly once, and no archetype needs a special case.

**Scaling:** buff strength scales with that specific copy's **star rating and level** — reusing the same `(star × 10 + level)` scalar already used as the input to `dupesToLevelUp` in `gacha-shared-system.md` §6, rather than inventing a separate curve. One consistent "how strong is this specific copy" number across leveling, dupes, and this passive.

**Design intent:** the passive is the incentive to pull broadly and level everything you own; ability kits (Section 6) are the incentive to actually field specific Champions. These are two separate reward loops by design — a maxed Damage Champion sitting in the barracks still meaningfully strengthens the Hero even if its kit never sees combat.

---

## 8. Targeting & Formation

Combat doc §6–7 assigns front/back-row defaults and autoattack-targeting logic per class-tree path (Warrior→lowest-HP%, Archer→highest-power-stat, etc.). This section defines the equivalent for Champions, per archetype instead of per path — confirmed.

**1. Formation default**

| Archetype | Default row (Front / Back) |
|---|---|
| Damage | Back |
| Tank | Front |
| Support | Back |
| Control | Back |

Only Tank defaults front-row — mirrors the Hero tree's Warrior-line-front / everything-else-back split, and matches Tank's stated job (front-line mitigation/aggro draw, Section 1).

**2. Autoattack targeting**

| Archetype | Autoattack target | Threat/aggro modifier? (Y/N — magnitude if Y) |
|---|---|---|
| Damage | Highest-power-stat enemy | N |
| Tank | Lowest-HP% enemy | Y — high (primary aggro anchor for the party) |
| Support | Lowest-HP% ally | N |
| Control | Highest-power-stat enemy | N |

Tank reuses the old Warrior-path pattern (lowest-HP% enemy + strong threat pull) almost exactly, since it's filling the same niche. Damage and Control both default to highest-power-stat enemy (the Archer-path pattern — focus the biggest threat) since, unlike Mage/Archer in the Hero tree, they don't need to be differentiated from each other by target choice; their kits (damage vs. CC) already make them feel distinct in play. Support is the one genuinely new case — its autoattack targets the neediest ally rather than an enemy at all, matching its buff/heal/shield identity (Section 1).

**3. Ability-driven exceptions**

> Default: yes, same precedent as the Mage path in the Combat doc. The targeting above only governs the plain autoattack — any ability whose design calls for something else (AoE, party-wide, chain, ally-targeted) overrides it whenever that ability fires. Given the Section 6 ability guidelines already lean heavily on AoE/party-wide effects (Tank's party-wide mitigation, Support's buffs, Control's secondary CC), this will apply often, not as a rare exception.

**4. Enemy-side targeting**

> Default: carries over unchanged — front row first, back row only once the front row is empty or fully dead (`classes-and-combat.md` §6 — an empty front row is a legal configuration on the 3/3 grid), or via attacks explicitly tagged AoE/backline-piercing. Tank's "something extra" is just its threat modifier from item 2 above (a strong pull rather than a separate new mechanic) — no additional rule needed on top of the existing front-row-first behavior.
>
> **Clarification on manual repositioning:** since all slots remain manually reassignable (item 5), a Tank *can* be placed in back row — but its threat modifier only re-weights targeting among units the front-row-first rule has already made eligible; it doesn't override eligibility itself. So a backlined Tank's taunt is inert while front row still stands, and only becomes live again once back row becomes targetable (front row wiped, or an AoE/backline-piercing attack). This means putting a Tank in back row costs it its entire purpose, exactly as it intuitively should — not a broken or exploitable interaction, just a clearly bad build choice the player is free to make.

**5. Anything else**

> Default: no hard restrictions. All rows above are defaults only — per the Combat doc, "all slots remain manually reassignable regardless of class," and that freedom is assumed to carry over to Champions unchanged (e.g. a player *can* put a Support in front row if they want to, it's just not the suggested default).

---

## Implementation Note

No open levers remain in this doc's own scope — every Champion-specific system (roster size, naming, stat model, ability pool, passives, targeting/formation, party slot progression) is decided. The actual 48-Champion roster — specific names per Section 5's template, specific ability combinations drawn from Section 6's 28-ability pool — is intentionally left to implementation rather than authored here. Section 6's worked Damage example is the reference to build the other 47 against: same method (6 solo, 4 pairs, 2 triples, reuse capped at 3 per ability) applies identically to Tank, Support, and Control.

**Previously-flagged cross-doc items are now closed:** Section 1's two flags (a missing prestige-shop line item in the Progression doc, and an undersized formation grid in the Combat doc) have both been applied in their respective docs — see Section 1 for the current status.
