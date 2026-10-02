# Hero Quest — build log

**What landed, and why it was done that way.** Split out of `open-items.md` on 2026-09-17, which
had grown to 604 lines of which most was history. That doc now holds only what still needs
attention; this one holds the record.

**Item numbers are the originals and are never reused.** Eleven docs, `constants.ts` and two
scripts cite them (`#22`, `#23.3`, `#18.6`), so renumbering would silently repoint a reference.
Numbers missing here are items still open — they stayed in `open-items.md` under the same number.
Four entries (#22, #23, #25, #29) appear in **both**: the full record is here, and the part still
needing attention stayed there. Numbering runs to **#35**; open-items.md says where the next new item starts.

**This is not on the per-task reading list** (`CLAUDE.md` §1). Read an entry when you need the
reasoning behind something already built; do not load it to find out what to do next.

**Where a decision here overrides a locked system doc, `open-items.md` carries the one-line
precedence record** and points back here for the detail — precedence has to live in the doc that
is always read.

---

### 4. ~~Three small asset follow-ups from `asset-list.md`~~ — **decided 2026-09-17**
- **Champion skins (48): fuller per-rarity redesign**, not recolors of a shared silhouette — more ornate armour and effects at Epic+, layered on the archetype chassis. The expensive option, taken because the reveal is a gacha's whole reward loop and 48 recolors would undercut it. Chassis (4) and animation sets (20) unchanged.
- **Training Grounds Actives (18): yes, custom VFX per ability**, same treatment as Hero and Champion abilities — they share the cooldown and auto-fire behaviour, so a shared VFX set would make a pulled Skill look like a reskin of something already owned. **Ability VFX sets go 44 → 62.** The 18 Passives need nothing; they have no cast moment.
- **Artifact procs: silent, numeric log only.** No flash, no popup. Artifacts are passive-only everywhere else, and six chance-based effects firing during an unwatched idle fight would be noise rather than feedback.

Applied to `asset-list.md` §1.2, §2.1, §2.3, its follow-ups section and its production-volume table.

---

### 5. ~~World naming still hasn't closed the loop with Void Shards~~ — **closed 2026-09-15**
The naming pass (#6) kept World 10 as **The Void**, so Void Shards keeps its name and its lore tie. `worlds.spec.ts` still asserts it.

*(The `tech-architecture.md` schema-catch-up item that used to be here — Gear/Loadouts/Traits/Holidays missing tables and routes — is **done**. All four now have full schema, routes, and content modules in `tech-architecture.md` §3, §5, §2. The `SEAL_LADDER_GROWTH[gear]` gap is also **resolved** — set to `1.0011`, derived from Gear's roster shape matching Skills', in `gold-economy.md` §7.)*

---

### 8. Alternative enemy-scaling formula (backlog item 9) — **applied, see #10**
Resolved together with #10: the continuous `b^n` curve is now the implemented one. The shape is settled; only `b` is still a tuning value.

---

### 10. The new enemy curve — implemented, values still tuning
The parked continuous `b^n` curve is **built and shipped** in `settle.enemyMultiplier()`, with `core-progression-and-prestige.md` §1 rewritten to match. The boss HP softening landed alongside it, harder than the ×4–6 that was in flight: **×3 trash HP for the Stage 5 boss, ×6 for the super boss**, both now expressed against trash rather than the super boss compounding off the boss.

Authored as a **per-stage** base rather than the per-100-stage `T`, because `T` is a five-digit number for any sane per-stage value and nobody can slide it by feel. `ENEMY_STEP_BASE = 1.08` is the dial; `ENEMY_CURVE_T = b^100 ≈ 2,200` is derived.

Three things this decided that were not previously written down anywhere:

1. **No prestige difficulty reset.** One continuous index cannot hold both a per-run ramp and a smaller per-prestige jump — they are the same number. The old curve's ×0.021 dip at prestige (and ×0.455 dip at *every world boundary* — it was a sawtooth, which nobody had noticed) is gone. `ENEMY_PRESTIGE_STEP_MULT` restores it if wanted.
2. **XP now rides the same index** at `XP_STEP_EXPONENT` relative growth, so XP/second no longer decays with depth. The old three-base XP curve sat at an effective exponent of ≈0.45 against the enemy curve, meaning farming got strictly worse the deeper you went.
3. **Boss gates, not the wave ramp, are the intended wall** — a gate against a fixed timer is a pure DPS check, and party DPS is what Champions add.

~~Still open here: `b` itself, `XP_STEP_EXPONENT`, and the boss multipliers are all playtest starting points (`// UNTUNED ╧`).~~ **Tuned in #22.** `ENEMY_STEP_BASE = 1.08` and the boss multipliers (now ×7 / ×9) are `// TUNED ✓`; `XP_STEP_EXPONENT` is derived. World & Enemy Design (#6) owns names, rosters and kits, not these values — unless a kit changes fight length.

That session also referenced "the world doc's §3 difficulty table," implying a worlds document that isn't currently in this project.

---

### 11. Consequences of pooled mitigation and geometric stat growth — **new, from the Phase 1 math pass**

Mitigation is now pooled across the fielded party (`classes-and-combat.md` §7) and Hero stats grow geometrically against the enemy curve (`core-progression-and-prestige.md` §1). Five things surfaced here. **Four are now resolved** and are kept struck-through rather than deleted, because each records a decision and the reasoning behind it; only #3 is still open.

1. ~~**`HqStatBlock` is `number`, not Decimal.**~~ **Resolved — converted.** `HqStatBlock` is now `Record<HqStatKey, Decimal>`, so the float ceiling at hero level ~10,400 is gone (verified finite at level 1,000,000). `UnitStats.spd` and `UnitStats.critMultiplier` moved with it, since SPD and IMP are both unbounded; `critChance` stayed a `number` because it is a probability clamped to [0, 1], and `attacksPerSecond` stayed a `number` because its formula clamps at both ends. Authored class deltas stay plain numbers via the new `HqStatDelta` type — content is converted once, at `baseSpreadFor`, rather than 16 content rows wrapping every entry in `D()`.
2. ~~**Champions add exactly zero survivability.**~~ **Resolved at the Phase 2 kickoff — positional aggro via formation.** The survivability model summed incoming damage *and* HP across the party, so time-to-die was party-size-invariant and the Tank archetype had no mechanical function. Rejected alternatives: pooled party DEF (symmetric with `partyMitigation`, but makes party size a survivability stat, which `combat.ts` refuses by design) and shipping Tank as a stat spread only.

   What this locks: **enemy single-target attacks resolve against the front row and only fall through to the back row when the front is empty or dead** (`classes-and-combat.md` §6, `champions-guild-gacha.md` §8.4 — both already specify exactly this; the model simply never implemented it). Time-to-die therefore stops being party-size-invariant, and a Tank earns its keep by *standing in front*, with no new stat and no new pooling rule. A back-lined Tank's threat modifier stays inert while the front row stands, per §8.4's clarification.

   Consequence for `settle.ts`: `incomingDps` can no longer sum across the whole party. It resolves against the front row, which means the wave-survivability model now reads formation — the first time run position and loadout interact.
3. ~~**DPS is quadratic in the stat curve.**~~ **Resolved in #22 — built into the pacing model rather than fought.** `critMultiplier` scales linearly with IMP while damage scales with PWR, so both compound; that is now `DPS_STAT_EXPONENT = 2`, and enemy HP is set against it (`ENEMY_HP_STEP_EXPONENT`). LCK was taken **off** the level curve, which removes it from the exponent and stops every class reaching 100% crit on a schedule. Crit damage per point was cut 0.05 → 0.02. What remains: below the attack-rate cap SPD still scales, so the true exponent is nearer 3 early and levels there are worth somewhat more than the constant says — a known wrinkle, not a problem so far.

4. ~~**Prestige-shop stat multiplier scope is still undefined**~~ **Resolved by removing the upgrade.** Rather than answer Hero-only vs party-wide, the global stat multiplier is **cut from the prestige shop entirely** — the question only existed because the sink lists named an upgrade nobody had specified, and it was never built (`SHOP_TRACKS` has only Offline Efficiency, Offline Cap and Champion Slots). Struck from the sink lists in `core-progression-and-prestige.md` §4 and `economy-and-currencies.md` §4, from the shop table in `tech-architecture.md` §3, and from the GPN inputs in `global-power-number.md` §3.

   ~~**What this leaves open:** it was one of the multiplicative sources expected to fill the `STAT_PACE_RATIO` shortfall.~~ **Moot since #22** — levels now keep pace with the enemy curve by construction, so no multiplicative source is needed to close a pace gap; the gachas move walls instead. Void Shards keep their remaining sinks (slots, offline tracks, kill-count reduction, boss-timer extension, Raid Keys).
5. ~~**Clamped mitigation bottoms out at exactly zero damage.**~~ **Resolved — `MIN_DAMAGE` is the new floor.** A hard zero made every wall in the game an *absolute* wall: the campaign sim reported `STALLED (0 dmg)` at essentially every elite stage, with no partial progress and no way to tell a near-miss from a hopeless one. Damage now floors at `MIN_DAMAGE = 1` in `rawHitDamage`, mirrored in `partyDps` and `fight.rollDamage`.

   The floor is **symmetric and guarded**: an over-armoured party takes chip damage too, so nothing is immortal any more, but an attacker with **zero PWR still deals zero** — `MIN_DAMAGE` is a floor on what *mitigation* may reduce a hit to, not a guarantee that every swing hurts. Without that guard "immune" would stop being expressible anywhere in the model.

   **What it changed, and what it deliberately did not.** Wall *positions* are unmoved: the campaign sim reports the same 4 prestiges, the same level 1,821, the same grind wall at P4 W10S6. Against an enemy with exponential HP, 1 damage per hit is not a route through. What changed is the *character* of a wall — the sim now reports `WIPE` where it reported `STALLED (0 dmg)`, because an outmatched party dies rather than standing immortal dealing nothing, and a wave wipe restarts the same stage without losing ground. Walls are slow, not sealed. Whether that reads better in play is on the playtest watchlist.

---

### 12. Champion abilities — **framework built, effects still placeholder**

Champion abilities were authored in the Phase 2 content pass but never reached combat: `fight.ts` built skill timers only for party index 0, so a Mythic's three abilities and a Common's one were both worth exactly nothing. The plumbing is now in — `ChampionSnapshot.abilities` (required, so an omission is a type error rather than silently inert Champions) and a per-unit kit list in `fight.ts`, the Hero's accumulated down the class path and each Champion's fixed by its rarity.

**What did not land, and is the actual open item:** the effects. Every ability in the game — 16 class skills, plus the 18 Champion abilities the 12-Champion roster currently reaches out of a 28-strong pool — still resolves as single-target damage on the shared `SKILL_BASE_COOLDOWN_SECONDS` / `SKILL_BASE_ABILITY_MULTIPLIER` pair. No doc assigns a magnitude, cooldown or targeting rule to any of them, so this is a content pass waiting to happen, not an implementation gap. Slotting real effects in requires no further change to the firing model.

Four consequences, none of them resolved:

1. **Ability count is now a real rarity payoff**, stacking multiplicatively on `RARITY_STAT_MULTIPLIER`. That is the intended shape (`champions-guild-gacha.md` §2 grants 1/1/1/2/2/3 by rarity) but the two have never been balanced against each other — see the playtest watchlist at the end of this doc.
2. **The boss-vs-wave damage gap widened roughly threefold.** `settle.ts` has no skill term at all, so a boss gate is fought with strictly more damage than the wave rate on screen implies. A full party of six now brings up to 19 skills to a gate — a Master-tier Hero's four plus five Mythics' three each — and still none to the idle rate. Since boss gates are the intended wall (#10.3) and `SKILL_BASE_ABILITY_MULTIPLIER` is untuned, the gates may now be *softer* than the grind wall standing in front of them — which would invert the intended difficulty shape.
3. **Champion SPD shortens that Champion's own cooldowns**, so a Mythic Damage Champion cycles its kit faster than the Hero standing beside it. Emergent from `cooldownFor` and the rarity multiplier rather than designed, and it makes ability *throughput* a third rarity payoff on top of stats and slot count.
4. **Support and Control still have no mechanical identity.** Tank earned one from positional aggro (#11.2), but a Support's Mending Light and a Control's Silence currently deal single-target damage exactly like a Damage Champion's Cleave. Two of the four archetypes are therefore stat spreads with flavour text until the effects pass lands — which makes archetype choice much shallower than the roster implies.

**Scheduling — revised, and now underway.** The ability-effects pass is **pulled forward out of Phase 5** on the strength of point 4, and has started. It runs as five checkpointed stages: (1) enemy packs, (2) status + threat engine, (3) the effects themselves, (4) a settle approximation, (5) the full 48-Champion roster. Stage 1 has landed — see #13.

---

### 13. Enemy packs — **landed, Stage 1 of the effects pass**

Combat was single-enemy everywhere: `EnemyStats` was one record, and a wave stage was 30 sequential solo kills. That left roughly ten abilities across both rosters ("AoE hit to the 2–3 frontmost enemies", "hits 3 random enemies", "chain to a second nearby enemy", "chains between enemies", "hit multiple targets") with **nothing to hit**, and the Tank's threat modifier with nothing to re-weight. It also contradicted the targeting rules, which select *among* enemies — "lowest-HP% enemy", "highest-PWR enemy" are meaningless against a set of one.

`EnemyPack` is now a list of individually addressable members. `EnemyStats` is unchanged and still means "one enemy's stats" — it was never a claim about how many there are — which is why `combat.ts` and `fight.ts` took **zero diff**. Bosses are always a pack of one, so `runFight` is untouched.

**A "kill" is still one enemy, not one encounter.** `BASE_KILL_COUNT = 30` is 30 bodies that now arrive in bursts of N. That choice is what leaves `goldPerKill`, `xpPerKill`, `MIN_SECONDS_PER_KILL`, `GOLD_PRESTIGE_CAP` and `PRESTIGE_GOLD_FACTOR[]` untouched, and what lets the persisted `hq_state.kill_count` keep its meaning with **no migration**.

**Packs cost nothing on the offense axis, by construction.** Against a homogeneous pack both the HP fought through and the bodies it buys scale by N, so `secondsPerKill = (N×hp)/(N×dps) = hp/dps` — algebraically identical at any size. Verified: the campaign report is byte-identical before and after, and identical again at pack sizes 1, 2 and 3.

**All of the difficulty lands on survivability**, which is the axis front rows, Tanks and AoE actually care about. N enemies focus the front-most living defender (spreading them would re-create #11.2 — N bodies bringing N× HP *and* soaking N× streams makes time-to-die party-size-invariant again). The live-attacker count thins as a pack dies, modelled as a time-average so `secondsToDie` stays closed-form — settle is rate math, never a tick loop. Measured: survivability scales by exactly `1/streams(N)` to ten decimal places.

**Sizes: six per wave and elite encounter, so a stage is five clean packs** — 6 divides `BASE_KILL_COUNT` exactly, and a size that does not would leave the last pack of every stage a ragged remainder. **Bosses stand with an escort** of `BOSS_MINION_COUNT` trash minions, drawn from the same curve index at the *wave* stat layer, so a minion is an ordinary mob of that depth rather than a shrunken boss. Escort first, boss last — the order `rawSecondsPerPack` sums and `runFight` focuses, which is what keeps the projection and the fight agreeing.

`runFight` did **not** stay at zero diff once bosses gained an escort. It now resolves a list of enemies, each with its own HP and its own attack timer, mitigation is recomputed per target (pooling enemy DEF would make each body individually harder to hurt), and `FightEvent` gained `enemyIndex`. `FightResult` gained `enemyMaxHps` — per body, because a mixed pack cannot be reconstructed by dividing the total, and without it the replay's HP bar jumps *up* when the party finishes a minion and turns to the boss.

**Three consequences, all real and none of them bugs:**

1. **The first boss no longer passes on arrival.** World 1 Stage 5 went from 29.6s against a 30s timer to **49.3s — a FAIL**. The escort is HP the timer has to cover, so the opening gate now needs a few levels of farming first. `BOSS_MINION_COUNT` and `BOSS_TIMER_SECONDS` are the levers.
2. **An early wave wipe wall appeared.** At six attackers per encounter (`streams(6) = 3.5`) a level-1 Hero wipes on World 1 Stage 2, and the natural levelling curve does not outrun elites until roughly level 35. It self-resolves — a wave wipe restarts the stage while income continues — but it is a felt change for a new account.
3. **The campaign barely notices.** Solo still reaches 2 prestiges at level 1,025 and a party of five still reaches 4 at level 1,821, same walls, ~4h more grind for the solo run across 3½ days. Survivability is not what binds the run at depth; DPS is.

New placeholders: `WAVE_PACK_SIZE = 6`, `ELITE_PACK_SIZE = 6`, `BOSS_MINION_COUNT = 2`, `PACK_LIVE_STREAM_FRACTION = 0.5`, all `// UNTUNED ╧`.

---

### 14. Status and threat engine — **landed, Stage 2 of the effects pass**

The infrastructure every ability effect needs, built with **no ability using it yet** — which is the point of the ordering: the engine gets tested on its own terms before content depends on it, and the campaign report is byte-identical to Stage 1 because nothing applies a status.

**The rules are decisions, not transcriptions.** No doc defines a status system while both rosters assume one; Unraveling Curse ("extends the remaining duration of all debuffs currently active on its target") settles it, since that can only be written against a queryable, mutable, per-unit registry. Every rule — stacking-and-refresh, refresh-to-longer, the fixed `STATUS_TICK_SECONDS` grid, multiplicative order-independent stat modifiers, shields absorbing *after* mitigation, silence-vs-stun, cleanse acting on hostile kinds only, resistance cutting duration rather than chance — is now written up in `classes-and-combat.md` §7 with the reasoning, so a later change argues with a stated rule instead of discovering an implicit one.

Two are worth repeating here because they are easy to get wrong later:

- **The periodic grid is not the combat tick.** Paying DoTs per `FIGHT_TICK_SECONDS` would tie every effect's strength to the simulator's resolution — halving the tick would halve every burn.
- **Shields sit behind mitigation, not in front of it.** In front, a fully-shielded unit takes literally nothing, which quietly restores the immortality `MIN_DAMAGE` was introduced to remove.

**Threat closes the last piece of #11.2.** Tank earned its keep by standing in front; it now also *pulls*. Row remains eligibility and threat sorts only within it, so §8.4's "a back-lined Tank's taunt is inert while the front row stands" falls out of the model rather than needing a special case. Ties are stable, so a party with no aggro anchor targets exactly as before — which is why all 262 pre-existing specs stayed green.

New placeholders: `STATUS_MAX_STACKS = 5`, `STATUS_TICK_SECONDS = 1`, `TANK_THREAT_MULTIPLIER = 3`, `TAUNT_THREAT_MULTIPLIER = 10`, all `// UNTUNED ╧`. `BASE_THREAT = 1` is the baseline, not a tuning value.

~~**Known gap, closing in Stage 3:**~~ **Closed.** The engine's wiring into `runFight` is now tested through the real path, because abilities apply statuses — see #15.

---

### 15. Ability effects — **landed, Stage 3 of the effects pass**

Every ability in the game now does what its description says. Before this, all 44 resolved as single-target damage on one shared multiplier, which is what left two of four Champion archetypes with no mechanical identity.

**The enemy grid was a prerequisite nobody had written down.** Four of the seven newly-specified class skills are stated in terms of enemy *position* — "all enemies in a row", "the front column", "each spot" — and `EnemyPack` was a flat list with no geometry. Enemies now occupy the same 3-wide, two-deep grid the party does, derived from index and pack size alone (`enemyPosition`). It lands correctly at both sizes that matter without a special case: a six-strong wave pack splits 3/3, and a boss encounter puts its two minions in front with the boss behind them — **the escort screens its boss for free**, which was not designed, just fell out.

**Where the two halves came from is recorded per ability, deliberately.** The 28 Champion abilities are transcribed from `champions-guild-gacha.md` §6, which describes each one; the doc's own wording is quoted above each entry. Nine class skills had a one-clause hint. **Seven had nothing but a name in a tree diagram** and were specified during this pass — each carries a comment saying so, because "the doc said this" and "we decided this" must not become indistinguishable later. The `effects.spec.ts` assertions for those seven *are* their specification; there is no doc to check them against.

**Approximations, stated rather than hidden.** Six clauses need machinery that does not exist, and each is rendered as the nearest honest thing with a comment saying what was dropped:

| Ability | Clause | Rendered as |
|---|---|---|
| ~~Frostbind~~ | ~~"at max stacks, fully disables"~~ | **Built in full** — see below |
| Iron Skin | "each hit taken raises DEF" | Stacking DEF buff on cast; needs an on-hit trigger |
| Guardian's Reflect, Chain Bind | "a chance to…" | Always-on; a proc roll would add variance on top of crit for no gain |
| Volley | "3 random enemies" | The front line — random selection would need the fight RNG inside the pure resolver |
| Rupture | "a second burst after a short delay" | A short, heavy DoT; no scheduled-event queue exists |
| Disciple, Man's Best Friend, Raise Dead | summons | Their *contribution* (party healing, a self buff) |

**Frostbind is complete.** The freeze is a **stack threshold**, added as a generic `escalation` on `AbilityEffect` rather than a Frostbind branch — "build a debuff, then it does something worse" is an obvious shape for later content to reuse. Two independent dials: `FROSTBIND_STACKS_PER_CAST` sets how fast the slow builds, `FROSTBIND_FREEZE_STACKS` how deep it must get. The threshold is checked against the stacks actually on the target after each application, so the freeze fires on whichever cast crosses the line however many casts that takes — not "on the last application" — and setting the threshold above `STATUS_MAX_STACKS` disables the freeze without touching the slow.

**Summons are settled, not deferred.** Disciple, Man's Best Friend and Raise Dead render as their contribution rather than as spawned units, and that is the intended model: they expire rather than persisting, so no unit lifecycle is needed. Removed from the open list.

**Still open:** Totem Storm and Raise Dead are described only as affecting "the party or battlefield" (§7), deliberately ambiguous between the two. Both were resolved as the party reading. **Deferred to playtest** — revisited once the game has a visual and there is play data, rather than decided on paper.

**A design consequence worth knowing:** utility abilities deal no damage at all — Support and Control now route through §2's `healAmount` and `debuffPotency` shapes rather than the damage formula, which is exactly what makes them distinct. That meant every ability firing needed to emit a `skill` event even at zero damage, or a replay would show a buff appearing with nothing having cast it.

New placeholders, all `// UNTUNED ╧`: the `SKILL_*` magnitude set (AoE, pierce and line multipliers, status durations, buff/debuff fractions, heal/shield/DoT/HoT multipliers), `ENRAGE_*`, `KILL_SHOT_CRIT_MULTIPLIER`, `EXECUTE_BONUS`, `FOCUSED_BARRAGE_HITS`, `REVIVE_HP_FRACTION`. `HASTE_SPD_BONUS = 1.0` is **not** untuned — a doubling is the one ability magnitude any doc actually states.

---

### 16. Ability effects reach the idle rate — **landed, Stage 4 of the effects pass**

`settle.ts` had **zero** skill references, so every effect built in Stage 3 was invisible during the ~97% of playtime that is idle wave farming. `projection.ts` closes that: each effect collapses to a scalar via `uptime = min(1, duration / cooldown)` and a coverage fraction for how much of a pack it reaches. Nothing iterates time — settle is one frozen rate per window, and a 72-hour offline settle still resolves in constant time.

**Applied by rewriting the inputs, not the formulas.** A buffed party is simply a stronger party (`buffedUnits`) and a shredded pack a softer one (`debuffedPack`), so pooled mitigation and everything downstream pick the change up without learning that buffs exist. `rateAt(hero, position)` is the single helper `settle()`, the campaign sim and the specs all share — an earlier version had each assemble the pipeline itself and they drifted immediately, with one spec measuring a party the game does not field.

**The tolerance spec found two real model bugs**, which is what it was for:

1. **`partyAbilityDps` applied the `MIN_DAMAGE` floor before the ability multiplier**, where `rawHitDamage` and `fight.rollDamage` apply it after. That paid `MIN_DAMAGE × multiplier` for a fully-mitigated ability and inflated every kit whose damage sat near the floor.
2. **Pierce coverage assumed every column is two deep.** A six-strong pack is three columns of two, but a three-body boss encounter is one column of two and one of one — and the boss encounter is precisely where pierce abilities get measured.

**The band is asymmetric, and the asymmetry is measured rather than asserted.** Under-promising is held to 30%; over-promising is allowed 70% for one quantified reason: an ability cannot fire at t=0, so a finite fight lands `floor(T / C)` casts where the steady-state rate prices `T / C`. A 6-second fight gets one cast against a projected 1.7. That is a **finite-window artifact that vanishes over the hours `settle` actually resolves** — at one hour the same cooldown loses under a percent — and a spec pins the explanation so the band rests on evidence.

**Consequences:** the solo campaign run drops from 3d 18h to 3d 13h, entirely from Haste's SPD buff finally raising the idle attack rate — the one doc-specified ability magnitude, worth nothing to the idle rate until now. The sim's stand-in Champions also gained one ability each: they previously carried none on the grounds that settle had no skill term, which stopped being true here and would have understated every real party.

New placeholder: `MAX_SUSTAIN_MITIGATION = 0.9` — the most of an incoming wave party healing may cancel in the projection. Not a combat rule; `fight.ts` resolves heals for real. It exists because the averaged model would otherwise let one Support drive incoming damage to zero and make the party immortal, restoring exactly what `MIN_DAMAGE` was introduced to remove, in the one place no fight would ever contradict it.

---

### 17. The full 48-Champion roster — **landed, Stage 5 of the effects pass**

All 48 exist: two per archetype per rarity across all six rarities, the complete roster §1 describes. This **deliberately overrides** `docs/hero-quest/CLAUDE.md` §6, which said Champion names were deferred by design and told implementers not to generate them; that guidance has been updated rather than left to contradict the code.

**Assembled from two tables, not written out.** `ROSTER` holds names and titles; `ABILITY_SLOTS` holds the ability draws, shared by all four archetypes. That makes the three structural rules — ability count per rarity, the ≤3 reuse cap, and variety within a rarity — consequences of one distribution rather than 48 separate chances to break one. Title pools expanded from 4 to 12 per archetype, since four cannot name twelve Champions.

**The twelve Phase 2 Champions keep their id, rarity and title**, so existing collection rows stay valid — `hqCollection` references `contentId` and nothing else. Only their ability draws moved, and those are not persisted. All four Phase 2 Commons happen to keep their original ability exactly.

**The distribution serves the stated goal: variety within a rarity, overlap across rarities.** Every rarity's pair is disjoint, and the six abilities appearing at Common/Uncommon/Rare are *exactly* the six the two Mythics carry — so nothing a low-rarity Champion does is missing from the top of the ladder. Counter-intuitively this is why the pool stayed at **7 with a cap of 3**: expanding it would work *against* the overlap goal, because a Common's one ability would be less likely to reappear on anything Mythic.

**A genuine tension, surfaced rather than reconciled.** §6's design table tiers abilities by rarity — a Support's revive and cleanse are described as the *third* ability a Mythic gets. That cannot hold at the same time as the two goals above: a 7-ability pool capped at 3 uses cannot put the basics on low rarities, mirror the low set onto the Mythics, *and* reserve the exotic abilities for high rarities. The arithmetic runs out. The overlap goal won, so a Rare Champion does draw from the back half of the pool — Second Wind, a revive, sits on a Rare. **The levers are the pool size and the reuse cap**, and moving either is a design call rather than an implementation one.

**`foldToAvailableRarity` is retired from the Champion path.** It existed because a partial roster left better than half of all rolls at gacha level 7+ naming a rarity with nothing in it. With all six populated it is the identity function — the exact condition its own docstring named for removal — so `championFromRoll` and the Guild serializer stopped calling it rather than passing an always-true predicate. The helper itself stays in `gacha.ts` for Gear, Skills and Artifacts, whose rosters are still partial; it is deleted outright when the last of those completes. A spec asserts every rarity is populated, so the claim "the fold is unnecessary" is tested rather than commented.

---

### 18. Phase 3 — the remaining three gachas and Loadouts — **landed**

Gear (Forge), Skills (Training Grounds), Artifacts (Dig-site) and Loadouts §1–3 are built. Seven things it decided that were not written down anywhere, listed because each is a judgement call rather than a transcription.

**1. `foldToAvailableRarity` is deleted, not merely unused.** All four rosters now populate all six rarities — Champions 48, Gear 36, Skills 36, Artifacts 48 — which made it the identity function everywhere. `content.spec.ts` asserts the coverage per system, so the claim is tested rather than commented, and the *reasoning* (why rounding down was the right repair for a partial roster) is preserved as a comment where the helper used to live.

**2. ~~The Artifact roster ships with placeholder names~~ — named 2026-09-15 (`artifacts-dig-site-gacha.md` §3a), overriding the earlier "do not generate 48 names" guidance.** The Dig-site needs content to roll, and shipping partial would have kept every other gacha paying for content this one had not authored. They first shipped as a placeholder title pool plus the rarity epithet (`ARTIFACT_TITLES`), replaced by authored names in `ARTIFACT_NAMES`. The per-Artifact effect assignment is a shared distribution table, not 48 authored choices, so it is equally re-cuttable.

**3. Three routes replaced twelve.** `gacha/pull`, `gacha/craft` and `gacha/buy-seals` each take `system` in the body per `tech-architecture.md` §5, and the Phase 2 `guild/*` copies were retired. `guild/party.post.ts` became `loadout/set.post.ts`, which sets any of the five loadout components — party, formation, Skills, Artifacts, Gear — because a formation is only valid against a specific party, and once a route has to take two together it may as well take the set a Loadout is *defined* as. `loadout/apply` then runs a saved preset through the identical validator, which is what keeps §1's "never goes stale" promise honest instead of assumed.

**4. Passive modifiers are one vocabulary for three systems.** Gear bonuses, Skill passives and Artifact effects all do the same job — always-on adjustments with no cooldown — so `modifiers.ts` defines one `HqModifier` kind set and each content module declares against it. What differs is **scope**, and only scope: Gear and Skills reach the Hero, Artifacts reach the whole fielded party. Stacking is additive throughout, per `artifacts-dig-site-gacha.md` §4 and `gold-economy.md` §5.

**5. Six effects are approximations, stated rather than hidden** — the same convention #15 established. Ramping-over-a-fight buffs (Momentum, Steady Ground, Flow State, Compound Interest) are rendered flat, because the idle rate is one frozen average per window and has no "later in the fight". On-kill and once-per-fight procs (Lucky Dig, Windfall, Unbroken, Bulwark's Legacy) become rates, since the model counts kills per hour. Three Skill clauses that refund or reset a cooldown become a permanently shorter one. Each carries a comment naming what was dropped.

**6. Two things are declared and inert, honestly.** `controlResist` (Artifacts' Unshaken, Skills' Unbreakable Will and Immortal Vanguard) has nothing to resist: `EnemyStats` is HP/PWR/DEF and enemies have no abilities, so nothing applies control to the party. It goes live the day enemy kits do, and was left pointing at what it *means* rather than re-pointed at a stat that happens to be wired up. Separately, `reflect` was the reverse case — **it turned out `fight.ts` had never resolved the reflect status at all**, so Guardian's Reflect had been inert since the effects pass. Wiring the passive line closed that gap for both.

**7. Skill copies now scale with investment — the one gap this phase found and then closed.** Artifact magnitudes scale with the `(star × 10 + level)` scalar because §6 says so; Skills did not, because `skills-gacha.md` never says they do. That left a levelled Skill copy worth **literally nothing** beyond the duplicates it consumed — not a design anyone chose, just a gap between two docs. `SKILL_POTENCY_PER_POINT` closes it on the terms the rest of the project already uses.

The shape is `championInvestmentMultiplier`'s — **identity at minimum** — not `artifactLineMagnitude`'s proportional curve, and the difference is the whole decision. Artifact magnitudes are proportional to the scalar (a fresh copy is 1/60th of a maxed one), which works there because §6 states that scaling and the per-point base is sized to match. Skills are authored as *complete* qualitative bands in §4 — "small", "medium", "large" — so a proportional curve would make a freshly-pulled Mythic 1/60th of its own described strength and silently rewrite the doc's ladder. At 0★/Lv1 potency is exactly 1.0, so §4 stays the reference point and levelling multiplies up from there: ×2.18 at 5★/Lv10 on the placeholder.

What scales is **magnitudes only** — the damage multiplier, heals, shields, status strengths, Gold/XP bursts — via `scaleEffect`, which is explicit about the exclusions and why. Durations, cooldowns, hit counts and stack thresholds do not: a longer buff is a different effect from a stronger one, the idle projection already prices a status at `duration / cooldown` uptime so scaling both would double-count, and scaling Frostbind's freeze threshold would make a levelled copy *slower* to freeze. Cadence stays SPD's job and Tempo's.

New placeholders, all `// UNTUNED ╧`: `SLOT_BASE_BONUS` (×6), `GEAR_PASSIVE_COEFFICIENT`, `SKILL_PASSIVE_MAGNITUDE[]`, `SKILL_ECONOMY_COEFFICIENT`, `GOLD_BURST_MINUTES[]`, `GOLD_BURST_COOLDOWN_SECONDS`, `SKILL_COOLDOWN_REFUND_FRACTION`, `WEALTH_FACTOR_MIN/MAX`, `WEALTH_NEUTRAL_HOURS`, `SKILL_POTENCY_PER_POINT`, `ARTIFACT_EFFECT_PER_POINT`, `ARTIFACT_ECONOMY_COEFFICIENT`, `SKILL_SLOT_BASE_COST`/`_GROWTH`, `ARTIFACT_SLOT_BASE_COST`/`_GROWTH`, `LOADOUT_SLOT_BASE_COST_GEMS`.

**Deferred out of the phase, deliberately:** `global-power-number.md` (Phase 3 only makes it *computable*; Phase 4's Traits is where its EVA term goes live) and `loadouts.md` §4's per-raid auto-apply, which has no caller until `raid/engage` exists and whose one real guarantee — the swap completing before Trait Raid's unconditional Key debit — can only be tested against a real raid route.

---

### 19. The playtest harness — **landed, and it unblocks the whole tuning list**

`server/utils/hero-quest-dev.ts` plus five routes under `server/api/hero-quest/dev/` and a `Dev` tab that only exists in development builds.

**Why it was built before Phase 4.** `implementation-plan.md` Phase 1 ends with "stop here and actually play it before continuing", and that had been deferred through two whole phases. The obstacle was never willingness — the campaign sim puts two prestiges at three and a half days of wall clock, the free Seal grant was on a 24-hour timer (since removed, #29), and the Gold ladder resets on a date key, so an evening of honest play reaches World 2. Every constant in the section below is waiting on data that was, in practice, unobtainable. This is what makes it obtainable.

**What it does:** skip time (as one offline window, or as consecutive presence-length ones), grant any currency, own every roster entry at a chosen star/level, max the prestige shop, teleport the run, force `runCleared`, switch class node, and wipe back to unfounded so the first hour can be played twice.

**The one design rule it follows: it never reimplements game math.** Every function moves an *input* — the clock, a balance, a position, an owned row — and lets the production path do the work. `devSkip` does not compute what eight hours would have earned; it rewinds `lastSettledAt` and calls the real `settleHq`. A harness that models the game separately is one that lies to you about the game.

Three details worth knowing, because each is a place it could have been silently wrong:

- **Offline and online are two experiments, not a preference.** `settleHq` classifies a window by its own length, so there is no flag to pass. Eight offline hours is one window, which is what the cap and the efficiency tax apply to; eight online hours is 160 consecutive three-minute windows, which is what a present player would have produced. `skipPlan` is unit-tested for `chunkMs <= ONLINE_THRESHOLD_MS` specifically — one millisecond over and every "online" chunk settles at the offline rate while reporting otherwise.
- **Every clock moves together.** A skipped day rewinds `lastSealGrantAt` too, or the skip hands back a day of combat and none of the Seals that day owed. The Gold ladder is the exception it cannot rewind — it is keyed on a real calendar date — so a skip of a day or more clears it instead, which is the honest approximation and is documented as one.
- **The gate is `import.meta.dev` alone**, deliberately *not* the `devMode` runtime config that `server/api/pathwarden/*` also accepts. These routes mint Gold and Gems, which are shared balances across every polynux game rather than Hero Quest scrip, so a deploy-time flag must not be able to open them. It throws **404, not 403**, so the routes are indistinguishable from undeployed. Verified in the built bundle, not just in source: `import.meta.dev` folds to a literal `false` and the gate becomes unconditional.

`devReset` clears Hero Quest's five tables and **does not touch `balance` or `gems`** — granting into a shared balance is a dev convenience, silently deleting from one is data loss.

No new game constants; the harness's own limits live beside it rather than in `constants.ts`, since nothing about balance changes if they move.

---

### 20. The nine-tab layout collapsed to six — **landed, and it deviates from the docs**

Session-1 playtest, findings 4, 5 and 7 (see `playtest-notes.md` for the full record). The four gacha tabs — Forge, Guild, Training Grounds, Dig-site — are gone, replaced by **Gacha** (a 2×2 of pull cards) and **Collections** (one page, a submenu per system).

**This is the deviation, stated plainly:** several locked docs describe those four as *places* the player visits — `gear-equipment.md` §6 gives their tab order, `skills-gacha.md` §1 dresses the Training Grounds with class-specific art, and `artifacts-dig-site-gacha.md` and `champions-guild-gacha.md` both write in terms of "the tab". Those pages no longer exist. The names survive as card headings and submenu entries, so nothing in the fiction changed, and **no rule, formula, drop table or number moved** — this is navigation only. But it was decided on a playtest call rather than a doc revision, so it is recorded here rather than left to be discovered by whoever next opens `gear-equipment.md` §6.

The one piece of authored content that did not survive the move: `trainingGroundsArt` (Barracks / Archery Range / Wizard Tower, `skills-gacha.md` §1). It dressed the recruitment block, which is now a quarter-page card shared with three other systems. The server still serializes it; nothing renders it. Either the Gacha card grows a per-system art treatment or the field goes — worth deciding during the Pixi pass rather than now.

**What the split bought, and why it is not just tidying.** The four pages were 90% the same page. Collapsing them turned four copies of a collection grid into `CollectionCard.vue` + `CollectionToolbar.vue`, and four copies of a recruitment block into one `GachaCard.vue` — the same argument that makes `gacha/pull.post.ts` one route rather than four, now applied to the client. A fifth gacha, if one ever ships, is a row in a table on both sides.

**Sorting is the only logic in it**, and it is specced (`test/hero-quest/collection-sort.spec.ts`): rarity low→high, then the system's own axis, then name. The name tiebreak exists so that reordering a content array cannot reshuffle a grid the player has learned.

---

### 21. The in-game wiki — **landed, and it is generated**

Session-1 playtest, finding 6. `/hero-quest/wiki`, five pages: Basics, Combat, Economy, Gacha, Content. Plus `InfoTip.vue` on the battle screen's stat tiles.

**Why this belongs in an open-items list at all:** the wiki is the first thing in the project that *reads* the tuning constants for a player-facing purpose, which makes it the first thing that can be made wrong by the tuning pass itself. Two mechanisms stop that, and both are worth knowing before anyone edits either half:

- **Explainer pages interpolate every number from `constants.ts`.** Prose describes shape; magnitudes are never typed. `test/hero-quest/wiki.spec.ts` asserts each formula string contains its constant's rendered value, so swapping an interpolation for a literal fails. The expected substrings carry context (`never below 1`, not `1`) because `MIN_DAMAGE` is `1` and a bare-digit assertion would be vacuous — a detail worth preserving if those cases are ever extended.
- **The Content page is a `v-for` over the content modules.** Classes, Champions, Skills, Gear, Artifacts, the effect pool and Worlds all render from the arrays the gacha rolls against.

**The gap, stated plainly:** nothing can render *which* constants are still untuned, because `// UNTUNED ╧` is a comment rather than a value. Basics carries one banner saying so. If the tuning pass ever wants a real list, the marker has to move from comment into data — that is the change to make, and it is not made yet.

**The Economy page marks Trait Gems, Raid Keys and Arena Medals as not in this build.** When Phase 4 ships those systems, flipping `live: true` in `HQ_CURRENCY_DOCS` is the whole edit.

~~One consequence for the naming passes still owed: Artifact and World names were placeholders displayed to players.~~ **Both naming passes landed 2026-09-15** (#6, `artifacts-dig-site-gacha.md` §3a), and the Content page's placeholder banner is gone.

---

### 22. The combat and progression tuning pass — **landed, 2026-08-18 → 2026-09-15**

The core loop's numbers are no longer placeholders. **42 constants moved from `// UNTUNED ╧` to `// TUNED ✓`** (104 markers → 62), and the level curve was re-derived as a pacing model rather than a single ratio. `constants.ts` now distinguishes three states in its header: `UNTUNED ╧` (shape locked, value a guess), `TUNED ✓` (measured; its comment says what it trades against and what it is coupled to), and **derived** (no marker, never set directly).

**This reverses the standing decision below that nothing is tuned before playtesting**, for the combat and progression block specifically. The tuning ran on the campaign walk. ⚠ The `TUNED ✓` legend says "confirmed in playtest", but `playtest-notes.md` still records only session 1 — if there were further sessions, what was observed in them is not written down anywhere in these docs.

**Four stages, in order:**

1. **A faster opening** (`f125cf5`, `f03af61`, `bf3551c`). Autoattack 3s → **2.4s** with the skill cooldown 8s → **6.4s** by the same factor (so kits do not lose ground to basic attacks); the attack-rate cap 3/s → **5/s**. Enemy base stats re-cut to **HP 60 / PWR 1.75 / DEF 2** (from 30 / 10 / 5), hero `BASE_HP` 2000 → **150**, `K` 2 → **16**. A spec pins that a level-1 Hero clears World 1 Stage 1.
2. **Luck off the level curve** (`a218343`). `STAT_SCALES_WITH_LEVEL.lck = false`, `LCK_BASE_SCALE = 0.75`, `CRIT_DAMAGE_PER_POINT` 0.05 → **0.02**. A geometric LCK against a clamped crit chance put every class at 100% crit inside the first prestige; frozen, crit chance is something the collections have to buy.
3. **The constant-pressure pacing model** (`5113265`). The largest change, written up in full in `core-progression-and-prestige.md` §1:
   - **`ENEMY_PACE_RATIO = 1.0`** — PWR, DEF and VIT ride `STAT_PER_LEVEL_GROWTH_PACED` and track the enemy exactly. A matched pair read through the mitigation clamp cannot drift slowly; it holds for a hundred stages and then collapses to `MIN_DAMAGE`. So **the clamp is removed as a source of walls, at both ends.**
   - **Enemy HP gets its own exponent**, `ENEMY_HP_STEP_EXPONENT = DPS_COVERAGE_PER_STAGE + FIGHT_LENGTH_DRIFT = 2.35`, because HP is read against DPS, a product of two level-scaled stats. **`FIGHT_LENGTH_DRIFT = 0.35`** is the new source of walls: each stage's fight ~2.7% longer than the last, read as pass/fail only against boss timers. Past ~0.35 the run gets *shorter*, not longer.
   - **`XP_PACE_SLACK` 0.9 → 1.0** (the grind dial) and **`XP_TO_LEVEL_GROWTH` 1.16 → 1.05** (units only — `XP_STEP_BASE === XP_TO_LEVEL_GROWTH^LEVELS_PER_STAGE`). Four levels per stage.
   - Target: **a first prestige for a party of three in about a week**. The campaign grind budget went 24h → 72h per blocked stage to match, since intended late-gate grinds would otherwise read as walls.
4. **The Beginner and the first wall** (`fd0837a`). Beginner spread `high` PWR/SPD with a **double strike** (it has no damage in its kit and a new account fields it alone). `BOSS_HP_MULT` 3 → **7**, `SUPER_BOSS_HP_MULT` 6 → **9**. Result: a solo level-1 Beginner clears World 1 Stages 1–4 and fails the Stage 5 timer by a clear margin; a starting party of three passes it on sight.

**Measured shape** (`--report=campaign`, stand-in Champions at Common / investment 1, no Gear/Skills/Artifacts):

| | Wall | Level | Prestiges | Time | Gold |
|---|---|---|---|---|---|
| Solo | P0 W8S10 (needs 430) | 401 | 0 | 10d 11h | 147,254 |
| Party of 3 | P1 W2S10 (needs 588) | 559 | 1, in ~6½ days | 10d 13h | 311,851 |

Every blocker in the party's first prestige is a boss timer. World 1's boss needs level 20 solo, level 1 with a party of three; clearing the first loop needs 524 solo and 494 with a party.

**What the pass did not touch, deliberately:** the ability magnitude set (`SKILL_*`, `ENRAGE_*` and the rest — the walk measures a Beginner plus stand-ins and barely exercises them; settling them needs seeded `fight.ts` comparisons across the class roster), everything gacha and shop, `CHAMPION_INVESTMENT_PER_POINT` (no measurement fields an invested Champion at all), the collection passive, and every Gold constant beyond `MIN_SECONDS_PER_KILL`.

**Open consequences:**

1. **A solo account never completes a prestige** without pulling. That follows from making the gate the wall and Champions the answer to it — worth confirming it is intended rather than let it stand by default.
2. **The Gold curve was calibrated against the old loop speed** — see #23.3.
3. **`STAT_PACES_ENEMY_CURVE` is inert while `XP_PACE_SLACK` is 1.0**, because both stat curves are then numerically identical. Keep it: it starts mattering the moment slack moves.

---

### 23. Gold is paced on account age — **landed 2026-08-18, with open consequences**

`gold-economy.md` §3 and §3a have the full design. In one line: `goldPerKill = BASE_GOLD × min(1.017^n, tenureCeiling(accountAge))`, with the ceiling generated from Colony's and Xeno's income at equal account age and discounted to 0.85×. `PRESTIGE_GOLD_FACTOR[]`, `GOLD_PRESTIGE_CAP`, `GOLD_WORLD_BASE`, `GOLD_STAGE_BASE` and `GOLD_PLATEAU_GROWTH` are deleted; `hq_state.created_at` was added.

**Why:** §9's plan was to measure a prestige→calendar mapping and fit the prestige table to it. Measured, the mapping does not exist — at the time a party of Commons cleared four loops in under three hours and then spent 29 days on the fifth, while a strong roster cleared six in the same three hours. Prestige count tracks power, not time, and no prestige-indexed table can hit a calendar anchor. Account age is the one clock that cannot be front-loaded, farmed or lost. `BASE_GOLD` 5 → 0.4, since the old value put a three-hour-old account at ~500× platform day-one income.

**Measured 2026-09-16 — `bun run sim:hero-quest --report=gold --party=3`.** The report is now part of the sim, so every number below is re-derivable after any change. Walk: a party of three, Beginner stand-ins, level 1 to the P1W2S10 wall — 311,851 Gold over 10d 13h, **1,233 Gold/hour**, against ~1.73M/hour on the platform at the same account age. That is **0.07% of platform**, not the "far below" the text below estimated.

Three findings, and the third is the one that matters:

1. **Progression binds at every single point of the walk**, never the ceiling — the gap widens monotonically from 1.16 vs 1.29 at World 1 to 7.43 vs 511.87 at P1W2. So `GOLD_PLATFORM_DISCOUNT`'s "~89% of time ceiling-bound" is not merely stale, it is **0% for the first month-plus**; the discount does nothing for a new account. Holding the walk's pace of 10.5 days per prestige loop, the crossover where the ceiling starts binding is **somewhere between day 30 and day 60**.
2. **The ceiling is a hard cap far below platform, and `GOLD_STEP_BASE` cannot reach past it.** Swept on the walk: 1.017 → 311,851 Gold, 1.03 → 1,087,564, 1.05 → 7,504,725, 1.07 → 11,565,867, **1.09 → 11,565,868, 1.15 → 11,565,869**. It saturates at ~11.57M, i.e. ~45.7K/hour, ~2.6% of platform. Every value at or above 1.07 is the same walk. **No value of `GOLD_STEP_BASE` fixes first-week income** — it can only decide how fast the account reaches a cap that is itself the problem.
3. **The cap is 11.7× too low because the ceiling table assumes a kill rate the game does not produce.** `GOLD_TENURE_CEILING` is generated by dividing platform income by `BASE_GOLD × 3600 / MIN_SECONDS_PER_KILL` — that is **7,200 kills/hour**, the throughput *floor* treated as the throughput. The walk kills at **617/hour** (grind rows run 535–1,188, stable across all ten worlds because `FIGHT_LENGTH_DRIFT` holds fight length roughly constant). So an account pinned to the ceiling earns the ceiling's stated rate ÷ 11.7 — and #23.1's re-anchoring figures inherit the same error: ~28M/hr at day 90 is really ~2.4M/hr, ~52M/hr at day 180 is really ~4.4M/hr.

**Applied 2026-09-16 — the ceiling is regenerated against the real kill rate.** `GOLD_REFERENCE_KILLS_PER_HOUR = 600` is a new `// TUNED ✓` constant, and `GOLD_TENURE_CEILING` is emitted against it rather than against `MIN_SECONDS_PER_KILL`. Every rung is exactly 12× its old value (`17.24, 37.18, … 342200`). Regeneration is now a command — **`bun run balance:compare --emit-hq-ceiling`** prints the table to paste — so "generated, never hand-edited" is operable instead of a note. `heroQuestIncomeAtDay` in `scripts/lib/economy-stages.ts` moved to the same rate, so `balance:compare` still reports 0.850× and *inside* at every sample day; those figures now describe the rate the game produces rather than one 12× faster.

600 is measured, not picked: **523 kills/hour solo, 617 for a party of three, 620 for a party of six**. That it barely moves with party size is the pacing model working — a bigger party kills faster and walks deeper, and the rate converges. The spread is wider than the last digit, which is why the constant is round.

Three consequences, all recorded rather than reconciled:

1. **The walk's income did not change.** Still 311,851 Gold, 1,233/hour — because it is progression-bound end to end, and raising a ceiling that never binds changes nothing. **This fixes the roof, not the floor.** What it did change is that `GOLD_STEP_BASE` now has room: swept again, the walk saturates at **138.8M** instead of 11.57M, and the saturation point moved from 1.07 to 1.09. Whether to spend that room — and how much of the first ~60 progression-bound days should earn near platform — is still #23.3's open half.
2. **`gold-economy.md` §9.4's safety margin drops an order of magnitude.** It asks the largest single collect to clear the `numeric(19,4)` balance column by three orders of magnitude; at the new ceiling it clears by two. The worst case — ten-year account age, the throughput floor, ×4 Gold%, ×4 Battle Speed, a full 72-hour window, nothing ever spent — went from ~4.4e11 to **~5.3e12** against ~1e15, so 187 consecutive worst-case collects fill the column instead of 2,250. `test/hero-quest/settle.spec.ts` now asserts two orders and says why. The separate "healthy headroom" spec passes with 13,496 hours against a floor of 100.
3. **The abuse bound is now explicit.** `MIN_SECONDS_PER_KILL` is still the throughput floor, so the worst case is bounded at `7200 / 600` = **12× platform** — the old calibration did not disappear, it stopped describing normal play and became the bound on the extreme. **Battle Speed (Phase 4, unbuilt) lands directly on this**: its multiplier multiplies Gold against the platform, and there is now no second ceiling underneath it.

**Which lever does what.** The table divides by `BASE_GOLD`, so in the ceiling-bound regime `BASE_GOLD × ceiling` is *independent of `BASE_GOLD`* — raising it and regenerating cancel exactly. That leaves a clean split:

- **The 11.7× cap** moves only by regenerating `GOLD_TENURE_CEILING` against a realistic kill rate instead of `MIN_SECONDS_PER_KILL` (`scripts/lib/economy-stages.ts`; the table is generated, never hand-edited).
- **The first ~40 days**, which are progression-bound, move by `BASE_GOLD` and `GOLD_STEP_BASE` — but only up to the cap, which is why the sweep saturates.

**The tradeoff that decision buys, stated plainly.** `MIN_SECONDS_PER_KILL` is in the derivation precisely because a bounded per-kill value times an unbounded kill rate is unbounded income. Calibrating the ceiling to a *typical* rate means anything that raises the real rate earns proportionally more than platform: the walk's own fastest grind is already ~2× its average, and **Battle Speed (Phase 4, unbuilt) is the unbounded one**. Calibrating to the floor, as now, means typical play earns 1/12 of platform forever. There is no value that does both; this is the call #23.3 is actually asking for.

**What it does to #23.2.** At current numbers the walk earns 29,598 Gold/day, so the ladder's first purchase — 1,000,000 Gold for **one** Seal — is **33.8 days of income**, and a 10-pull's worth is most of a year. The ladder is not mispriced at the margin, it is unreachable, and re-deriving `SEAL_LADDER_GROWTH` against income this size is meaningless. With the ceiling regenerated at the measured rate the same walk would earn ~12.9M/day, which makes the 1M first rung an ordinary daily purchase and the growth rates worth deriving. **So #23.2 is blocked on #23.3, not parallel to it** — and #29 raised the stakes on both, since the Gold ladder is now the only non-milestone Seal source.

**Open — three consequences, none reconciled:**

1. **The locked calendar anchors are gone.** `gold-economy.md` locked ~235M/hr at month 3 and ~0.71B/hr at month 6. The ceiling now pays a keeping-pace account ~28M/hr at day 90 and ~52M/hr at day 180 — roughly an order of magnitude less. That is a deliberate re-anchoring on the platform, but it replaced a *locked* decision in code; it is recorded here so it reads as a decision.
2. **The Seal ladder's calibration is stale** — and, measured, worse than stale: see above, the first rung is 33.8 days of income. Blocked on #23.3.

   *Original note:*  `SEAL_LADDER_GROWTH` was sized so pure Gold-buying completes one gacha's roster in ~6 months at the old income (17B/day at month 6). At ~1.25B/day that target does not hold. The ladder's shape is fine; its growth rates want re-deriving against the tenure ceiling (`gold-economy.md` §7).
3. **`GOLD_STEP_BASE = 1.017` was measured before #22 slowed a prestige loop to a week.** It was chosen so the weakest simulated roster stayed inside the platform's 0.4–2.5× band, back when loops took hours. Now a prestige-0 account's progression factor tops out at `1.017^99 ≈ 5.3`. The ~15K Gold/hour this line used to quote assumed the maximum kill rate; **measured at the walk's real rate it is 1,233 Gold/hour**, against ~975K/hour on the platform at day 7 — and the campaign walk's party of three earns 311,851 Gold over 10½ days. The ceiling does not bind for a new account; progression does, far below the platform. The "~89% of time ceiling-bound" figure behind `GOLD_PLATFORM_DISCOUNT` dates from the same fast-loop era. **Needs a decision:** whether a first-week account should earn near platform rates or whether low early Gold is acceptable. **Measured 2026-09-16, above** — and the measurement changes the options: steepening `GOLD_STEP_BASE` is ruled out (it saturates at 2.6% of platform), raising `BASE_GOLD` cancels against the generated table in the ceiling-bound regime, and the real lever is the kill rate the ceiling is generated against. Note also that "Gold only buys Seals" now carries more weight than when this was written: after #29 the ladder is the only non-milestone Seal source.

---

### 24. A settle is lossless now — **landed 2026-08-25**

Two bugs, both of the "progress silently disappears" kind.

**The part-kill carry.** Every read is a settle, and each window floored to whole kills, so up to one kill was lost per settle — and a player refreshing faster than `secondsPerKill` earned nothing at all. `hq_state.kill_fraction` now carries the remainder into the next window. It is carried **in kills, not seconds**: seconds are only worth kills at the rate that measured them, so a player parked at a wall would bank hours of unspent time and cash it all the moment an upgrade cut the rate. Values outside `[0, 1)` are dropped as corruption rather than clamped (a clamped `1` pays a free kill on every read). Reset to 0 on prestige, boss engage and dev position edits. Specced in `settle-carry.spec.ts`; `idle-mechanics.md` §4.

**The UTC pin** (`fced8fd`). On a non-UTC machine a new `hq_state` row's `defaultNow()` settle clock read back hours in the future, so every settle early-returned before writing and a new run accrued nothing for exactly the UTC offset — while the client's projection walked forward and snapped back on every refresh, looking like progress being wiped on reload. The database connection is now pinned to UTC; this affects every idle game on the platform, not only Hero Quest. `tech-architecture.md` §4a.

---

### 25. Bosses engage automatically while the page is visible — **landed 2026-08-18, a deviation from locked docs**

`core-progression-and-prestige.md` §2 said a failed boss is not auto-retried and the player re-engages manually; `idle-mechanics.md` §5 had the player return to a fight "ready to manually engage". **Both are superseded:** the client fires `boss/engage` on its own while `document.visibilityState` reads `visible`, on first arrival and on every re-arrival. A manual button remains.

**The invariant it keeps:** a hidden tab, a closed app and an offline settle never engage a boss, so Void Shards still cannot be earned from idle time. Presence is read from visibility rather than from a press.

**Decided in code rather than in a doc revision**, the same situation as #20 — recorded here so the locked text is not taken at face value. The details worth knowing:

- **One kill of grace** (`AUTO_ENGAGE_GRACE_KILLS`, clamped 1–10s). The client projects kills fractionally and the server floors them, so the screen reaches a gate before the server agrees. The early engage is rejected with a 400, which is now routine: swallowed and retried after 3s, never shown. **Do not soften the rejection server-side.**
- **Holds on a cleared run.** A won super boss leaves the run parked on its gate with `runCleared` set; firing there would re-fight it forever and pay Milestone Seals each time. ~~**Manual re-engage has the same shape and was flagged, not fixed.**~~ **Confirmed and fixed 2026-09-15.** `boss/engage` never checked `runCleared`, so a cleared run's final boss could be re-fought indefinitely by button or by script, each win paying the boss and world-clear Milestone Seals again (4 of every type) — and a burst on the *first* clear paid once per queued request, since the lock serializes them but a win there does not move the run. The fight now lives in `resolveBossEngage` (`server/utils/hero-quest.ts`), which rejects a cleared run under the row lock; the button is hidden on a cleared run; `boss-engage.spec.ts` bursts it against a real lock (verified to fail with the guard removed: 10 of 10 paid).
- An auto-engaged replay closes itself after 2.5s; a manual one waits for the player.

Decision logic is pure and specced (`app/utils/hero-quest-auto-boss.ts`, `auto-boss.spec.ts`). For the watchlist: whether an unattended boss loop reads as "the game plays itself" or as losing the one moment the game asked for attention.

---

### 26. Seeing the numbers — **stat attribution and a live battle screen, landed 2026-08-18**

Two presentation systems, both built so they cannot disagree with the model.

**Stat attribution** (`c72c3f5`). `shared/utils/hero-quest/explain.ts` re-walks the stat pipeline recording each step, and prices every source in **stages of enemy curve** — the only common denominator the game has. Rendered by `bun run sim:hero-quest --report=stats` and by `StatBreakdown.vue` via the new `stats.get.ts`. It refuses to show per-source multipliers, because Gear, Skill and Artifact lines sum as fractions before converting (Gear +50% and a Skill +50% are ×2.00, not ×2.25). Its central lesson, printed on every report: **only levels compound** — every other source shifts a wall by a constant number of stages. Answers session 1's "no idea what each stat means" at the model level, not only the tooltip level.

**The battle screen walks forward between payloads** (`b8dd672`, `3f1f101`). The server settles lazily and the client polled once a minute, so the screen was a minute-old photograph that jumped. `app/utils/hero-quest-battle.ts` projects the run forward — kills, stage, world, Gold, XP, level, live hero and pack HP — with the same pure helpers `settle()` uses and the rate the server served, holding `secondsPerKill` across stage boundaries exactly as `settle()` does. Nothing projected is sent back. This is what the Pixi scene will eventually draw from; it is still placeholder chrome.

Also: `settleHq` returns the shop levels and collections it read under the lock so the routes stop querying them twice (`de4c1bf`).

---

### 27. Status rules revised — **landed 2026-09-15**

Two fixes to `fight.ts` and `status.ts`, written into `classes-and-combat.md` §7.

1. **Boss fights read stat statuses live** (`b96a322`). Buffs and debuffs were applied and replayed but the seeded fight resolved hits, attack intervals and cooldowns from the unbuffed stat block — a PWR buff, a DEF shred or Haste changed nothing in a boss fight. Now PWR and DEF (both sides) and party SPD are read through live statuses at every hit and every timer reset. A caster's own half of an ability lands under `<skillId>_self`, so Enrage's PWR buff and DEF debuff no longer merge into one.
2. **Stat buffs and debuffs refresh instead of stacking** (`55ff15b`), unless the spec sets `stacks` (Frostbind, Iron Skin, two Training Grounds Skills). A buff outlasting its own cooldown otherwise compounds to the stack cap — Haste to ×6 SPD, a −20% debuff to −100%.

Consequence worth re-measuring: any boss-gate verdict from before `b96a322` understated kits built on buffs and debuffs. The idle projection priced them all along, so the fight and the projection now agree more closely than they did.

---

### 28. Global Power Number built, and every collection now raises stats — **landed 2026-09-15**

**GPN is built on the locked formula** (`global-power-number.md`, *As built*): `sqrt(party DPS × party effective HP) × GPN_DISPLAY_SCALE`. The square root was dropped 2026-09-15 to make the number bigger and **restored 2026-09-16** when the bare product overshot — it read as a balance, not a power rating. `GPN_DISPLAY_SCALE = 10` (UNTUNED) does the enlarging instead: a level-1 Hero opens at ~945 and crosses 1,000 in a few levels. Both steps are monotonic, so ranking is untouched either way (§2). Computed on read from the fielded party's real stats and shown as the battle screen's animated headline, with a wiki entry. It can go down, as locked.

**A different design was considered and rejected.** The proposal was an account-wide, never-decreasing number built from collection size and progress ("big number go bigger"). It was dropped because Arena matchmaking compares GPN with a defender's Defense GPN, and a number padded by collection size would stop predicting fights. The locked design stands.

**What came out of it: collection passives for Skills and Artifacts.** Before, only owned Champions and Gear raised stats while benched. Now an owned-but-unequipped Passive Skill or Artifact gives the Hero a tenth of its combat-stat lines, the same ratio Gear uses — which is how the collection reaches GPN without a separate term. Decisions taken with it:

- **Stat lines only** (`COLLECTION_PASSIVE_KINDS`: the six stats, max HP, crit chance, crit damage). Economy, cooldown, damage-taken, shred, control-resist and reflect lines stay equipped-only, so a wide collection cannot stack Gold% or cooldown reduction nobody slotted.
- **Hero only**, for Artifacts too — every collection passive in the game reaches only the Hero, and a party-wide one would multiply a collection by party size.
- **An equipped copy is never counted twice**, and a copy past the purchased slot count pays the unequipped share.
- **Unequipped Active Skills still add nothing** — they have no stat lines. If that feels wrong in play, the fix is to give Actives a stat line, not to widen the passive.

**Deviations, recorded:** GPN is not stored on `hqState` and not written on settle (nothing reads a stored value yet); DPS is against zero DEF and a single target, without projected ability buffs. **Not built:** leaderboard aggregate, profile display, Defense GPN.

New placeholders, all `// UNTUNED ╧`: `SKILL_COLLECTION_PASSIVE_FRACTION`, `ARTIFACT_COLLECTION_PASSIVE_FRACTION`, `EHP_DEF_CONSTANT` (now in use). None of these moves the campaign walk, which fields no collection.

---

### 29. Free Seals cut to milestones only, free pulls retuned — **landed 2026-09-16**

**The time-gated Seal grant is removed.** It paid one 10-pull's worth of every Seal type every 24 hours, banking up to 7 days, and it paid whether or not the player ever opened a gacha. Gone with it: `SEAL_GRANT_INTERVAL_HOURS`, `SEAL_GRANT_AMOUNT`, `SEAL_GRANT_BANK_CAP_DAYS`, `dueSealGrants()`, the settle-time write, and the `hq_state.last_seal_grant_at` column (`drizzle/0014`). `economy-and-currencies.md` §5 source 2 is struck through rather than deleted — **this doc is the authority over it**, per the standing rule.

**Free Seals now come only from progression:** boss kills, world clears, prestige (§5 source 1), plus raid clears when raids exist (source 3). Everything else is bought with Gold on the daily ladder. The drip was undercutting both at once — it made the ladder optional and the milestones marginal.

**The free 10-pull entitlement is now the only thing a clock hands out**, and it was retuned with the cut: **3 per gacha per day (was 2) on a 10-minute cooldown (was 30)**. `FREE_PULLS_PER_DAY` and `FREE_PULL_COOLDOWN_MINUTES` are now marked **`// TUNED ✓`** — they are a coupled pair, set by decision rather than by sim measurement (the campaign sim walks combat and models no pull cadence, so it has nothing to say about either). The cooldown is what decides whether the allowance is collectable in one sitting: 3 claims 10 minutes apart is ~20 minutes, where 2 claims 30 minutes apart was an hour and mostly went unclaimed.

**Net effect on pull income.** A gacha goes from 9 free Seals + 20 free pulls per day to **0 free Seals + 30 free pulls**, ×4 systems. Pull *volume* is up; Seal *balances* now only grow by progressing or paying. A player who stalls at a boss gate and never buys Seals is capped at 30 pulls a day per gacha with no Seal income — **that ceiling is intended and accepted** (2026-09-16), not an open consequence. The collection curve, Essence income and the crafting economy still have not been re-derived against the new shape, which is a tuning question like the rest of this section.

---

### 30. Artifact icons — **one per item, decided 2026-09-17**

**48 icons, one per Artifact** — not 33, one per underlying effect.

Surfaced while checking `asset-list.md` for completeness. §3.2 had carried "icons could follow
effects (33) rather than items (48) **if desired**" since the first pass — phrased as an option
and never actually decided, which is why it read as settled for as long as it did. Worth 15 icons.

**Why per-item.** The Dig-site's reveal is selling 48 distinct relics; sharing art between
Artifacts that happen to roll the same effect would undercut the one thing that pull is for. This
is deliberately the **opposite** call to ability VFX, where reuse is fine because there the effect
*is* the thing being read — an Artifact is an object, an ability is an event.

Applied to `asset-list.md` §3.2 and its itemised icon table. No change to the 217 total: 48 was
already the number counted.

### 33. The game draws its art from code — **decided 2026-10-02**

**No PNG ships.** The battle scene renders from the procedural drawers, the same code the art
page uses, and the 1,166 exported strips in `public/hero-quest/sprites/` (plus `manifest.json`)
were untracked and gitignored. The exporter stays, as a local tool for review sheets.

**Why.** The drawers are the source of truth already (`art-style.md` §1), so committing their
rendering doubled every art change and put ~1,200 binaries into `main`'s history. Download favours
code too: the drawers are 224 KB gzipped, the PNGs 17 MB. And the live stage's 60 Hz effects
(`clock.smooth`) only exist when drawn at runtime; baked 30 fps strips would have lost them.

**The cost, measured.** Every asset and frame, drawn in Bun on the dev machine: 17.7 s for all
34,904 frames, a median of 0.024 ms a frame, but 3.5–4.4 ms for the big raid and boss frames,
which are ~90% of the total. That is why bosses felt slow on the stage, and why the scene bakes
once and blits rather than drawing bodies every tick: the plan is in `tech-architecture.md` §7.
Low-end devices were not measured.

**History is not cleaned.** Untracking stops new commits carrying the PNGs; the ones already on
`hero-quest-art` stay in its history unless the branch is squashed before it merges.

### 34. The battle stage — **idle stage and boss replay landed 2026-10-02**

**Canvas 2D, not Pixi** (the user's call, against `tech-architecture.md` §7, which was updated).
The art composes indexed frames in software and `canvas.ts` blits them at an integer scale; Pixi
would only have wrapped those frames in textures and added a second compositing path beside the
art page's.

**One engine, two drivers.** `BattleCanvas.vue` runs the art page's `BattleDemo` in run mode
rather than a fork of it. The art page's showcase is untouched: 300 frame hashes across five
waves, `Math.random` seeded, were identical before and after.

**The run decides, the stage plays.** `run-director.ts` drops the front body when `killsFloat`
crosses its kill, by the next hit to land if one comes within 0.2 s, else outright. Its numbers
are real (the user's call): the per-enemy HP split over the hits landed, so a body's numbers sum
to its HP. Idle farming averages crit (`combat.ts`), so a crit on the stage is a presentation roll
at the Hero's real chance, worth the real multiplier against a normal hit; crits do count in the
damage the run deals, through the averaged factor. The party is the one HP pool `battleReadout`
already drew, so enemy hits show no numbers. Specced in `stage-director.spec.ts`.

**What it does at the edges.** A cleared stage carries its last body under the next one at the
old HP; a walled restart fells the party for 1.6 s and brings it back to a fresh pack; a gate holds
the boss and its escort in a standoff, nobody swinging, until the fight is engaged; and a jump —
a new world, a prestige, a tab back from hidden — rebuilds rather than replays. The party marches
between packs only when a kill takes 3.2 s or more; faster, the next pack fades in where it stands.

**Choices made without asking, easy to flip:** every body of an elite stage wears the elite
mark, since all of them carry the elite multiplier; Champions use the Hero's crit figures, since
the payload serves no per-Champion crit. (Attacks and casts were on the art page's cosmetic
rhythm at first; both run on the fight's timings now, below.) The crit font gained an `E`
glyph for numbers past the trillions (`4.20E15`).

**The boss replay landed the same day.** The stage acts out the server's event log;
`BossFightModal.vue` is gone, and `BossFightPanel.vue` takes the readout's place under the stage
while a fight plays (encounter HP, clock, result, Skip, and the same auto-close rule). The log is
cut into beats by `fight-script.ts` (one actor, one moment, its hits and the deaths they cause;
specced in `fight-script.spec.ts`), and each swing starts early by its clip's impact and its
shot's flight so the blow lands on the logged moment. Every number is the log's; the party's
frames follow each body's logged HP. To place hits and draw HP, the engage response gained
`partyIds` and `partyMaxHps`, read off the snapshot the fight ran on: a read-only addition, no
rule or outcome moved.

**Two fixes rode along.** The modal read every event carrying `remainingHp` as enemy HP, so a heal
or a damage-over-time tick on the party wrote a party member's HP into the first enemy's slot and
the bar jumped; the panel reads only events on an enemy. And the boss's name and timer are now
taken as the fight is engaged: the payload that lands with the result has already moved the run
past the gate, so the modal had been naming the next stage's foes.

**Choices made without asking:** a Hero skill's cinematic plays as a flourish only (its numbers
are the log's hits); statuses do not show as pips on the party frames, since the log's ids are
ability ids, not the status icons'; the result banner is the stage's own (VICTORY, DEFEAT, TIME UP).

**Skill casts run on the real cooldowns** (the user's call, the same day). The hero payload
carries `kits` (`projection.partyKits`): every unit's kit as `runFight` arms it, each ability's
cooldown from that unit's own SPD and cooldown factor, and whether it deals damage. On the idle
stage each ability starts on its full cooldown, as a fight does, ticks continuously, and casts the
moment it comes due, with its own effect; one that only lands on allies shows no blow. A level or
an equip that moves a cooldown updates it in place, without rebuilding the stage. `party-kits.spec`
pins that every ability's first cast in a real seeded fight lands on the cooldown served for it.
A deep kit comes off cooldown faster than one body can play its casts (a level-30 Sorcerer has
four abilities on 3.8 s), so the most overdue casts first and one left waiting 0.6 s fires on its
own, its effect and blow without a cast clip: the stage casts as often as the fight. The full
cinematic is kept for the class's own skill, as on the art page; a kit of them would hold the
fight still. Hit-stop freezes pause the cooldowns with everything else, so the stage casts a
little under the fight's count over a long watch. Boss replays show each cast's own effect too.

**Basic attacks run on the real attack speed** (the user's call, the same day). `kits` also
carries each unit's `attackSeconds` (`attackIntervalFor` of its own SPD) and `strikesPerAttack`.
The party swings when its attack timer runs out, the first attack at once and then every
interval, as `runFight` does, and a melee swing lands each of its strikes; the pack swings every
`attackIntervalFor(0)`, starting a full interval in, as the fight times its foes. Three things
keep the count honest. A swing whose clip outlasts the gap plays faster, up to 3×. One a whole
interval late (the 0.2 s floor is faster than any clip at 3×) lands its strikes without the clip.
And in the game a hit no longer cancels a swing into a flinch: the body flashes and keeps swinging,
as bosses already did on the art page, since a hit never cancels an attack in the fight. Measured
over 30 s: a level-5 Knight lands 14 of 14 strikes, a level-60 Archer 23 of 23, a level-400 Beast
Master 581 of 604 at the 0.2 s floor (hit-stop freezes take the rest), and each foe 12 swings of 12.
`party-kits.spec` pins the interval and strike count against a real fight.

### 35. Sessions and the splash — **landed 2026-10-02**

**Hero Quest opens on its splash** (`HeroQuestSplash`, drawn by `menu-splash.ts`) whenever there
is no run (Begin) or the player's session has ended (Start). A session ends when a state read
closes a gap longer than `HQ_SESSION_TIMEOUT_MS`: **an hour, locked** (the user's call; it was a
30-minute placeholder for its first hour of life, and the user chose a timeout longer than
`ONLINE_THRESHOLD_MS` rather than reusing it), so a reload after a long break, or a laptop waking
mid-session, asks again; a shorter break drops straight back into the fight. The splash carries
the away report of the read that ended the session. The dev page's **Force away** (`devAway`)
ends a session on demand: it banks the real time, moves the settle clock back past the timeout,
and the next read settles that gap offline through the real `settleHq`, as an hour away would.

**It stands the save's party** (the user's call): the Hero's class and the fielded Champions,
each on its formation row, on the battle stage's marks, idling out of step; the Beginner alone
when there is no save. `menu-splash.ts` composes it from the `branding/splash` scene and logo, which
stay as drawn for the art page, and drops their loading bar, since the splash waits for Start.

**Play is drawn in the canvas**, the first control to live there (the direction below): a button in
the logo's make, centred across the splash on the middle of the ground, the logo centred above;
the party stands 45 px left of its battle marks here, clear of it (on the splash only). It lights under the pointer,
sinks when pressed, dims while the press is on its way, and a glint crosses it. The canvas is the
button for the page: hit-tested in scene pixels, focusable, labelled, and pressed with Enter or
Space. The DOM Begin and Start buttons are gone; Play does both.

**Presentation only.** The server settles every gap on its own rules whatever the splash says;
`awaySeconds` on the state read is the one field added, and nothing reads it but the gate. The
splash's one effect on the game is deliberate (the user's call): the presence poll pauses while
it waits, so a tab left on it is away and pays offline rates, and nothing behind it mounts, so no
battle plays and no boss engages. Start resumes both. The splash stands in front of every tab;
Dev and Art stay reachable in dev builds, since the harness has to work without a run.

**Decided as each read arrives, not in a watcher.** The first cut decided in a watcher, which does
not run during the server render once data lands, so the server drew the splash and the client
the game, and the page hydrated into a mix of both. The decision now lives in the state fetch's
`onResponse` (`useHeroQuest`), runs on both sides before render, and reaches the client in
`useState`. Start's own read closes the very gap that ended the session, so it is not held
against it.

**One read per load.** With the layout holding the state as well as the tab, a page load read it
twice, and a read is a settle, a write; the second also replaced the away report. A component
mounting within 5 s of a read now reuses it (`getCachedData`), and the poll is one shared timer
however many components hold the state.

**Direction, from the user:** everything is to live in the canvas later, the navigation menu
included. The splash gates the DOM tabs for now because they are what exists; when the menu moves
into the canvas, the gate moves with it.

---

## ✅ Resolved before the numbered items began

For the record — these were open items here and are now settled:

| Item | Resolution |
|---|---|
| `hqCollection` — one table or four? | **Single table**, `system` enum, locked in `tech-architecture.md` §3 |
| The game's real name | **Hero Quest** — applied throughout as `hq`/`hero-quest` naming |
| Trait Raid preferred-Loadout | **Yes** — included in the 5-entry raid-preference map, `loadouts.md` §4 |
| Arena Shop selling Gems | **Yes, at a deliberately unfavorable rate** — calibrated so a full day's Medals convert to less than one Battle Speed block, `arena.md` §6 |
| Combined class system | **Removed entirely** — cut from both prestige-shop sink lists, no longer referenced anywhere |
| `MAX_EVASION` | **Locked at 60%** — headroom left for future evasion sources |
| STR/DEX/INT → PWR merge | **Applied** across all affected docs |
| Hero level persistence across prestige/class-switch | **Applied** — `core-progression-and-prestige.md` §3, `classes-and-combat.md` §4–5 |
| Full asset list (characters, VFX, icons, backgrounds) | **Delivered** — see `asset-list.md`, all ten fidelity questions answered |

---
