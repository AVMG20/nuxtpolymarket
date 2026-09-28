# Hero Quest — Asset Checklist

One checkbox per deliverable, itemised from `asset-list.md` and the live content modules
(`shared/utils/hero-quest/content/`), 2026-09-17. **`asset-list.md` stays the source of truth for
*why* each count is what it is** — every fidelity decision, chassis/skin rule and open question
lives there and is not repeated here. This file is only the tick-list.

Names come from the code, so they are the names that ship. IDs are stable and saves reference
them — a rename here is display-only, a rename in content is not (`CLAUDE.md` §3).

**Legend:** 🎞️ = animated spritesheet · 🖼️ = static image/icon

## Totals

| Group | Boxes | `asset-list.md` |
|---|---|---|
| Hero spritesheets | 80 | 80 |
| Champion chassis animation sets | 20 | 20 |
| Champion skins | 48 | 48 |
| Summon spritesheets | 6 | 6 |
| Enemy trash rigs (animation sets) | 16 | 16 |
| Enemy trash skins | 40 | 40 |
| Elite mark | 1 | 1 |
| Boss spritesheets | 50 | 50 |
| Super boss spritesheets | 50 | 50 |
| Raid boss designs | 5 | 5 |
| Arena dummy | 2 | 2 |
| Ability VFX sets | 62 | 62 |
| Multi-strike recolors | 2 | 2 |
| Status effect icons (range, not in the 217) | 11 | ~15–20 |
| Other combat feedback | 9 | 9 |
| Static icons | 217 | 217 |
| World backgrounds | 10 | 10 |
| UI backgrounds | 11 | 11 |
| Gacha reveal | 7 | 7 |
| UI chrome | 10 | 10 |
| Branding | 3 | 3 |
| Blocked / contingent | 5 | — |
| **Total** | **665** | |

---

## 1. Characters & Combat Animation

### 1.1 Hero 🎞️ — 80 spritesheets

16 fully unique class-node appearances, no shared rig or recolor. 5 states each:
Idle, Basic Attack, Skill cast, Hit, Death. (`asset-list.md` §1.1)

#### Beginner tier (1)

- [ ] Beginner — Idle
- [ ] Beginner — Basic Attack
- [ ] Beginner — Skill cast: Haste
- [ ] Beginner — Hit
- [ ] Beginner — Death

#### Base tier (3)

- [ ] Warrior — Idle
- [ ] Warrior — Basic Attack
- [ ] Warrior — Skill cast: Whirlwind
- [ ] Warrior — Hit
- [ ] Warrior — Death

- [ ] Mage — Idle
- [ ] Mage — Basic Attack
- [ ] Mage — Skill cast: Ethereal Bouncebolt
- [ ] Mage — Hit
- [ ] Mage — Death

- [ ] Archer — Idle
- [ ] Archer — Basic Attack
- [ ] Archer — Skill cast: Piercing Arrow
- [ ] Archer — Hit
- [ ] Archer — Death

#### Elite tier (6)

- [ ] Barbarian — Idle
- [ ] Barbarian — Basic Attack
- [ ] Barbarian — Skill cast: Threatening Roar
- [ ] Barbarian — Hit
- [ ] Barbarian — Death

- [ ] Knight — Idle
- [ ] Knight — Basic Attack
- [ ] Knight — Skill cast: Shockwave
- [ ] Knight — Hit
- [ ] Knight — Death

- [ ] Wizard — Idle
- [ ] Wizard — Basic Attack
- [ ] Wizard — Skill cast: Lightning Storm
- [ ] Wizard — Hit
- [ ] Wizard — Death

- [ ] Shaman — Idle
- [ ] Shaman — Basic Attack
- [ ] Shaman — Skill cast: Totem Storm
- [ ] Shaman — Hit
- [ ] Shaman — Death

- [ ] Bowman — Idle
- [ ] Bowman — Basic Attack
- [ ] Bowman — Skill cast: Fan of Arrows
- [ ] Bowman — Hit
- [ ] Bowman — Death

- [ ] Hunter — Idle
- [ ] Hunter — Basic Attack
- [ ] Hunter — Skill cast: Kill Shot
- [ ] Hunter — Hit
- [ ] Hunter — Death

#### Master tier (6)

- [ ] Berserker — Idle
- [ ] Berserker — Basic Attack
- [ ] Berserker — Skill cast: Enrage
- [ ] Berserker — Hit
- [ ] Berserker — Death

- [ ] Paladin — Idle
- [ ] Paladin — Basic Attack
- [ ] Paladin — Skill cast: Disciple (summons the Disciple — see §1.3)
- [ ] Paladin — Hit
- [ ] Paladin — Death

- [ ] Sorcerer — Idle
- [ ] Sorcerer — Basic Attack
- [ ] Sorcerer — Skill cast: Meteor Shower
- [ ] Sorcerer — Hit
- [ ] Sorcerer — Death

- [ ] Witch Doctor — Idle
- [ ] Witch Doctor — Basic Attack
- [ ] Witch Doctor — Skill cast: Raise Dead (summons the Raised Dead — see §1.3)
- [ ] Witch Doctor — Hit
- [ ] Witch Doctor — Death

- [ ] Marksman — Idle
- [ ] Marksman — Basic Attack
- [ ] Marksman — Skill cast: Arrow Rain
- [ ] Marksman — Hit
- [ ] Marksman — Death

- [ ] Beast Master — Idle
- [ ] Beast Master — Basic Attack
- [ ] Beast Master — Skill cast: Man's Best Friend
- [ ] Beast Master — Hit
- [ ] Beast Master — Death

### 1.2 Champions 🎞️🖼️ — 20 animation sets + 48 skins

**Chassis (4 rigs × 5 states = 20 animation sets).** Animated once per archetype and reused by
every Champion of that archetype. The Ability-cast pose only triggers the ability's own VFX (§2.1).

- [ ] Damage chassis — Idle
- [ ] Damage chassis — Basic Attack
- [ ] Damage chassis — Ability-cast pose
- [ ] Damage chassis — Hit
- [ ] Damage chassis — Death

- [ ] Tank chassis — Idle
- [ ] Tank chassis — Basic Attack
- [ ] Tank chassis — Ability-cast pose
- [ ] Tank chassis — Hit
- [ ] Tank chassis — Death

- [ ] Support chassis — Idle
- [ ] Support chassis — Basic Attack
- [ ] Support chassis — Ability-cast pose
- [ ] Support chassis — Hit
- [ ] Support chassis — Death

- [ ] Control chassis — Idle
- [ ] Control chassis — Basic Attack
- [ ] Control chassis — Ability-cast pose
- [ ] Control chassis — Hit
- [ ] Control chassis — Death

**Skins (48).** One per Champion, a genuine per-rarity redesign on its archetype's chassis —
no animation work of its own. (`asset-list.md` §1.2, decided 2026-09-17)

#### Damage (12)

- [ ] Rask the Blade — Common skin  `champ_rask`
- [ ] Vheln the Edge — Common skin  `champ_vheln`
- [ ] Sorrek the Render — Uncommon skin  `champ_sorrek`
- [ ] Ayra the Lancer — Uncommon skin  `champ_ayra`
- [ ] Dorne the Ravager — Rare skin  `champ_dorne`
- [ ] Kestrel the Scourge — Rare skin  `champ_kestrel`
- [ ] Malachai the Slayer — Epic skin  `champ_malachai`
- [ ] Ryn the Fury — Epic skin  `champ_ryn`
- [ ] Vashka the Tempest — Legendary skin  `champ_vashka`
- [ ] Toren the Warbringer — Legendary skin  `champ_toren`
- [ ] Kaira the Reaver — Mythic skin  `champ_kaira`
- [ ] Draveth the Executioner — Mythic skin  `champ_draveth`

#### Tank (12)

- [ ] Borin the Bulwark — Common skin  `champ_borin`
- [ ] Hulric the Rampart — Common skin  `champ_hulric`
- [ ] Gareth the Anvil — Uncommon skin  `champ_gareth`
- [ ] Mora the Keeper — Uncommon skin  `champ_mora`
- [ ] Ulrid the Aegis — Rare skin  `champ_ulrid`
- [ ] Bastyn the Bastion — Rare skin  `champ_bastyn`
- [ ] Ordwin the Sentinel — Epic skin  `champ_ordwin`
- [ ] Katrin the Shieldwall — Epic skin  `champ_katrin`
- [ ] Volgrim the Colossus — Legendary skin  `champ_volgrim`
- [ ] Sable the Ironclad — Legendary skin  `champ_sable`
- [ ] Thoraxx the Guardian — Mythic skin  `champ_thoraxx`
- [ ] Ferrun the Unbroken — Mythic skin  `champ_ferrun`

#### Support (12)

- [ ] Meret the Sage — Common skin  `champ_meret`
- [ ] Lys the Mender — Common skin  `champ_lys`
- [ ] Tavin the Oracle — Uncommon skin  `champ_tavin`
- [ ] Ceren the Solace — Uncommon skin  `champ_ceren`
- [ ] Calen the Anchor — Rare skin  `champ_calen`
- [ ] Illyana the Chorus — Rare skin  `champ_illyana`
- [ ] Ordo the Warden — Epic skin  `champ_ordo`
- [ ] Nieve the Lightbearer — Epic skin  `champ_nieve`
- [ ] Aurelith the Benediction — Legendary skin  `champ_aurelith`
- [ ] Mistral the Harbinger — Legendary skin  `champ_mistral`
- [ ] Seraphel the Blessed — Mythic skin  `champ_seraphel`
- [ ] Vaelora the Lifebinder — Mythic skin  `champ_vaelora`

#### Control (12)

- [ ] Ilyx the Binder — Common skin  `champ_ilyx`
- [ ] Nym the Whisper — Common skin  `champ_nym`
- [ ] Fesk the Hexer — Uncommon skin  `champ_fesk`
- [ ] Orien the Fetter — Uncommon skin  `champ_orien`
- [ ] Varn the Trickster — Rare skin  `champ_varn`
- [ ] Sylwen the Snare — Rare skin  `champ_sylwen`
- [ ] Corvath the Veil — Epic skin  `champ_corvath`
- [ ] Ashen the Riddle — Epic skin  `champ_ashen`
- [ ] Nixara the Nullifier — Legendary skin  `champ_nixara`
- [ ] Thess the Unmaker — Legendary skin  `champ_thess`
- [ ] Zeraphine the Weaver — Mythic skin  `champ_zeraphine`
- [ ] Umbriel the Shade — Mythic skin  `champ_umbriel`

### 1.3 Companion / Summon Units 🎞️ — 6 spritesheets

Move and Attack only — deliberately no Hit and no Death. (`asset-list.md` §1.3)

- [ ] Disciple (Paladin's skill) — Move
- [ ] Disciple (Paladin's skill) — Attack

- [ ] Raised Dead (Witch Doctor's skill) — Move
- [ ] Raised Dead (Witch Doctor's skill) — Attack

- [ ] Wolf (Beast Master's kit) — Move
- [ ] Wolf (Beast Master's kit) — Attack

### 1.4 Enemies 🎞️🖼️ — 116 spritesheets + 60 designs

**Trash rigs (4 weapons × 4 states = 16 animation sets).** The weapon is the rig; the world is
the skin. Four states, not five — enemies have no abilities, so there is no cast to animate.

- [ ] Sword rig — Idle
- [ ] Sword rig — Attack
- [ ] Sword rig — Hit
- [ ] Sword rig — Death

- [ ] Axe rig — Idle
- [ ] Axe rig — Attack
- [ ] Axe rig — Hit
- [ ] Axe rig — Death

- [ ] Bow rig — Idle
- [ ] Bow rig — Attack
- [ ] Bow rig — Hit
- [ ] Bow rig — Death

- [ ] Mage-staff rig — Idle
- [ ] Mage-staff rig — Attack
- [ ] Mage-staff rig — Hit
- [ ] Mage-staff rig — Death

**Trash skins (4 weapon variants × 10 worlds = 40 designs).** Each wears an outfit matching its
weapon type *and* its world. Elites reuse these — see the mark below.

#### 1. Thornwick Vale — Bramble Goblin

*Frontier farmland at the edge of the kingdom, where the first cracks have turned the hedgerows feral.*

- [ ] Bramble Goblin — sword
- [ ] Bramble Goblin — axe
- [ ] Bramble Goblin — bow
- [ ] Bramble Goblin — mage-staff

#### 2. Mirewood — Bog Lurker

*A drowned forest of black water and hanging moss, rotting from the roots up.*

- [ ] Bog Lurker — sword
- [ ] Bog Lurker — axe
- [ ] Bog Lurker — bow
- [ ] Bog Lurker — mage-staff

#### 3. Cinderpass — Cinder Kobold

*A volcanic mountain pass choked with ash, held by kobold clans and the thing they worship.*

- [ ] Cinder Kobold — sword
- [ ] Cinder Kobold — axe
- [ ] Cinder Kobold — bow
- [ ] Cinder Kobold — mage-staff

#### 4. Rimeholt — Frostbound Raider

*A frozen northern hold whose raiders swore themselves to a cold that does not end.*

- [ ] Frostbound Raider — sword
- [ ] Frostbound Raider — axe
- [ ] Frostbound Raider — bow
- [ ] Frostbound Raider — mage-staff

#### 5. Sunken Amarath — Drowned Sailor

*The drowned capital of a sea-empire, its dead still keeping the tides.*

- [ ] Drowned Sailor — sword
- [ ] Drowned Sailor — axe
- [ ] Drowned Sailor — bow
- [ ] Drowned Sailor — mage-staff

#### 6. Duskspire — Hollow Acolyte

*A city of mage-towers held at twilight since its archmage opened a door to the Void.*

- [ ] Hollow Acolyte — sword
- [ ] Hollow Acolyte — axe
- [ ] Hollow Acolyte — bow
- [ ] Hollow Acolyte — mage-staff

#### 7. The Bonefields — Restless Legionnaire

*An ancient battlefield where the fallen of a forgotten war rise to fight it again.*

- [ ] Restless Legionnaire — sword
- [ ] Restless Legionnaire — axe
- [ ] Restless Legionnaire — bow
- [ ] Restless Legionnaire — mage-staff

#### 8. The Shattered Sky — Skyshard Wisp

*Islands of torn-loose stone adrift in a storm the Void has unmoored.*

- [ ] Skyshard Wisp — sword
- [ ] Skyshard Wisp — axe
- [ ] Skyshard Wisp — bow
- [ ] Skyshard Wisp — mage-staff

#### 9. The Brink — Unravelled Knight

*The edge of the world, where colour, sound and memory come apart thread by thread.*

- [ ] Unravelled Knight — sword
- [ ] Unravelled Knight — axe
- [ ] Unravelled Knight — bow
- [ ] Unravelled Knight — mage-staff

#### 10. The Void — Void Thrall

*Nothing, pressing in — where every crack leads, and where each run ends before it begins again.*

- [ ] Void Thrall — sword
- [ ] Void Thrall — axe
- [ ] Void Thrall — bow
- [ ] Void Thrall — mage-staff

**Elite mark (1).** One consistent treatment — aura, banner, scar — applied across all ten worlds
and all four weapon variants, so the player learns it once. No animation of its own.

- [ ] Elite visual mark — single treatment, reused everywhere

**Bosses (10 designs × 5 states = 50 spritesheets).** The fifth state is an Entry, not a cast —
the boss arriving. Drop to 4 if it does not earn its keep in playtest (`asset-list.md` §1.4).

#### Old Gnarlhide — Thornwick Vale

- [ ] Old Gnarlhide — Entry
- [ ] Old Gnarlhide — Idle
- [ ] Old Gnarlhide — Attack
- [ ] Old Gnarlhide — Hit
- [ ] Old Gnarlhide — Death

#### Mother Leech — Mirewood

- [ ] Mother Leech — Entry
- [ ] Mother Leech — Idle
- [ ] Mother Leech — Attack
- [ ] Mother Leech — Hit
- [ ] Mother Leech — Death

#### Slagjaw — Cinderpass

- [ ] Slagjaw — Entry
- [ ] Slagjaw — Idle
- [ ] Slagjaw — Attack
- [ ] Slagjaw — Hit
- [ ] Slagjaw — Death

#### Jarl Hrimgar — Rimeholt

- [ ] Jarl Hrimgar — Entry
- [ ] Jarl Hrimgar — Idle
- [ ] Jarl Hrimgar — Attack
- [ ] Jarl Hrimgar — Hit
- [ ] Jarl Hrimgar — Death

#### Tidecaller Nerine — Sunken Amarath

- [ ] Tidecaller Nerine — Entry
- [ ] Tidecaller Nerine — Idle
- [ ] Tidecaller Nerine — Attack
- [ ] Tidecaller Nerine — Hit
- [ ] Tidecaller Nerine — Death

#### Magister Halvane — Duskspire

- [ ] Magister Halvane — Entry
- [ ] Magister Halvane — Idle
- [ ] Magister Halvane — Attack
- [ ] Magister Halvane — Hit
- [ ] Magister Halvane — Death

#### Grave Marshal Korr — The Bonefields

- [ ] Grave Marshal Korr — Entry
- [ ] Grave Marshal Korr — Idle
- [ ] Grave Marshal Korr — Attack
- [ ] Grave Marshal Korr — Hit
- [ ] Grave Marshal Korr — Death

#### Stormcrown Roc — The Shattered Sky

- [ ] Stormcrown Roc — Entry
- [ ] Stormcrown Roc — Idle
- [ ] Stormcrown Roc — Attack
- [ ] Stormcrown Roc — Hit
- [ ] Stormcrown Roc — Death

#### Sister Vesper, the Forgotten — The Brink

- [ ] Sister Vesper, the Forgotten — Entry
- [ ] Sister Vesper, the Forgotten — Idle
- [ ] Sister Vesper, the Forgotten — Attack
- [ ] Sister Vesper, the Forgotten — Hit
- [ ] Sister Vesper, the Forgotten — Death

#### Void Herald — The Void

- [ ] Void Herald — Entry
- [ ] Void Herald — Idle
- [ ] Void Herald — Attack
- [ ] Void Herald — Hit
- [ ] Void Herald — Death

**Super bosses (10 designs × 5 states = 50 spritesheets).** The most elaborate art in each world.

#### Gorsecrown, King of Hedges — Thornwick Vale

- [ ] Gorsecrown, King of Hedges — Entry
- [ ] Gorsecrown, King of Hedges — Idle
- [ ] Gorsecrown, King of Hedges — Attack
- [ ] Gorsecrown, King of Hedges — Hit
- [ ] Gorsecrown, King of Hedges — Death

#### Rotheart, the Sunken Elder — Mirewood

- [ ] Rotheart, the Sunken Elder — Entry
- [ ] Rotheart, the Sunken Elder — Idle
- [ ] Rotheart, the Sunken Elder — Attack
- [ ] Rotheart, the Sunken Elder — Hit
- [ ] Rotheart, the Sunken Elder — Death

#### Pyrrhax, the Molten Wyrm — Cinderpass

- [ ] Pyrrhax, the Molten Wyrm — Entry
- [ ] Pyrrhax, the Molten Wyrm — Idle
- [ ] Pyrrhax, the Molten Wyrm — Attack
- [ ] Pyrrhax, the Molten Wyrm — Hit
- [ ] Pyrrhax, the Molten Wyrm — Death

#### Vinterhel, the Glacier Titan — Rimeholt

- [ ] Vinterhel, the Glacier Titan — Entry
- [ ] Vinterhel, the Glacier Titan — Idle
- [ ] Vinterhel, the Glacier Titan — Attack
- [ ] Vinterhel, the Glacier Titan — Hit
- [ ] Vinterhel, the Glacier Titan — Death

#### Queen Maerith of the Deep — Sunken Amarath

- [ ] Queen Maerith of the Deep — Entry
- [ ] Queen Maerith of the Deep — Idle
- [ ] Queen Maerith of the Deep — Attack
- [ ] Queen Maerith of the Deep — Hit
- [ ] Queen Maerith of the Deep — Death

#### Archmage Ithren, the Door-Opener — Duskspire

- [ ] Archmage Ithren, the Door-Opener — Entry
- [ ] Archmage Ithren, the Door-Opener — Idle
- [ ] Archmage Ithren, the Door-Opener — Attack
- [ ] Archmage Ithren, the Door-Opener — Hit
- [ ] Archmage Ithren, the Door-Opener — Death

#### Ossuar, the Thousand-Bone Host — The Bonefields

- [ ] Ossuar, the Thousand-Bone Host — Entry
- [ ] Ossuar, the Thousand-Bone Host — Idle
- [ ] Ossuar, the Thousand-Bone Host — Attack
- [ ] Ossuar, the Thousand-Bone Host — Hit
- [ ] Ossuar, the Thousand-Bone Host — Death

#### Zephyrax, Breaker of Heavens — The Shattered Sky

- [ ] Zephyrax, Breaker of Heavens — Entry
- [ ] Zephyrax, Breaker of Heavens — Idle
- [ ] Zephyrax, Breaker of Heavens — Attack
- [ ] Zephyrax, Breaker of Heavens — Hit
- [ ] Zephyrax, Breaker of Heavens — Death

#### Liminus, the Last Door — The Brink

- [ ] Liminus, the Last Door — Entry
- [ ] Liminus, the Last Door — Idle
- [ ] Liminus, the Last Door — Attack
- [ ] Liminus, the Last Door — Hit
- [ ] Liminus, the Last Door — Death

#### Nihil, the Hunger at the End — The Void

- [ ] Nihil, the Hunger at the End — Entry
- [ ] Nihil, the Hunger at the End — Idle
- [ ] Nihil, the Hunger at the End — Attack
- [ ] Nihil, the Hunger at the End — Hit
- [ ] Nihil, the Hunger at the End — Death

### 1.5 Raid Bosses 🎞️ — 5 unique designs

No reuse between them, and none with the campaign roster. (`asset-list.md` §1.5)

- [ ] Guild Raid boss — `solo_boss`
- [ ] Training Grounds Raid boss — `training_dummy` — a massive static training dummy: Entry (falls from the sky), Idle and Hit only, no Attack or Death
- [ ] Dig-site Raid boss — `reinforced_boss` — plus its own add-wave enemy designs (count not yet specified)
- [ ] Forge Raid boss — `phased_boss` — needs a visually distinct state per HP-threshold phase
- [ ] Trait Raid boss — `rampaging_boss` — unkillable, so no death animation ever plays; needs its own visual language with no HP bar (`raid-system.md` §7)

### 1.6 Arena Training Dummy 🎞️ — 1 animation

- [ ] Training dummy — static pose 🖼️
- [ ] Training dummy — hit reaction 🎞️ (no idle loop, no attack of its own)

---

## 2. Combat VFX & Feedback

### 2.1 Ability VFX 🎞️ — 62 custom sets

Custom VFX animation per ability, no shared template library at this stage. **The matching icons
are counted in §3.1** — tick them there, not here.

**Hero class skills (16)**

- [ ] Haste — Beginner  `skill_haste`
- [ ] Whirlwind — Warrior  `skill_whirlwind`
- [ ] Threatening Roar — Barbarian  `skill_threatening_roar`
- [ ] Enrage — Berserker  `skill_enrage`
- [ ] Shockwave — Knight  `skill_shockwave`
- [ ] Disciple — Paladin  `skill_disciple`
- [ ] Ethereal Bouncebolt — Mage  `skill_ethereal_bouncebolt`
- [ ] Lightning Storm — Wizard  `skill_lightning_storm`
- [ ] Meteor Shower — Sorcerer  `skill_meteor_shower`
- [ ] Totem Storm — Shaman  `skill_totem_storm`
- [ ] Raise Dead — Witch Doctor  `skill_raise_dead`
- [ ] Piercing Arrow — Archer  `skill_piercing_arrow`
- [ ] Fan of Arrows — Bowman  `skill_fan_of_arrows`
- [ ] Arrow Rain — Marksman  `skill_arrow_rain`
- [ ] Kill Shot — Hunter  `skill_kill_shot`
- [ ] Man's Best Friend — Beast Master  `skill_mans_best_friend`

**Champion abilities (28)** — 7 per archetype, shared across that archetype's 12 Champions.

*Damage*

- [ ] Cleave — Damage
- [ ] Piercing Bolt — Damage
- [ ] Rising Flame — Damage
- [ ] Execute Strike — Damage
- [ ] Volley — Damage
- [ ] Focused Barrage — Damage
- [ ] Rupture — Damage

*Tank*

- [ ] Provoke — Tank
- [ ] Bulwark Stance — Tank
- [ ] Guardian's Reflect — Tank
- [ ] Rallying Shout — Tank
- [ ] Iron Skin — Tank
- [ ] Ground Slam — Tank
- [ ] Guardian's Vow — Tank

*Support*

- [ ] Mending Light — Support
- [ ] Sanctuary — Support
- [ ] Tide of Renewal — Support
- [ ] Empower — Support
- [ ] Haste Blessing — Support
- [ ] Second Wind — Support
- [ ] Purify — Support

*Control*

- [ ] Weaken — Control
- [ ] Slow — Control
- [ ] Silence — Control
- [ ] Shatter Armor — Control
- [ ] Chain Bind — Control
- [ ] Unraveling Curse — Control
- [ ] Frostbind — Control

**Training Grounds Actives (18).** Decided 2026-09-17: same custom-per-ability treatment as Hero
skills — sharing VFX would make a pulled Skill look like a skin of something already owned. The
18 Passives need nothing; they have no cast moment.

- [ ] Quick Strike — Common  `skill_quick_strike`
- [ ] Steadying Breath — Common  `skill_steadying_breath`
- [ ] Coin Toss — Common  `skill_coin_toss`
- [ ] Focused Blow — Uncommon  `skill_focused_blow`
- [ ] Adrenaline Surge — Uncommon  `skill_adrenaline_surge`
- [ ] Prospector's Instinct — Uncommon  `skill_prospectors_instinct`
- [ ] Piercing Focus — Rare  `skill_piercing_focus`
- [ ] Vigor Renewal — Rare  `skill_vigor_renewal`
- [ ] Gambler's Strike — Rare  `skill_gamblers_strike`
- [ ] Twin Strike — Epic  `skill_twin_strike`
- [ ] Battlefield Surge — Epic  `skill_battlefield_surge`
- [ ] Treasure Hunter's Gambit — Epic  `skill_treasure_hunters_gambit`
- [ ] Executioner's Edge — Legendary  `skill_executioners_edge`
- [ ] Phoenix Draught — Legendary  `skill_phoenix_draught`
- [ ] Fortune's Gambit — Legendary  `skill_fortunes_gambit`
- [ ] Ragnarok Strike — Mythic  `skill_ragnarok_strike`
- [ ] Aegis of Renewal — Mythic  `skill_aegis_of_renewal`
- [ ] King's Ransom — Mythic  `skill_kings_ransom`

### 2.2 Multi-Strike Animation 🎞️ — 2 recolors

- [ ] Hunter triple-strike — recolor of the Archer-path single-strike, fired 3×
- [ ] Beast Master quad-strike — recolor of the Archer-path single-strike, fired 4×

### 2.3 Other Feedback

**Status effect icons 🖼️ — ~15–20 types.** `asset-list.md` §2.3 gives a range, not a count; the ten
named types are below and the remainder lands when the range is settled. **This set is *not* in the
217-icon total** for the same reason.

- [ ] Status icon — Burn / DoT
- [ ] Status icon — Stun
- [ ] Status icon — Slow
- [ ] Status icon — Silence
- [ ] Status icon — Armor shred
- [ ] Status icon — Curse
- [ ] Status icon — Shield
- [ ] Status icon — Buff
- [ ] Status icon — Debuff-immunity
- [ ] Status icon — Evasion
- [ ] Status icons — settle the 15–20 range, then itemise the remainder

**Everything else**

- [ ] Damage number style 🖼️ — normal hit
- [ ] Damage number style 🖼️ — crit hit
- [ ] Damage number style 🖼️ — heal
- [ ] Damage number style 🖼️ — miss / evasion text
- [ ] HP bar + party frame 🖼️ — portrait, HP, active status icons, per party member
- [ ] Cooldown radial-fill overlay 🖼️ — per equipped skill icon
- [ ] Boss enrage-timer UI 🖼️ — 3 of the 4 raid fight types
- [ ] Reinforced Boss add-wave spawn VFX 🎞️ — Dig-site Raid
- [ ] Phased Boss phase-transition VFX 🎞️ — Forge Raid

> Artifact proc feedback was **cut** 2026-09-17 — log-only, no art. Nothing to build.

---

## 3. Static Icons 🖼️ — 217

### 3.1 Ability & Skill Icons — 80

**Class-tree skills (16) — square** (`skills-gacha.md` §7, locked convention).

- [ ] Haste — Beginner  `skill_haste`
- [ ] Whirlwind — Warrior  `skill_whirlwind`
- [ ] Threatening Roar — Barbarian  `skill_threatening_roar`
- [ ] Enrage — Berserker  `skill_enrage`
- [ ] Shockwave — Knight  `skill_shockwave`
- [ ] Disciple — Paladin  `skill_disciple`
- [ ] Ethereal Bouncebolt — Mage  `skill_ethereal_bouncebolt`
- [ ] Lightning Storm — Wizard  `skill_lightning_storm`
- [ ] Meteor Shower — Sorcerer  `skill_meteor_shower`
- [ ] Totem Storm — Shaman  `skill_totem_storm`
- [ ] Raise Dead — Witch Doctor  `skill_raise_dead`
- [ ] Piercing Arrow — Archer  `skill_piercing_arrow`
- [ ] Fan of Arrows — Bowman  `skill_fan_of_arrows`
- [ ] Arrow Rain — Marksman  `skill_arrow_rain`
- [ ] Kill Shot — Hunter  `skill_kill_shot`
- [ ] Man's Best Friend — Beast Master  `skill_mans_best_friend`

**Training Grounds skills (36) — circular,** deliberately distinct from class skills. All 36 need
an icon; only the 18 Actives also need VFX (§2.1).

*Active (18)*

- [ ] Quick Strike — Common  `skill_quick_strike`
- [ ] Steadying Breath — Common  `skill_steadying_breath`
- [ ] Coin Toss — Common  `skill_coin_toss`
- [ ] Focused Blow — Uncommon  `skill_focused_blow`
- [ ] Adrenaline Surge — Uncommon  `skill_adrenaline_surge`
- [ ] Prospector's Instinct — Uncommon  `skill_prospectors_instinct`
- [ ] Piercing Focus — Rare  `skill_piercing_focus`
- [ ] Vigor Renewal — Rare  `skill_vigor_renewal`
- [ ] Gambler's Strike — Rare  `skill_gamblers_strike`
- [ ] Twin Strike — Epic  `skill_twin_strike`
- [ ] Battlefield Surge — Epic  `skill_battlefield_surge`
- [ ] Treasure Hunter's Gambit — Epic  `skill_treasure_hunters_gambit`
- [ ] Executioner's Edge — Legendary  `skill_executioners_edge`
- [ ] Phoenix Draught — Legendary  `skill_phoenix_draught`
- [ ] Fortune's Gambit — Legendary  `skill_fortunes_gambit`
- [ ] Ragnarok Strike — Mythic  `skill_ragnarok_strike`
- [ ] Aegis of Renewal — Mythic  `skill_aegis_of_renewal`
- [ ] King's Ransom — Mythic  `skill_kings_ransom`

*Passive (18)*

- [ ] Marching Drill — Common  `skill_marching_drill`
- [ ] Iron Discipline — Common  `skill_iron_discipline`
- [ ] Apprentice's Ledger — Common  `skill_apprentices_ledger`
- [ ] Sharpened Reflexes — Uncommon  `skill_sharpened_reflexes`
- [ ] Endurance Training — Uncommon  `skill_endurance_training`
- [ ] Scholar's Notes — Uncommon  `skill_scholars_notes`
- [ ] Battle Focus — Rare  `skill_battle_focus`
- [ ] Fortified Resolve — Rare  `skill_fortified_resolve`
- [ ] Merchant's Eye — Rare  `skill_merchants_eye`
- [ ] Veteran's Instincts — Epic  `skill_veterans_instincts`
- [ ] Warlord's Ledger — Epic  `skill_warlords_ledger`
- [ ] Adaptive Plating — Epic  `skill_adaptive_plating`
- [ ] Grandmaster's Focus — Legendary  `skill_grandmasters_focus`
- [ ] Tycoon's Vault — Legendary  `skill_tycoons_vault`
- [ ] Unbreakable Will — Legendary  `skill_unbreakable_will`
- [ ] Ascendant's Grace — Mythic  `skill_ascendants_grace`
- [ ] Emperor's Treasury — Mythic  `skill_emperors_treasury`
- [ ] Immortal Vanguard — Mythic  `skill_immortal_vanguard`

**Champion abilities (28)**

- [ ] Cleave — Damage
- [ ] Piercing Bolt — Damage
- [ ] Rising Flame — Damage
- [ ] Execute Strike — Damage
- [ ] Volley — Damage
- [ ] Focused Barrage — Damage
- [ ] Rupture — Damage

- [ ] Provoke — Tank
- [ ] Bulwark Stance — Tank
- [ ] Guardian's Reflect — Tank
- [ ] Rallying Shout — Tank
- [ ] Iron Skin — Tank
- [ ] Ground Slam — Tank
- [ ] Guardian's Vow — Tank

- [ ] Mending Light — Support
- [ ] Sanctuary — Support
- [ ] Tide of Renewal — Support
- [ ] Empower — Support
- [ ] Haste Blessing — Support
- [ ] Second Wind — Support
- [ ] Purify — Support

- [ ] Weaken — Control
- [ ] Slow — Control
- [ ] Silence — Control
- [ ] Shatter Armor — Control
- [ ] Chain Bind — Control
- [ ] Unraveling Curse — Control
- [ ] Frostbind — Control

### 3.2 Item Icons — 102

**Artifacts (48) — one icon per item,** not one per underlying effect. The Dig-site reveal is
selling 48 distinct relics (decided 2026-09-17).

#### Offense (12)

- [ ] Goblin Cudgel — Common  `artifact_offense_0`
- [ ] Tracker's Flint — Common  `artifact_offense_1`
- [ ] Slagjaw's Tooth — Uncommon  `artifact_offense_2`
- [ ] Frostbound War Drum — Uncommon  `artifact_offense_3`
- [ ] Dawnbreak Arrowhead — Rare  `artifact_offense_4`
- [ ] Last Legion Standard — Rare  `artifact_offense_5`
- [ ] Hrimgar's Icebreaker — Epic  `artifact_offense_6`
- [ ] Eye of Pyrrhax — Epic  `artifact_offense_7`
- [ ] Stormcrown Talon — Legendary  `artifact_offense_8`
- [ ] Banner of the Bonefields — Legendary  `artifact_offense_9`
- [ ] Ithren's Burning Sigil — Mythic  `artifact_offense_10`
- [ ] Key to the Last Door — Mythic  `artifact_offense_11`

#### Defense (12)

- [ ] Hedgeknight Buckler — Common  `artifact_defense_0`
- [ ] Mireroot Charm — Common  `artifact_defense_1`
- [ ] Cinderscale Shard — Uncommon  `artifact_defense_2`
- [ ] Rimeholt Hearthstone — Uncommon  `artifact_defense_3`
- [ ] Tideglass Pendant — Rare  `artifact_defense_4`
- [ ] Mother Leech's Vial — Rare  `artifact_defense_5`
- [ ] Grave Marshal's Pauldron — Epic  `artifact_defense_6`
- [ ] Rotheart Barkshield — Epic  `artifact_defense_7`
- [ ] Glacier Titan's Heart — Legendary  `artifact_defense_8`
- [ ] Maerith's Pearl — Legendary  `artifact_defense_9`
- [ ] Ossuar's Bone Mantle — Mythic  `artifact_defense_10`
- [ ] Vesper's Forgotten Hymn — Mythic  `artifact_defense_11`

#### Tempo (12)

- [ ] Bramblefoot Sandals — Common  `artifact_tempo_0`
- [ ] Marsh Hourglass — Common  `artifact_tempo_1`
- [ ] Ashwalker Anklet — Uncommon  `artifact_tempo_2`
- [ ] Frostbite Horn — Uncommon  `artifact_tempo_3`
- [ ] Sailor's Distress Bell — Rare  `artifact_tempo_4`
- [ ] Acolyte's Prayer Beads — Rare  `artifact_tempo_5`
- [ ] Halvane's Spellglass — Epic  `artifact_tempo_6`
- [ ] Korr's Marching Drum — Epic  `artifact_tempo_7`
- [ ] Skyshard Prism — Legendary  `artifact_tempo_8`
- [ ] Zephyrax Wingbone — Legendary  `artifact_tempo_9`
- [ ] Lodestone of the Brink — Mythic  `artifact_tempo_10`
- [ ] Herald's Stopped Clock — Mythic  `artifact_tempo_11`

#### Fortune (12)

- [ ] Thornwick Copper — Common  `artifact_fortune_0`
- [ ] Hedge-Witch Almanac — Common  `artifact_fortune_1`
- [ ] Mirewood Night Lantern — Uncommon  `artifact_fortune_2`
- [ ] Kobold Prospecting Pick — Uncommon  `artifact_fortune_3`
- [ ] Rimeholt Saga Stone — Rare  `artifact_fortune_4`
- [ ] Amarath Tide Ledger — Rare  `artifact_fortune_5`
- [ ] Sunken Doubloon — Epic  `artifact_fortune_6`
- [ ] Duskspire Star Chart — Epic  `artifact_fortune_7`
- [ ] Grave Robber's Spade — Legendary  `artifact_fortune_8`
- [ ] Tome of Unfinished Lessons — Legendary  `artifact_fortune_9`
- [ ] Hoard of the Shattered Sky — Mythic  `artifact_fortune_10`
- [ ] Last Coin of the Void — Mythic  `artifact_fortune_11`

**Gear (36) — icon only.** Equipping is never visible on the Hero sprite, so there is zero
interaction with §1.1.

#### Weapon (6)

- [ ] Novice Weapon  `gear_weapon_common`
- [ ] Adept Weapon  `gear_weapon_uncommon`
- [ ] Veteran Weapon  `gear_weapon_rare`
- [ ] Vanguard Weapon  `gear_weapon_epic`
- [ ] Exalted Weapon  `gear_weapon_legendary`
- [ ] Ascendant Weapon  `gear_weapon_mythic`

#### Boots (6)

- [ ] Novice Boots  `gear_boots_common`
- [ ] Adept Boots  `gear_boots_uncommon`
- [ ] Veteran Boots  `gear_boots_rare`
- [ ] Vanguard Boots  `gear_boots_epic`
- [ ] Exalted Boots  `gear_boots_legendary`
- [ ] Ascendant Boots  `gear_boots_mythic`

#### Gauntlets (6)

- [ ] Novice Gauntlets  `gear_gauntlets_common`
- [ ] Adept Gauntlets  `gear_gauntlets_uncommon`
- [ ] Veteran Gauntlets  `gear_gauntlets_rare`
- [ ] Vanguard Gauntlets  `gear_gauntlets_epic`
- [ ] Exalted Gauntlets  `gear_gauntlets_legendary`
- [ ] Ascendant Gauntlets  `gear_gauntlets_mythic`

#### Charm (6)

- [ ] Novice Charm  `gear_charm_common`
- [ ] Adept Charm  `gear_charm_uncommon`
- [ ] Veteran Charm  `gear_charm_rare`
- [ ] Vanguard Charm  `gear_charm_epic`
- [ ] Exalted Charm  `gear_charm_legendary`
- [ ] Ascendant Charm  `gear_charm_mythic`

#### Armor (6)

- [ ] Novice Armor  `gear_armor_common`
- [ ] Adept Armor  `gear_armor_uncommon`
- [ ] Veteran Armor  `gear_armor_rare`
- [ ] Vanguard Armor  `gear_armor_epic`
- [ ] Exalted Armor  `gear_armor_legendary`
- [ ] Ascendant Armor  `gear_armor_mythic`

#### Helmet (6)

- [ ] Novice Helmet  `gear_helmet_common`
- [ ] Adept Helmet  `gear_helmet_uncommon`
- [ ] Veteran Helmet  `gear_helmet_rare`
- [ ] Vanguard Helmet  `gear_helmet_epic`
- [ ] Exalted Helmet  `gear_helmet_legendary`
- [ ] Ascendant Helmet  `gear_helmet_mythic`

**Currency (18)**

- [ ] Gold icon
- [ ] Gems icon
- [ ] Void Shards icon
- [ ] Skill Seal icon
- [ ] Champion Seal icon
- [ ] Gear Seal icon
- [ ] Artifact Seal icon
- [ ] Skill Essence icon
- [ ] Champion Essence icon
- [ ] Gear Essence icon
- [ ] Artifact Essence icon
- [ ] Trait Gems icon
- [ ] Guild Raid Key icon
- [ ] Training Grounds Raid Key icon
- [ ] Dig-site Raid Key icon
- [ ] Forge Raid Key icon
- [ ] Trait Raid Key icon
- [ ] Arena Medals icon

### 3.3 Frames & Badges — 35

**Rarity tier frames (6)** — shared across all 4 gachas.

- [ ] Common frame/border (gray)
- [ ] Uncommon frame/border
- [ ] Rare frame/border
- [ ] Epic frame/border
- [ ] Legendary frame/border
- [ ] Mythic frame/border (red)

**Trait grade frames (9)** — a fully separate 9-color ramp, independent of the 6-tier rarity
palette (locked).

- [ ] Trait grade F frame
- [ ] Trait grade E frame
- [ ] Trait grade D frame
- [ ] Trait grade C frame
- [ ] Trait grade B frame
- [ ] Trait grade A frame
- [ ] Trait grade S frame
- [ ] Trait grade SS frame
- [ ] Trait grade SSS frame

**Archetype badges (4)**

- [ ] Damage badge
- [ ] Tank badge
- [ ] Support badge
- [ ] Control badge

**Class-tree node icons (16)** — for the tree-selection UI, distinct from the node's skill icon.

- [ ] Beginner node icon  `class_beginner`
- [ ] Warrior node icon  `class_warrior`
- [ ] Barbarian node icon  `class_barbarian`
- [ ] Berserker node icon  `class_berserker`
- [ ] Knight node icon  `class_knight`
- [ ] Paladin node icon  `class_paladin`
- [ ] Mage node icon  `class_mage`
- [ ] Wizard node icon  `class_wizard`
- [ ] Sorcerer node icon  `class_sorcerer`
- [ ] Shaman node icon  `class_shaman`
- [ ] Witch Doctor node icon  `class_witch_doctor`
- [ ] Archer node icon  `class_archer`
- [ ] Bowman node icon  `class_bowman`
- [ ] Marksman node icon  `class_marksman`
- [ ] Hunter node icon  `class_hunter`
- [ ] Beast Master node icon  `class_beast_master`

---

## 4. Backgrounds & Environments

### 4.1 World backgrounds — 10

One per world, drawn from the same theme line as that world's roster. **Art direction still owed**
(`open-items.md` #6) — the count and fidelity are not in question, the direction is.

- [ ] 1. Thornwick Vale — *Frontier farmland at the edge of the kingdom, where the first cracks have turned the hedgerows feral.*
- [ ] 2. Mirewood — *A drowned forest of black water and hanging moss, rotting from the roots up.*
- [ ] 3. Cinderpass — *A volcanic mountain pass choked with ash, held by kobold clans and the thing they worship.*
- [ ] 4. Rimeholt — *A frozen northern hold whose raiders swore themselves to a cold that does not end.*
- [ ] 5. Sunken Amarath — *The drowned capital of a sea-empire, its dead still keeping the tides.*
- [ ] 6. Duskspire — *A city of mage-towers held at twilight since its archmage opened a door to the Void.*
- [ ] 7. The Bonefields — *An ancient battlefield where the fallen of a forgotten war rise to fight it again.*
- [ ] 8. The Shattered Sky — *Islands of torn-loose stone adrift in a storm the Void has unmoored.*
- [ ] 9. The Brink — *The last ground at the edge of the world, where the storm has burned out, the sky has gone to stars and everything left is falling toward the Void.*
- [ ] 10. The Void — *Nothing, pressing in — where every crack leads, and where each run ends before it begins again.*

### 4.2 UI backgrounds — 11

- [ ] Stage-select / world map UI

**Tab backgrounds (10).** Built, from `app/pages/hero-quest.vue`:

- [ ] Battle tab background
- [ ] Gacha tab background
- [ ] Collections tab background
- [ ] Loadouts tab background
- [ ] Prestige tab background
- [ ] Wiki tab background

**Phase 4, not yet built:**

- [ ] Raids tab background
- [ ] Traits tab background
- [ ] Arena tab background
- [ ] Leaderboard tab background

> The Dev tab is development-only and needs no art.

### 4.3 Gacha reveal — 7

One shared flash recolored per rarity tier, not a bespoke cinematic per tier.

- [ ] Gacha pull reveal — base flash animation 🎞️
- [ ] Gacha reveal — Common recolor
- [ ] Gacha reveal — Uncommon recolor
- [ ] Gacha reveal — Rare recolor
- [ ] Gacha reveal — Epic recolor
- [ ] Gacha reveal — Legendary recolor
- [ ] Gacha reveal — Mythic recolor

---

## 5. UI Chrome

- [ ] Formation grid — 3 front / 3 back, all slots freely assignable
- [ ] Loadout save-slot cards — 2→10 slots
- [ ] Trait slot UI — 5 fixed slots, roll and lock states
- [ ] Arena candidate cards
- [ ] Arena battle log
- [ ] Arena Rating leaderboard
- [ ] Encyclopedia list view — 168 collectibles + 16 class nodes
- [ ] Encyclopedia detail view
- [ ] Holiday claim banner
- [ ] Holiday gift-box icon — 4 holidays

---

## 6. Branding

- [ ] Hero Quest logo
- [x] ~~App icon~~ dropped 2026-09-28: no use on the platform (`asset-list.md` §6)
- [ ] Splash / loading screen

> ⚠ Trademark: HeroQuest is an existing, actively-republished board game with mobile ports.
> Worth resolving **before** these three are produced.

---

## 7. Blocked, contingent or on hold

Not counted above. Each is waiting on a decision, not on production capacity.

- [ ] **Training Grounds recruitment art (0–3)** — Barracks / Archery Range / Wizard Tower. `trainingGroundsArt` is still serialized and nothing renders it since #20 removed the page. Either the Gacha card grows a per-system art treatment, or the field goes. **Decide during the Pixi pass — do not commission until then.**
- [ ] **Enemy fifth animation state (+24 sets)** — only if the enemy-kit question (`open-items.md` #6) is answered yes: 4 more trash sets and 20 more boss sets. A gameplay decision whose art cost has never been priced into the kit discussion.
- [ ] **Dig-site Raid add-wave enemies (count TBD)** — §1.5 names them but no roster size exists yet.
- [ ] **Status effect icons beyond the named ten (~5–10)** — settle the 15–20 range in `asset-list.md` §2.3.
- [ ] **World background art direction** — the one line in `asset-list.md` still owing direction rather than production.

---

