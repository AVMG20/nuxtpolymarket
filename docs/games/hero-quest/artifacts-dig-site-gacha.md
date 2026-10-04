# Artifacts (Dig-site Gacha)

Status: **Locked** — decisions confirmed, ready to reference for implementation planning. See `gacha-shared-system.md` for the rarity/leveling/currency/duplicate mechanics, which apply identically across all 3 gachas; this doc covers only what's specific to Artifacts.

## Structure recap
- In-game name: **Dig-site**. One of the **4 gachas** — Forge (Gear), Guild (Champions), Training Grounds (Skills), Dig-site (Artifacts). Sits **4th in tab order** (`tech-architecture.md` §7).
- See `gacha-shared-system.md` for rarity tiers, gacha leveling, drop rates, no-pity rule, and duplicate/star/crafting mechanics — all inherited identically. This doc covers only what's Artifact-specific.
- **Locked:** Artifacts are **passive-only, party-wide** equipment — every equipped Artifact's effect applies to the whole fielded party (Hero + all active Champions), not just the Hero.
- **Locked:** currency names — **Excavation Seals** (pull currency), **Artifact Essence** (crafting currency).

---

## 1. Party-wide, Passive-Only — Locked

| System | Scope | Flavor |
|---|---|---|
| Champions | Party members themselves | Active kits, combat roles |
| Skills | Hero only, equipped loadout | Active + passive, universal |
| **Artifacts** | **Whole party, equipped loadout** | **Passive only** |

No actives, no cooldowns, no buttons — every Artifact is a pure passive modifier.

**Unequipped Artifacts still count, a little (added 2026-09-15).** Every owned Artifact not in a slot gives **the Hero only** `ARTIFACT_COLLECTION_PASSIVE_FRACTION` (0.1, untuned) of its combat-stat lines — the six stats, max HP, crit chance, crit damage — at its own rarity and investment, mirroring Gear's unequipped passive. It is Hero-only, unlike an equipped Artifact, so a wide collection is not multiplied by party size; economy, cooldown and utility lines stay slot-only. Previously an unequipped Artifact contributed nothing. Champions, Skills, and Artifacts each now have a distinct job: Champions are the party members, Skills are the Hero's own active/passive loadout, Artifacts are party-wide passive gear.

Making this actually work required a change to `champions-guild-gacha.md` §2: Champions carry full stat parity with the Hero (PWR, SPD, LCK, IMP, VIT, DEF, plus HP — and since the Hero's STR/DEX/INT merged into PWR, that parity is now exact rather than a substitution). That closes the two gaps flagged in the last draft — non-Tank Champions had no DEF/VIT, and no Champion had SPD — so every Artifact category below now applies cleanly to the whole roster, not just Tank.

---

## 2. Effect Categories

Four categories, each a stat *domain* rather than a combat *role* — deliberately not a re-skin of Champion archetypes, so the two systems read as different lenses on the party:

| Category | Domain | Hero-side stat | Champion-side stat |
|---|---|---|---|
| **Offense** | Damage output | PWR | PWR |
| **Defense** | Survivability | DEF, VIT | DEF, VIT |
| **Tempo** | Speed / uptime | SPD (reduces cooldowns, Combat doc §3) | SPD (reduces cooldowns, same rule) |
| **Fortune** | Economy | Gold/XP gain%, offline-efficiency% | Same — party-wide by nature, not per-unit |

**Clean 1:1 mapping on all four rows, and now identical *names* on all four too** — the Offense row previously read "STR/DEX/INT per class" on the Hero side against "PWR" on the Champion side; with the Hero's damage stats merged into PWR (`classes-and-combat.md` §2), both columns simply say PWR. Full Hero/Champion naming parity across every category for the first time. Fortune stacks with existing economy levers (Skill passives, prestige-shop Gold%/offline%) rather than replacing them, same "layered, not siloed" call already made in the Skills doc for the same reason.

---

## 3. Roster, Rarity & Effect Pools

**Roster size** mirrors Champions exactly — 2 per category per rarity:

| Rarity | Artifacts per category | Total this rarity |
|---|---|---|
| Common | 2 | 8 |
| Uncommon | 2 | 8 |
| Rare | 2 | 8 |
| Epic | 2 | 8 |
| Legendary | 2 | 8 |
| Mythic | 2 | 8 |

**Total roster: 48**, same as Champions.

**Effect-line count scales with rarity** — identical pattern to Champions' ability count and Skills' effect-line count:

| Rarity | Effect lines |
|---|---|
| Common / Uncommon / Rare | 1 |
| Epic / Legendary | 2 |
| Mythic | 3 |

**Pool sizing — updated with today's additions.** Still 12 Artifacts per category needing 20 total effect-line fills (6 solo + 8 across Epic/Legendary pairs + 6 across Mythic triples) — that math doesn't change. Pool size per category is no longer uniform now that Offense and Tempo each picked up 2 new effects and Defense picked up 1:

| Category | Pool size | Max reuse to hit 20 fills |
|---|---|---|
| Offense | 9 | 3 (e.g. 2 effects × 3 uses + 7 × 2 uses = 20) |
| Defense | 8 | 3 (e.g. 4 × 3 + 4 × 2 = 20) |
| Tempo | 9 | 3 (same split as Offense) |
| Fortune | 7 (unchanged) | 3 (6 × 3 + 1 × 2 = 20, as before) |

With bigger pools, the earlier "hold one effect back from the solo tier" trick isn't mathematically required anymore — that was specifically there to stretch a 7-effect pool across 20 fills. Worth keeping as a flavor device for one or two of today's new adds anyway (a fresh effect debuting at Epic+ is a nice hook), but it's now a choice, not a constraint.

Here's the full pool for all four categories — this is the part you wanted to look at before locking:

### Offense

| Effect | Shape |
|---|---|
| Might Surge | Flat +% party PWR |
| Precision Edge | +% party crit chance |
| Killing Blow | +% party crit damage |
| Momentum | PWR buff that ramps the longer the current fight runs |
| Opening Strike | Burst of bonus PWR at fight start, decaying over time |
| Last Stand | PWR buff that grows the fewer party members remain alive |
| **Shattering Blow** *(new — Epic+ debut)* | Chance on any party hit to apply a stacking armor-shred debuff |
| Defense Penetration | Flat/% ignore of enemy DEF on all party damage — an always-on modifier to the damage calc itself, distinct from Shattering Blow's proc-based DEF *debuff* on the enemy |
| Cull | Bonus damage to enemies below a HP% threshold *(renamed from "Execute" — too close to the Champion Damage ability "Execute Strike")* |

### Defense

| Effect | Shape |
|---|---|
| Iron Ward | Flat +% party DEF |
| Vital Bloom | +% party max HP |
| Deflection | Chance to further reduce incoming hit damage on top of normal mitigation |
| Steady Ground | DEF buff that ramps the longer the current fight runs |
| Bulwark's Legacy | Flat damage reduction on the first hit any party member takes each fight |
| Guardian's Echo | Small heal-over-time triggered whenever any party member drops below a HP threshold |
| **Unbroken** *(new — Epic+ debut)* | Once per fight, prevents a killing blow from dropping a party member below 1 HP |
| Crit Resistance | Reduced chance to be crit, and/or reduced crit damage taken — mirrors Offense's Precision Edge/Killing Blow back onto the defensive side, which nothing previously answered |

### Tempo

| Effect | Shape |
|---|---|
| Swift Current | Flat +% party SPD |
| Quickening | All cooldowns start each fight partially pre-charged |
| Flow State | SPD buff that ramps the longer the current fight runs |
| Alacrity Surge | Burst of +SPD at fight start, decaying over time |
| Overdrive | SPD buff that grows the fewer party members remain alive |
| Slipstream | Small chance, on any skill's cooldown completing, to shave time off another random near-ready cooldown *(renamed from "Second Wind" — collided exactly with the Champion Support ability of that name, which revives a fallen ally, `champions-guild-gacha.md` §6)* |
| **Chain Reaction** *(new — Epic+ debut)* | Landing a crit has a chance to instantly refresh part of the cooldown on that unit's next-soonest skill |
| Double Cast | Small chance any skill fires an immediate second activation — a true extra trigger, distinct from Chain Reaction's cooldown refund |
| Unshaken | Reduces the duration of stuns/silences/freezes and other disables applied to the party — nothing currently touches CC uptime at all |

### Fortune

| Effect | Shape |
|---|---|
| Prospector's Fortune | Flat +% Gold gain |
| Scholar's Boon | Flat +% XP gain |
| Night Owl | Flat +% offline-efficiency |
| Lucky Dig | Chance on kill for a bonus Gold burst |
| Quick Study | Chance on kill for a bonus XP burst |
| Compound Interest | Gold gain% that ramps the longer the current fight runs |
| **Windfall** *(new — Epic+ debut)* | On stage clear, small chance to instantly grant a Gold burst worth a few minutes of current income |

**Design principle (new): buffs should always relate to combat.** This is why Seeker's Luck (a flat reroll on gacha drop rarity — a proposed 8th Fortune effect) was cut rather than added: nothing about it happens *in* a fight. Flagging how I'm reading that principle against Fortune's existing effects, since on paper they're economic rather than combat-stat effects: all of them still trigger *through* combat — Gold%/XP% multiply rewards from kills, Lucky Dig/Quick Study proc on kills specifically, Compound Interest ramps during a fight, and offline-efficiency is idle combat continuing to resolve while you're away. None of them touch the gacha/meta layer directly the way Seeker's Luck did — that's the line I'm drawing. Worth a quick confirm that's the distinction you meant, since it'll govern what gets waved through if more Fortune effects come up later.

**Reuse ceiling: no effect appears on more than 3 of its category's 12 Artifacts.** *(Corrected — this line previously read "every effect appears exactly 3 times except each category's new entry." That was only ever true for Fortune, whose 7-effect pool needs 6×3 + 1×2 = 20. With the larger pools it's arithmetically impossible: Offense/Tempo at 9 effects would need 8×3 + 1×2 = 26 fills against a budget of 20, and Defense at 8 would need 23. The correct statement is the ceiling, not a fixed count — the per-category splits in the table above are the real distributions.)* Same spirit as the Champions Section 6 worked example, which does hit an even 3-per-effect because its pool is exactly 7. Actual per-Artifact rarity assignment (which 2 effects pair at Epic/Legendary, which 3 at Mythic) and Artifact names are left to implementation, same deferral as Champions' full 48-roster.

**Design principle (added later): keep Gold-granting bonuses small.** Gold is the platform's persistent, global currency — it isn't run-scoped and carries across every prestige. Any effect that grants it directly, whether a one-time burst (Lucky Dig, Windfall) or an ongoing %-rate increase (Prospector's Fortune, Compound Interest), should stay conservative relative to normal earn rates. A run-scoped currency can absorb a generous bonus without lasting consequence; Gold compounds forever, so it can't. **Resolved concretely in `gold-economy.md` §6 (Locked):** one-time bursts should be denominated as a duration of current income (e.g. "worth ~5–10 minutes of income," rarity-scaled) rather than a fixed amount or a raw scale off enemy value — this keeps every burst correctly sized at every point on the curve automatically, with no per-stage or per-prestige retuning ever needed, and keeps them consistent with Gold's own bounded curve rather than the unbounded `enemyMultiplier` (which Windfall's original wording accidentally referenced — corrected above). Same principle added to `skills-gacha.md`'s economy effects, since several of those grant Gold too.

---

## 3a. The Roster — **named 2026-09-15**

Names were left to implementation (§3) and are now authored: **relics dug out of the ten worlds** (`core-progression-and-prestige.md` §5). Commons are frontier odds and ends from Thornwick Vale and Mirewood; a relic that belonged to a world's boss or super boss sits higher than that world's rank-and-file; every Mythic comes from Duskspire (World 6) or deeper. Each name points at what its effects do. The effect *assignment* is still the shared distribution table in `content/artifacts.ts`, unchanged.

No rarity epithet in the name — the collection card shows rarity as colour and label. Names are unique (§4), never repeat a pool effect's name, and never reuse a Champion given name or title; all three are asserted in `content.spec.ts`. IDs (`artifact_offense_0` …) are what saves reference, so a rename never touches one.

| Rarity | Offense | Defense | Tempo | Fortune |
|---|---|---|---|---|
| Common | Goblin Cudgel — *Might Surge* | Hedgeknight Buckler — *Iron Ward* | Bramblefoot Sandals — *Swift Current* | Thornwick Copper — *Prospector's Fortune* |
| Common | Tracker's Flint — *Precision Edge* | Mireroot Charm — *Vital Bloom* | Marsh Hourglass — *Quickening* | Hedge-Witch Almanac — *Scholar's Boon* |
| Uncommon | Slagjaw's Tooth — *Killing Blow* | Cinderscale Shard — *Deflection* | Ashwalker Anklet — *Flow State* | Mirewood Night Lantern — *Night Owl* |
| Uncommon | Frostbound War Drum — *Momentum* | Rimeholt Hearthstone — *Steady Ground* | Frostbite Horn — *Alacrity Surge* | Kobold Prospecting Pick — *Lucky Dig* |
| Rare | Dawnbreak Arrowhead — *Opening Strike* | Tideglass Pendant — *Bulwark's Legacy* | Sailor's Distress Bell — *Overdrive* | Rimeholt Saga Stone — *Quick Study* |
| Rare | Last Legion Standard — *Last Stand* | Mother Leech's Vial — *Guardian's Echo* | Acolyte's Prayer Beads — *Slipstream* | Amarath Tide Ledger — *Compound Interest* |
| Epic | Hrimgar's Icebreaker — *Might Surge, Shattering Blow* | Grave Marshal's Pauldron — *Iron Ward, Unbroken* | Halvane's Spellglass — *Swift Current, Chain Reaction* | Sunken Doubloon — *Prospector's Fortune, Windfall* |
| Epic | Eye of Pyrrhax — *Precision Edge, Killing Blow* | Rotheart Barkshield — *Vital Bloom, Deflection* | Korr's Marching Drum — *Quickening, Flow State* | Duskspire Star Chart — *Scholar's Boon, Night Owl* |
| Legendary | Stormcrown Talon — *Momentum, Shattering Blow* | Glacier Titan's Heart — *Steady Ground, Unbroken* | Skyshard Prism — *Alacrity Surge, Chain Reaction* | Grave Robber's Spade — *Lucky Dig, Windfall* |
| Legendary | Banner of the Bonefields — *Opening Strike, Last Stand* | Maerith's Pearl — *Bulwark's Legacy, Guardian's Echo* | Zephyrax Wingbone — *Overdrive, Slipstream* | Tome of Unfinished Lessons — *Quick Study, Compound Interest* |
| Mythic | Ithren's Burning Sigil — *Might Surge, Precision Edge, Killing Blow* | Ossuar's Bone Mantle — *Iron Ward, Vital Bloom, Deflection* | Lodestone of the Brink — *Swift Current, Quickening, Flow State* | Hoard of the Shattered Sky — *Prospector's Fortune, Scholar's Boon, Night Owl* |
| Mythic | Key to the Last Door — *Momentum, Opening Strike, Last Stand* | Vesper's Forgotten Hymn — *Steady Ground, Bulwark's Legacy, Guardian's Echo* | Herald's Stopped Clock — *Alacrity Surge, Overdrive, Slipstream* | Last Coin of the Void — *Lucky Dig, Quick Study, Compound Interest* |

---

## 4. Stacking Rules — Locked

- Each Artifact is a single unique owned instance, same ownership model as Champions/Skills — you can't own or equip two copies of the same named Artifact.
- **Different Artifacts that share a category stack additively.** Equipping two Offense Artifacts adds both bonuses together.
- **No cap on how many equipped Artifacts can share one category** — confirmed allowed. A player can run 5 Offense Artifacts at once if they want to.
- **No set bonuses.** Removed from this system — noted that you want to apply a similar mechanic (multi-piece bonuses for owning a themed group) somewhere else instead, so it's off the table here specifically, not shelved as "maybe later" within Artifacts.

---

## 5. Excavation — Currency & Rates

Fully inherited from `gacha-shared-system.md`, same as the other two gachas:

- **Currency:** **Excavation Seals** (pull) / **Artifact Essence** (crafting) — locked.
- 1 pull = 1 Seal; 10-pull = 9 Seals, still counts as 10 toward leveling. Extra Seals are bought with Gold on a **per-gacha daily escalating ladder** — 1,000,000 Gold for the day's first purchase, rising with each further purchase that day (§4; full mechanics and `SEAL_LADDER_GROWTH[artifact] = 1.2`, repriced 2026-10-04 in `gold-economy.md` §7). No longer a flat 1M each.
- **Gacha leveling:** same 1→10 curve, same pulls-to-level-up table (§2) — levels independently of Guild/Training Grounds progress.
- **Drop rates:** identical shared per-level table (§3) — same odds as Champions and Skills at the same gacha level.
- **No pity** (§5) — every dupe has a use via Section 6 below.

---

## 6. Leveling & Upgrading

Fully inherited from `gacha-shared-system.md` §6, no deviation:

- `dupesToLevelUp(x, y) = round(min((x×10+y) × 1.618, 20))`, 0★–5★ × Lv1–10, **1,066 dupes** to fully max one Artifact from scratch.
- **What grows:** each Artifact's effect-line magnitude(s) scale with the same `(star × 10 + level)` scalar already reused for Champion leveling and the Champion passive (Champions doc §7) — one consistent scaling number, now extended to a third system.
- **Post-max duplicates** convert to **Artifact Essence**, spendable via Crafting for a full RNG bypass on a specific chosen Artifact, same 5×-per-rarity value/cost table as the shared doc.
- Same caveat as Champions: an Artifact's rarity is fixed to its identity, so Crafting means crafting that specific Artifact at its own already-fixed rarity, not a free rarity choice.

---

## 7. Slot Progression — what unlocks the 3rd/5th slot

Answers the Progression doc's §4 "awaits that gacha's own doc" note directly:

- **Starting: 2 Artifact slots.**
- **Maximum: 5 Artifact slots**, via **3 permanent prestige-shop purchase levels** — 2→3, 3→4, 4→5 — identical pattern to Champion party slots and Skill slots.
- Each level is a one-time permanent unlock, purchased with prestige currency, persists across prestige (`core-progression-and-prestige.md` §3–4).
- **Equip rules:** a slot holds one Artifact; swapping equipped Artifacts is free and unlimited outside combat, same loadout-level freedom as Skills §5.

With this, all three *slot-based* collectible systems (Champions, Skills, Artifacts) have a fully-specified 2-start/5-cap/3-purchase-level progression. **Gear is the deliberate exception** — all 6 Forge slots are available from account start with no unlock track at all (`gear-equipment.md` §1), since they map to Hero stats that exist from day one rather than to a party/loadout size that grows.

---

## Implementation Note

Everything in this doc reflects decisions confirmed across this conversation: party-wide/passive-only scope (with the matching stat-parity update to `champions-guild-gacha.md` §2), the 4 effect categories and their Hero/Champion stat mapping, the 48-Artifact roster size (2 per category per rarity), the 33-effect base pool across the 4 categories (Offense 9 / Defense 8 / Tempo 9 / Fortune 7), a max-reuse ceiling of 3 per effect, uncapped same-category stacking, no set bonuses, the Excavation Seals/Artifact Essence currency names, and the 2→5 slot progression mirroring Champions/Skills.

The effect pool (Section 3) is a complete first-pass draft, not a final authored list — same spirit as the Skills roster: names, exact magnitudes, and the specific per-Artifact rarity assignments (which effects pair at Epic/Legendary, which trio at Mythic) are left to your fine-tuning pass and to implementation, respectively. *(Artifact names were authored 2026-09-15 — §3a.)*

**One general design principle from this doc is also now reflected in `skills-gacha.md`**: Gold-granting effects should stay small, given Gold's persistent, global-currency status — that applies project-wide, not to Artifacts alone. The "buffs should relate to combat" principle (used here to rule out Seeker's Luck) stays scoped to this doc for now; Skills' existing economy effects already satisfy it without needing a correction.
