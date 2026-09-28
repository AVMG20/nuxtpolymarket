# Hero Quest — Asset List

Derived from all 18 locked design docs. All ten fidelity decisions are now locked — this version reflects them and recomputes the real production volume where the answers changed it.

**Legend:** 🎞️ = spritesheet-animated · 🖼️ = static image/icon

**World & enemy content is still undesigned** (`index.md` §6) — those entries below remain structural counts, not final specs.

---

## 1. Playable & Combat Units

### 1.1 The Hero 🎞️ — **Locked: fully unique per node**

16 fully unique class-node appearances, no shared rig or recolor between them:

| Tier | Nodes |
|---|---|
| Beginner | Beginner |
| Base (3) | Warrior, Mage, Archer |
| Elite (6) | Barbarian, Knight, Wizard, Shaman, Bowman, Hunter |
| Master (6) | Berserker, Paladin, Sorcerer, Witch Doctor, Marksman, Beast Master |

Per-appearance states: **Idle, Basic Attack, Skill cast, Hit, Death** — 5 animation sets × 16 nodes = **80 animated spritesheets**, all bespoke. This is the single most expensive line item on the list, by design — the Hero is the one character a player looks at for the entire game.

Two of the 16 skill-cast animations are summon triggers rather than direct-effect casts (Paladin → Disciple, Witch Doctor → Raised Dead) — the summoned unit itself is scoped separately in 1.3.

### 1.2 Champions 🎞️ — **Locked: shared chassis per archetype, distinct skins within it**

**The production structure this creates is worth stating precisely, since it's a real cost saver:**

- **4 chassis (rigs)** — one per archetype (Damage/Tank/Support/Control). Each chassis is animated **once**: Idle, Basic Attack, Ability-cast pose, Hit, Death = 5 states × 4 chassis = **20 animation sets total**, reused by every Champion of that archetype.
- **48 distinct skins** — every Champion gets its own look applied to its archetype's shared rig, satisfying "2 Champions sharing an archetype+rarity must look different." Skins don't need their own animation work — they ride the chassis's existing 5 states.
- **The ability's actual effect is separate art entirely** — the generic "Ability-cast pose" above just triggers the ability's own VFX (locked as custom-per-ability in Section 2 below), so a Champion doesn't need bespoke animation work just because its ability differs from another Champion's.

**Decided 2026-09-17: fuller per-rarity redesign, not recolors.** Each rarity step gets a genuine redesign — more ornate armor and effects at Epic+ — layered onto the shared chassis, so the rarity jump reads at a glance rather than as "same guy, different colour". The expensive option, chosen deliberately: a gacha's whole reward loop is the reveal, and 48 recolors would undercut it. The *chassis* count (4) and *animation* count (20 sets) are unchanged — this is 48 skins' worth of art effort, not new rig or animation work.

### 1.3 Companion / Summon Units 🎞️ — **Locked: simple movement + attack only**

| Summon | Source |
|---|---|
| Disciple | Paladin's skill |
| Raised Dead | Witch Doctor's skill |
| Wolf | Beast Master's kit |

**2 animation states each** (Move, Attack) — **no dedicated Hit or Death animation**. 3 summons × 2 states = **6 animated spritesheets**, the cheapest character-art line on the list.

### 1.4 Enemies 🎞️ — **Locked: 4 weapon variants per world, styled to it; 4 states, 5 for bosses**

**Locked: every enemy is styled to its world.** A world's theme line is the art brief for its
background *and* its whole roster — trash, elite, boss and super boss are drawn as inhabitants of
that place, not as a generic monster set recoloured ten times. Cinderpass fields ash-caked kobolds
around a molten wyrm; The Brink, the last ground before the Void, fields knights coming apart thread by thread. This is what makes
a world read as somewhere the player has arrived, given that nothing else about it changes — the
stat curve is continuous across worlds and the pool never re-themes between prestiges
(`core-progression-and-prestige.md` §5), so **art is the only signal that the run has moved on.**

One trash enemy per world (elites are the same enemy, stat-buffed and visually marked), one boss,
one super boss.

**The rosters, with the theme each is drawn from** — source of truth `shared/utils/hero-quest/content/worlds.ts`, mirrored in `core-progression-and-prestige.md` §5. The arc is a walk toward the source: Duskspire's archmage opened a door to the Void (World 6), the cracks spread outward, and a run starts at the far frontier and walks inward past the door and out through the edge of the world.

| # | World | Theme — the art brief | Trash / elite | Boss | Super boss |
|---|---|---|---|---|---|
| 1 | Thornwick Vale | Frontier farmland at the edge of the kingdom, where the first cracks have turned the hedgerows feral | Bramble Warband: Bramble Goblin, Thornhide Hobgoblin, Scarecrow Stalker, Hedge-Witch | Old Gnarlhide | Gorsecrown, King of Hedges |
| 2 | Mirewood | A drowned forest of black water and hanging moss, rotting from the roots up | Mire Brood: Bog Lurker, Peat Brute, Reed Spitter, Bog Crone | Mother Leech | Rotheart, the Sunken Elder |
| 3 | Cinderpass | A volcanic mountain pass choked with ash, held by kobold clans and the thing they worship | Cinder Clan: Cinder Kobold, Slag Golem, Ash Imp, Salamander Firecaller | Slagjaw | Pyrrhax, the Molten Wyrm |
| 4 | Rimeholt | A frozen northern hold whose raiders swore themselves to a cold that does not end | Frost Host: Frostbound Raider, Rime Troll, Snowfield Huntress, Rune Skald | Jarl Hrimgar | Vinterhel, the Glacier Titan |
| 5 | Sunken Amarath | The drowned capital of a sea-empire, its dead still keeping the tides | Drowned Crew: Drowned Sailor, Barnacle Brute, Harpoon Siren, Tide Priestess | Tidecaller Nerine | Queen Maerith of the Deep |
| 6 | Duskspire | A city of mage-towers held at twilight since its archmage opened a door to the Void | Hollow Conclave: Hollow Acolyte, Spire Gargoyle, Spellbound Construct, Riftbound Magus | Magister Halvane | Archmage Ithren, the Door-Opener |
| 7 | The Bonefields | An ancient battlefield where the fallen of a forgotten war rise to fight it again | Restless Legion: Restless Legionnaire, Barrow Ghoul, Bone Archer, Ossuary Priest | Grave Marshal Korr | Ossuar, the Thousand-Bone Host |
| 8 | The Shattered Sky | Islands of torn-loose stone adrift in a storm the Void has unmoored | Storm Swarm: Skyshard Wisp, Thunderhead Golem, Harpy Raider, Squall Caller | Stormcrown Roc | Zephyrax, Breaker of Heavens |
| 9 | The Brink | The last ground at the edge of the world, where the storm has burned out, the sky has gone to stars and everything left is falling toward the Void | Unravelled Host: Unravelled Knight, Tethered Brute, Starfall Archer, Last Seer | Sister Vesper, the Forgotten | Liminus, the Last Door |
| 10 | The Void | Nothing, pressing in — where every crack leads, and where each run ends before it begins again | Void Horde: Void Thrall, Void Maw, Starved Wraith, Void Augur | Void Herald | Nihil, the Hunger at the End |

**Decided 2026-09-17: 4 trash variants per world — sword, axe, bow, mage-staff.** Each wears an
outfit matching its weapon type *and* its world's environment: Rimeholt's axe-carrier is a
fur-wrapped raider, Sunken Amarath's is a barnacled marine. The weapon set is deliberately the
party's own vocabulary — a player already reads "staff means it hits from the back" from their own
Hero, so a pack of six is legible at a glance without a tutorial.

**The weapon is the rig; the world is the skin.** This is §1.2's Champion chassis pattern, applied
again because it is the same problem — four archetypes became four rigs and forty-eight skins, and
here four weapon types become **4 rigs, animated once**, reskinned across all ten worlds. Forty
bespoke animated trash enemies would be the single most expensive line on this list; this is 16
animation sets and 40 skins. A bow release and an axe swing genuinely differ, so the split has to
be by weapon rather than by world — which is the cheap direction, since there are 4 weapons and 10
worlds.

**Decided 2026-09-17: 4 animation states for trash and elites — Idle, Attack, Hit, Death.**
Deliberately one short of the Hero's and the Champions' 5: **enemies have no abilities**, so there
is no skill-cast to animate. That is not an omission, it is the current combat model — `fight.ts`
emits `enemy_attack` and `enemy_down` and no enemy ability event exists (`open-items.md` #18.6 is
the same fact seen from the other side: `controlResist` is inert because nothing applies control to
the party). ⚠ **If the enemy-kit question in #6 is ever answered yes, every rig gains a fifth
state** — 4 more sets for trash, 20 for bosses. That is a cost the kit decision carries and nobody
has priced.

**Bosses and super bosses get 5 — Idle, Attack, Hit, Death, and an Entry.** The extra one is not
a cast; it is the boss arriving. Bosses used to be the only thing in the game that waited for the
player, and `open-items.md` #25 took that away — they now fire automatically while the tab is
visible, which is on the playtest watchlist precisely as *"whether a boss still feels like an event
when the player did not start it"*. With the player's action gone, the art is what is left to carry
the moment. One entry animation per boss is the cheapest thing that answers it. **If it does not
earn its keep in playtest, drop bosses to 4** — nothing else depends on it.

**Elites are a visual mark on the trash enemy, not a design.** They share the trash roster's name
and stat-buffed identity (§5), so the mark — an aura, a banner, a scar, whatever reads at a
glance — is **one consistent treatment applied across all ten worlds and all four weapon variants**,
so a player learns "this shape means elite" once rather than forty times. No animation of its own.

| Enemy category | Rigs | Skins | States | Spritesheets |
|---|---|---|---|---|
| Trash (4 weapon variants) | **4**, shared across every world | **40** (4 × 10 worlds) | 4 | **16** (4 rigs × 4 states) |
| Elite | — reuses the trash rig | 1 mark treatment, reused | — | **0** |
| Boss | 10, one per world, bespoke | — | 5 | **50** |
| Super boss | 10, one per world, bespoke and the most elaborate art in its world | — | 5 | **50** |
| | | **60 designs** | | **116 spritesheets** |

**Still owed:** production itself, and the enemy-kit question (`open-items.md` #6) — which is a
gameplay decision, not an art one, and would add the fifth state above.

### 1.5 Raid Bosses 🎞️ — **Locked: all 5 unique designs, no reuse**

| Raid | Fight Type | Notes |
|---|---|---|
| Guild Raid | `solo_boss` | |
| Training Grounds Raid | `training_dummy` | A massive static training dummy: Entry (falls from the sky, stake into the ground), Idle and Hit only. No Attack, no Death (2026-09-28, `open-items.md` #31) |
| Dig-site Raid | `reinforced_boss` | Boss + its own add-wave enemy designs |
| Forge Raid | `phased_boss` | Needs a visually distinct state per HP-threshold phase |
| Trait Raid | `rampaging_boss` | Unkillable by design — no death animation ever plays; needs its own visual language since no HP bar exists (`raid-system.md` §7) |

### 1.6 Arena Training Dummy 🎞️ — **Locked: static, with a simple hit-reaction only**

No idle loop, no attack animation of its own (it never meaningfully fights back — guaranteed loss for it by design). **Just 1 small animation: hit reaction.** Everything else is a static pose.

---

## 2. Combat VFX & Feedback

### 2.1 Ability VFX — **Locked: custom icon + custom VFX animation per ability, for now**

Applies to the 16 Hero skills + 28 Champion abilities = **44 unique ability effects**, each getting its own icon and its own spritesheet VFX. No shared template library at this stage.

**Decided 2026-09-17: yes — the 18 Training Grounds Active skills get the same custom-per-ability treatment.** They are mechanically identical to Hero skills (same cooldown system, same auto-fire behaviour), so sharing VFX with the Hero set they resemble would make a pulled Skill look like a skin of something already owned. **That takes the ability VFX total from 44 to 62 sets.** The 18 Training Grounds Passives need nothing — they are stat modifiers with no cast moment.

### 2.2 Multi-Strike Attack Animation 🎞️ — **Locked: recolor of the single-strike animation, fired multiple times**

Hunter (triple-strike) and Beast Master (quad-strike) reuse the Archer-path single-strike animation with a recolor, triggered 3× and 4× respectively rather than needing bespoke multi-hit spritesheets.

### 2.3 Other Feedback (unchanged, listed for completeness)

| Asset | Notes |
|---|---|
| Status effect icon set 🖼️ | ~15–20 distinct types: burn/DoT, stun, slow, silence, armor shred, curse, shield, buff, debuff-immunity, evasion |
| Damage number styles 🖼️ | Normal hit, crit hit, heal, miss/evasion text |
| HP bar + party frame 🖼️ | Portrait, HP, active status icons — per party member |
| Cooldown radial-fill overlay 🖼️ | Per equipped skill icon |
| Boss enrage-timer UI 🖼️ | 3 of 4 raid fight types |
| Reinforced Boss add-wave spawn VFX 🎞️ | Dig-site Raid |
| Phased Boss phase-transition VFX 🎞️ | Forge Raid |
| ~~Artifact proc feedback~~ | **Cut 2026-09-17 — log-only, no art.** The six chance-based Artifact effects (Lucky Dig, Windfall, Chain Reaction, Double Cast, Slipstream, Quick Study) surface in the numeric log and nowhere else. Artifacts are passive-only everywhere else in the game; a proc flash would be the one exception, and it would fire often enough to become visual noise during an idle fight nobody is watching |

---

## 3. Static Icons

### 3.1 Ability/Skill Icons 🖼️

| Set | Count | UI shape |
|---|---|---|
| Class-tree skills | 16 | **Square** (`skills-gacha.md` §7 — locked convention) |
| Training Grounds skills | 36 | **Circular** — deliberately distinct from class skills |
| Champion abilities | 28 | — |

### 3.2 Item Icons 🖼️

| Set | Count | Notes |
|---|---|---|
| Artifacts | **48** | **Decided 2026-09-17: one icon per item**, not one per underlying effect (33). The Dig-site's reveal is selling 48 distinct relics, and sharing art between Artifacts that happen to roll the same effect would undercut that — the opposite call to ability VFX, where the effect *is* the thing being read. `open-items.md` #30, now in `build-log.md` |
| Gear | 36 | **Locked: icon only — equipping is never visible on the Hero sprite.** No interaction with Section 1.1's Hero art at all |
| Currency | **18** | Gold, Gems, Void Shards, 4× Seals, 4× Essence, Trait Gems, 5× Keys, Arena Medals — 1+1+1+4+4+1+5+1. **Was written as 16; the row's own list has always added to 18**, and it matches `HQ_CURRENCY_DOCS`. Corrected 2026-09-17 |

### 3.3 Frames & Badges 🖼️

| Asset | Count | Notes |
|---|---|---|
| Rarity tier frame/border | 6 | Common (gray) → Mythic (red), shared across all 4 gachas |
| Trait grade frame | 9 | **Locked: each of the 9 grades (F→SSS) gets its own unique color, independent of the 6-tier rarity palette** — a fully separate 9-color ramp, not a reuse or extension of the gacha rarity colors |
| Archetype badge | 4 | Damage/Tank/Support/Control |
| Class-tree node icon | 16 | For the tree-selection UI — distinct from the node's skill-cast icon |

---

## 4. Backgrounds & Environments

Unchanged from the previous pass — nothing here was in the fidelity decision set:

| Asset | Count | Notes |
|---|---|---|
| World backgrounds | 10 | One per world, drawn from the same theme line as that world's roster (§1.4 has the table) — Thornwick Vale through **The Void**. The background and the enemies standing on it are a matched set; a world is the only place the run's progress is visible, since the stat curve is continuous and the pool never re-themes between prestiges. Art direction owed (`open-items.md` #6) |
| Stage-select / world map UI | 1 | |
| Tab backgrounds | **10** | **Corrected 2026-09-17.** This row used to name Forge, Guild, Training Grounds and Dig-site — the four tabs `open-items.md` #20 collapsed into Gacha + Collections — plus "Encyclopedia", which shipped as Wiki. Commissioning from the old list bought four backgrounds for pages that do not exist and missed four that do. **Built, from `app/pages/hero-quest.vue`: Battle, Gacha, Collections, Loadouts, Prestige, Wiki** (6). **Phase 4, not yet built: Raids, Traits, Arena, Leaderboard** (4). The Dev tab is development-only and needs no art |
| ~~Training Grounds recruitment art (3 states)~~ | 0–3 | **On hold, not locked.** `trainingGroundsArt` (Barracks / Archery Range / Wizard Tower, `skills-gacha.md` §1) dressed a page that #20 removed; the server still serializes it and nothing renders it. Either the Gacha card grows a per-system art treatment and these three are needed, or the field goes. Decide during the Pixi pass — **do not commission until then** |
| Gacha pull screen / reveal VFX | **Locked: one shared flash, recolored per rarity tier** | 1 base animation × 6 rarity recolors, not a bespoke cinematic per tier — cheap, reused everywhere |

---

## 5. UI Chrome

Unchanged, listed for completeness:

- Formation grid (3 front / 3 back, all slots freely assignable)
- Loadout save-slot cards (2→10 slots)
- Trait slot UI (5 fixed slots, roll/lock states)
- Arena candidate cards, battle log, Rating leaderboard
- Encyclopedia list + detail views (168 collectibles + 16 class nodes)
- Holiday claim banner + gift-box icon (4 holidays)

---

## 6. Branding

- Hero Quest logo
- ~~App icon~~ **Dropped 2026-09-28** (the user's call): Hero Quest is a page inside polynux, not an app of its own. The sidebar and home page show every game with a Lucide icon, the site has one favicon and no web-app manifest, so an icon had nowhere to go. Draw one if the game ever ships standalone.
- Splash/loading screen

*(Trademark note stands from before — HeroQuest is an existing, actively-republished board game with mobile ports. Worth resolving before branding assets are produced.)*

---

## Remaining Follow-Ups

**Every count on this list is decided.** Fidelity, counts and styling rules are all locked as of
2026-09-17; what remains is production, plus one gameplay decision that would change a count.

**Still open — one item, and it is not an art question:**

1. **World backgrounds (§4)** — 10, one per world, briefs are §1.4's theme column. Art direction
   owed, but nothing is undecided about the count or the fidelity.

**Not an art decision, but it changes this list:** whether enemies get ability kits
(`open-items.md` #6). A yes adds a **fifth animation state to every enemy rig** — 4 more trash
sets and 20 more boss sets — and that cost has never been priced into the kit discussion.

Plus one on hold: the three Training Grounds recruitment-art states (§4), which depend on whether
the Gacha card grows a per-system art treatment after #20.

**Decided 2026-09-17** (`open-items.md` #4 and #30):

1. ~~Champion skins (48): recolor-of-silhouette, or fuller per-rarity redesign?~~ → **fuller per-rarity redesign** on the shared chassis (Section 1.2). Chassis and animation counts unchanged.
2. ~~Do Training Grounds Active skills (18) get the same custom-VFX treatment?~~ → **yes, custom per ability** (Section 2.1). Ability VFX sets: **44 → 62**.
3. ~~Artifact procs — flash/popup, or silent?~~ → **silent, numeric log only** (Section 2.3). No art.
4. ~~Artifact icons: one per item, or one per effect?~~ → **one per item, 48** (Section 3.2). The reveal is selling distinct relics.
5. ~~Trash enemy variant count, and the per-enemy animation-state count?~~ → **4 weapon variants** (sword/axe/bow/staff) on **4 shared rigs**, **4 states** for trash and elites, **5 for bosses** — the extra one is an Entry, not a cast (Section 1.4).

---

## Real Production Volume Summary

What the numbers actually are — **every row is now a number**. The last two blocked rows (enemies,
world backgrounds) closed on 2026-09-17.

| Category | Count |
|---|---|
| Hero animated spritesheets | **80** (16 nodes × 5 states, fully unique) |
| Champion animation sets | **20** (4 chassis × 5 states — reused across all 48 Champions) |
| Champion unique skins | **48**, each a per-rarity redesign on its archetype's chassis (decided 2026-09-17) |
| Summon animated spritesheets | **6** (3 summons × 2 states) |
| Ability VFX + icons | **62** custom sets — 16 Hero skills + 28 Champion abilities + 18 Training Grounds Actives (decided 2026-09-17) |
| Raid boss designs | **5**, fully unique |
| Static icons | **217** — broken out below, because the single figure here read **164** while claiming to include currency and frames/badges, and 164 is only the first three lines of it |
| Enemy animated spritesheets | **116** — 16 trash (4 weapon rigs × 4 states, shared across all worlds) + 50 boss + 50 super boss (10 each × 5 states, bespoke). §1.4 |
| Enemy designs | **60** — 40 trash skins (4 variants × 10 worlds) + 10 bosses + 10 super bosses, plus one elite mark reused everywhere. §1.4 |
| World backgrounds | **10**, one per world, briefed in §1.4's theme column — the only line still owing art direction rather than production |

**Static icons, itemised** (corrected 2026-09-17 — the old single figure dropped 53 icons):

| Set | Count | |
|---|---|---|
| Class-tree skills | 16 | §3.1 |
| Training Grounds skills | 36 | §3.1 — all 36; only the 18 Actives also need VFX |
| Champion abilities | 28 | §3.1 |
| Artifacts | 48 | §3.2 — one per item, decided 2026-09-17 |
| Gear | 36 | §3.2 |
| Currency | 18 | §3.2 |
| Rarity tier frames | 6 | §3.3 |
| Trait grade frames | 9 | §3.3 |
| Archetype badges | 4 | §3.3 |
| Class-tree node icons | 16 | §3.3 |
| **Total** | **217** | 164 of it is skills + Artifacts + Gear, which is where the old figure stopped |

Not in that total: the **status-effect icon set**, which §2.3 gives as a range (~15–20) rather than a count. Settle the range and it lands here.

---

## Suggested Sequencing (maps to `implementation-plan.md`)

| Phase | Asset need |
|---|---|
| 0–1 (core loop prototype) | Hero — even 1–2 of the 16 node appearances is enough to validate the loop before committing to all 80 spritesheets; placeholder enemy stand-ins; minimal UI chrome |
| 2 (Champions) | Build one archetype's chassis + a handful of skins first (validates the shared-rig pipeline) before scaling to all 4 chassis / 48 skins |
| 3 (Gear/Skills/Artifacts) | Icon sets — the cheapest phase, now that Gear is confirmed icon-only with zero Hero-art interaction |
| 4 (Raids/Arena/Traits) | 5 unique raid boss designs, Training Dummy's single hit-reaction, Trait grade frames (9-color ramp) |
| 5 (content completion) | Remaining Champion skins, full 48-Artifact/48-Champion content, World & Enemy Design's entire asset list, ability VFX for the full 62 |
