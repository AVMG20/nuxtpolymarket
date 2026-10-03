import { describe, expect, it } from 'vitest'
import { CLASS_BY_ID, CLASS_IDS, CLASS_NODES, ROOT_CLASS_ID, childrenOf, classPath, isDescendantOf, kitFor } from '#shared/utils/hero-quest/content/classes'
import { baseSpreadFor } from '#shared/utils/hero-quest/stats'
import {
    GOLD_BURST_COOLDOWN_SECONDS,
    MIN_STAT_VALUE,
    RARITY_ADJACENT_RATIO_CEILING,
    SKILL_BASE_COOLDOWN_SECONDS,
    SKILL_COOLDOWN_RANK_STEP
} from '#shared/utils/hero-quest/constants'
import {
    ARCHETYPES,
    CHAMPIONS,
    CHAMPION_ABILITY_POOL,
    CHAMPION_BY_ID,
    RARITIES,
    RARITY_ABILITY_COUNT,
    RARITY_STAT_MULTIPLIER,
    championDisplayName,
    championFromRoll,
    championRarityHasContent,
    getArchetype,
    getChampion
} from '#shared/utils/hero-quest/content/champions'
import {
    GEAR,
    GEAR_SLOTS,
    GEAR_SLOT_NAME,
    GEAR_SLOT_STAT,
    autoEquipFirstPieces,
    equippedBonus,
    passiveBonus,
    upgradeAvailable
} from '#shared/utils/hero-quest/content/gear'
import {
    SKILLS,
    heroKit,
    trainingGroundsArt
} from '#shared/utils/hero-quest/content/skills'
import {
    ARTIFACTS,
    ARTIFACT_CATEGORIES,
    ARTIFACT_EFFECT_POOL,
    artifactLineMagnitude
} from '#shared/utils/hero-quest/content/artifacts'
import { RARITY_EFFECT_LINES, RARITY_EPITHET } from '#shared/utils/hero-quest/gacha'
import { ZERO } from '#shared/utils/hero-quest/numbers'
import type { Rarity } from '#shared/utils/hero-quest/types'

describe('hero-quest class content', () => {
    it('has exactly 16 nodes', () => {
        expect(CLASS_NODES).toHaveLength(16)
    })

    it('has one root, 3 base, 6 elite and 6 master nodes', () => {
        const byTier = (tier: string) => CLASS_NODES.filter(node => node.tier === tier).length
        expect(byTier('beginner')).toBe(1)
        expect(byTier('base')).toBe(3)
        expect(byTier('elite')).toBe(6)
        expect(byTier('master')).toBe(6)
    })

    it('has exactly one parentless node, and it is the root', () => {
        const roots = CLASS_NODES.filter(node => node.parentId === null)
        expect(roots).toHaveLength(1)
        expect(roots[0]!.id).toBe(ROOT_CLASS_ID)
    })

    it('resolves every parentId', () => {
        for (const node of CLASS_NODES) {
            if (node.parentId !== null) {
                expect(CLASS_BY_ID[node.parentId], `${node.id} → ${node.parentId}`).toBeDefined()
            }
        }
    })

    it('has unique class and skill IDs', () => {
        expect(new Set(CLASS_IDS).size).toBe(CLASS_NODES.length)
        expect(new Set(CLASS_NODES.map(node => node.skill.id)).size).toBe(CLASS_NODES.length)
    })

    it('gives every node a skill that fires and does something', () => {
        for (const node of CLASS_NODES) {
            expect(node.skill.name.length, node.id).toBeGreaterThan(0)
            expect(node.skill.cooldownSeconds, node.id).toBeGreaterThan(0)

            // Damage is not the only way to matter: Haste, Enrage, Totem Storm, Raise
            // Dead, Disciple and Man's Best Friend are pure utility and deal none by design.
            // What every skill must have is *some* payload — a skill with neither damage nor
            // an effect is a cooldown that does nothing, which is the real bug this catches.
            const effect = node.skill.effect
            const doesSomething = node.skill.abilityMultiplier > 0
                || Boolean(effect?.status || effect?.selfStatus || effect?.heal || effect?.shield)
            expect(doesSomething, node.id).toBe(true)
        }
    })

    it('points every ability at a target pattern', () => {
        for (const node of CLASS_NODES) {
            expect(node.skill.effect?.target ?? 'enemy_single', node.id).toBeTruthy()
        }
    })

    it('keeps utility abilities damage-free and damage abilities armed', () => {
        // The two halves of the roster, asserted explicitly so a later edit that quietly gives
        // Haste a damage multiplier — or strips Whirlwind's — shows up here.
        const utility = ['skill_haste', 'skill_enrage', 'skill_totem_storm', 'skill_raise_dead',
            'skill_disciple', 'skill_mans_best_friend', 'skill_threatening_roar']
        for (const node of CLASS_NODES) {
            const isUtility = utility.includes(node.skill.id)
            expect(node.skill.abilityMultiplier === 0, node.skill.id).toBe(isUtility)
        }
    })

    it('builds a cumulative kit — a specialization never replaces what it inherited', () => {
        // `classes-and-combat.md` §4: re-picking Berserker restores Whirlwind and
        // Threatening Roar alongside Enrage, not Enrage on its own.
        const kit = kitFor('class_berserker')
        expect(kit.map(entry => entry.id)).toEqual([
            'skill_haste',
            'skill_whirlwind',
            'skill_threatening_roar',
            'skill_enrage'
        ])

        for (const node of CLASS_NODES) {
            const own = kitFor(node.id)
            expect(own.length, node.id).toBe(classPath(node.id).length)
            expect(own.at(-1)!.id, node.id).toBe(node.skill.id)
            expect(new Set(own.map(entry => entry.id)).size, node.id).toBe(own.length)
        }
    })

    it('is acyclic — every node walks up to the root', () => {
        for (const node of CLASS_NODES) {
            const path = classPath(node.id)
            expect(path[0]!.id).toBe(ROOT_CLASS_ID)
            expect(path.at(-1)!.id).toBe(node.id)
            expect(new Set(path.map(entry => entry.id)).size).toBe(path.length)
        }
    })

    it('branches three ways at the root and two ways at each base class', () => {
        expect(childrenOf(ROOT_CLASS_ID)).toHaveLength(3)
        for (const base of CLASS_NODES.filter(node => node.tier === 'base')) {
            expect(childrenOf(base.id), base.id).toHaveLength(2)
        }
    })

    it('tracks ancestry without counting a node as its own descendant', () => {
        expect(isDescendantOf('class_berserker', 'class_warrior')).toBe(true)
        expect(isDescendantOf('class_berserker', 'class_mage')).toBe(false)
        expect(isDescendantOf('class_warrior', 'class_warrior')).toBe(false)
    })

    it('gives every node at least one strike per attack', () => {
        for (const node of CLASS_NODES) {
            expect(node.strikesPerAttack, node.id).toBeGreaterThanOrEqual(1)
        }
        expect(CLASS_BY_ID.class_hunter.strikesPerAttack).toBe(3)
        expect(CLASS_BY_ID.class_beast_master.strikesPerAttack).toBe(4)
    })

    it('keeps every derived stat at or above the floor', () => {
        for (const node of CLASS_NODES) {
            const block = baseSpreadFor(node)
            for (const [key, value] of Object.entries(block)) {
                expect(value.gte(MIN_STAT_VALUE), `${node.id}.${key}`).toBe(true)
            }
        }
    })

    it('accumulates specialization deltas down the path', () => {
        // Berserker carries Warrior's spread plus Barbarian's and its own PWR shifts.
        const warrior = baseSpreadFor(CLASS_BY_ID.class_warrior)
        const barbarian = baseSpreadFor(CLASS_BY_ID.class_barbarian)
        const berserker = baseSpreadFor(CLASS_BY_ID.class_berserker)
        expect(barbarian.pwr.gt(warrior.pwr)).toBe(true)
        expect(berserker.pwr.gt(barbarian.pwr)).toBe(true)
        expect(barbarian.def.lt(warrior.def)).toBe(true)
        expect(berserker.def.eq(barbarian.def)).toBe(true)
    })

    it('makes the Sorcerer the most fragile node in the tree', () => {
        const sorcerer = baseSpreadFor(CLASS_BY_ID.class_sorcerer)
        for (const node of CLASS_NODES) {
            if (node.id === 'class_sorcerer') continue
            const block = baseSpreadFor(node)
            const bulk = (spread: typeof block) => spread.def.add(spread.vit)
            expect(bulk(sorcerer).lte(bulk(block)), node.id).toBe(true)
        }
    })

    it('gives the Archer path the crit lead its flavor text claims', () => {
        const archer = baseSpreadFor(CLASS_BY_ID.class_archer)
        expect(archer.lck.gt(baseSpreadFor(CLASS_BY_ID.class_warrior).lck)).toBe(true)
        expect(archer.lck.gt(baseSpreadFor(CLASS_BY_ID.class_mage).lck)).toBe(true)
    })
})

/**
 * Champion roster invariants (`champions-guild-gacha.md`).
 *
 * Structural rules only — the kind that break silently when someone adds a Champion and
 * forgets a field. Every one of these is a rule the doc states, not a preference.
 */
describe('champion roster', () => {
    it('carries two Champions per archetype per rarity — forty-eight in all', () => {
        // The complete roster (§1).
        for (const rarity of RARITIES) {
            for (const archetype of ARCHETYPES) {
                const matching = CHAMPIONS.filter(c => c.rarity === rarity && c.archetype === archetype)
                expect(matching, `${rarity}/${archetype}`).toHaveLength(2)
            }
        }
        expect(CHAMPIONS).toHaveLength(48)
    })

    it('populates every rarity, which is what makes the rarity fold unnecessary', () => {
        // The drop table assumes every rarity is populated; a gap would make a pull at that
        // rarity throw (see the drop-table note in `gacha.ts`).
        for (const rarity of RARITIES) {
            expect(championRarityHasContent(rarity), rarity).toBe(true)
        }
        for (const rarity of RARITIES) {
            expect(championFromRoll(rarity, 0).rarity, rarity).toBe(rarity)
        }
    })

    it('keeps the twelve Phase 2 Champions at their original id and rarity', () => {
        // Collection rows reference `contentId`, so changing either would orphan a save.
        const shipped: readonly (readonly [string, string])[] = [
            ['champ_rask', 'common'], ['champ_dorne', 'rare'], ['champ_kaira', 'mythic'],
            ['champ_borin', 'common'], ['champ_ulrid', 'rare'], ['champ_thoraxx', 'mythic'],
            ['champ_meret', 'common'], ['champ_calen', 'rare'], ['champ_seraphel', 'mythic'],
            ['champ_ilyx', 'common'], ['champ_varn', 'rare'], ['champ_zeraphine', 'mythic']
        ]
        for (const [id, rarity] of shipped) {
            expect(CHAMPION_BY_ID[id], id).toBeDefined()
            expect(CHAMPION_BY_ID[id]!.rarity, id).toBe(rarity)
        }
    })

    it('never gives two Champions of the same archetype and rarity the same kit', () => {
        // Variety *within* a rarity — the half of the goal the reuse cap alone does not cover.
        for (const rarity of RARITIES) {
            for (const archetype of ARCHETYPES) {
                const pair = CHAMPIONS.filter(c => c.rarity === rarity && c.archetype === archetype)
                const kits = pair.map(c => c.abilities.map(a => a.name).sort().join('|'))
                expect(new Set(kits).size, `${rarity}/${archetype}`).toBe(pair.length)
            }
        }
    })

    it('reuses every low-rarity ability at high rarity, so nothing feels missable', () => {
        // The other half: a Common's one ability must also appear on something Epic or above,
        // or pulling up the ladder would read as losing access to it.
        const high: Rarity[] = ['epic', 'legendary', 'mythic']
        for (const archetype of ARCHETYPES) {
            const inHighTiers = new Set(
                CHAMPIONS
                    .filter(c => c.archetype === archetype && high.includes(c.rarity))
                    .flatMap(c => c.abilities.map(a => a.name))
            )
            const inLowTiers = CHAMPIONS
                .filter(c => c.archetype === archetype && !high.includes(c.rarity))
                .flatMap(c => c.abilities.map(a => a.name))

            for (const name of inLowTiers) {
                expect(inHighTiers.has(name), `${archetype}/${name}`).toBe(true)
            }
        }
    })

    it('gives every Champion the ability count its rarity dictates', () => {
        for (const entry of CHAMPIONS) {
            expect(entry.abilities, entry.id).toHaveLength(RARITY_ABILITY_COUNT[entry.rarity])
        }
    })

    it('draws every ability from its own archetype’s pool', () => {
        for (const entry of CHAMPIONS) {
            const pool = CHAMPION_ABILITY_POOL[entry.archetype]
            for (const skill of entry.abilities) {
                expect(pool, `${entry.id}/${skill.name}`).toContain(skill.name)
            }
        }
    })

    it('never reuses an ability more than three times within an archetype', () => {
        // The rule that sized the starting pool at 7 per archetype (§6).
        for (const archetype of ARCHETYPES) {
            const counts = new Map<string, number>()
            for (const entry of CHAMPIONS.filter(c => c.archetype === archetype)) {
                for (const skill of entry.abilities) {
                    counts.set(skill.name, (counts.get(skill.name) ?? 0) + 1)
                }
            }
            for (const [name, count] of counts) {
                expect(count, `${archetype}/${name}`).toBeLessThanOrEqual(3)
            }
        }
    })

    it('never repeats an ability within a single Champion’s own kit', () => {
        for (const entry of CHAMPIONS) {
            const names = entry.abilities.map(skill => skill.name)
            expect(new Set(names).size, entry.id).toBe(names.length)
        }
    })

    it('keeps every id and given name unique', () => {
        expect(new Set(CHAMPIONS.map(c => c.id)).size).toBe(CHAMPIONS.length)
        expect(new Set(CHAMPIONS.map(c => c.givenName)).size).toBe(CHAMPIONS.length)
    })

    it('titles every Champion from its own archetype’s title pool', () => {
        for (const entry of CHAMPIONS) {
            expect(getArchetype(entry.archetype).titles, entry.id).toContain(entry.title)
        }
    })

    it('assembles display names on the §5 template', () => {
        const kaira = getChampion('champ_kaira')
        expect(championDisplayName(kaira)).toBe('Kaira, the Ascendant Reaver')
    })

    it('covers each of the Hero’s six stats exactly once across the four passives', () => {
        const covered = ARCHETYPES.flatMap(id => getArchetype(id).passiveStats)
        expect(covered.slice().sort()).toEqual(['def', 'imp', 'lck', 'pwr', 'spd', 'vit'])
    })

    it('rises monotonically in stat multiplier with rarity', () => {
        const multipliers = RARITIES.map(rarity => RARITY_STAT_MULTIPLIER[rarity])
        for (let index = 1; index < multipliers.length; index++) {
            expect(multipliers[index]!).toBeGreaterThan(multipliers[index - 1]!)
        }
    })
})

/**
 * Gear (`gear-equipment.md`).
 *
 * The simplest roster in the project — a complete 6×6 cross product with nothing authored — so
 * these mostly pin the *structural* claims the doc makes rather than catching transcription
 * slips: the exhaustive cross product, the slot→stat bijection, and the Rarity Progression
 * Guarantee, which is a standing constraint on a table this roster does not even own.
 */
describe('hero-quest gear content', () => {
    it('ships exactly one item per slot per rarity — 36 in total', () => {
        expect(GEAR).toHaveLength(GEAR_SLOTS.length * RARITIES.length)
        for (const slot of GEAR_SLOTS) {
            for (const rarity of RARITIES) {
                const matching = GEAR.filter(entry => entry.slot === slot && entry.rarity === rarity)
                expect(matching, `${slot}/${rarity}`).toHaveLength(1)
            }
        }
    })

    it('maps the six slots onto the six stats one-to-one and onto', () => {
        // §1's table. A collision would silently give one stat two slots and another none.
        const stats = GEAR_SLOTS.map(slot => GEAR_SLOT_STAT[slot])
        expect(stats.slice().sort()).toEqual(['def', 'imp', 'lck', 'pwr', 'spd', 'vit'])
    })

    it('names every piece from the rarity epithet ladder alone', () => {
        // §1: "every item's name is simply <Rarity Epithet> <Slot Name>" — which is why this
        // roster needed no authoring pass at all.
        for (const entry of GEAR) {
            expect(entry.name, entry.id).toBe(`${RARITY_EPITHET[entry.rarity]} ${GEAR_SLOT_NAME[entry.slot]}`)
        }
        expect(GEAR.find(entry => entry.id === 'gear_weapon_mythic')!.name).toBe('Ascendant Weapon')
    })

    it('keeps every adjacent rarity multiplier under the 6x progression ceiling', () => {
        /**
         * §2's Rarity Progression Guarantee, as a standing constraint rather than a one-time
         * check. Both promises the doc makes — a scalar-50 current-tier piece beats a scalar-1
         * next-tier one, and a maxed scalar-60 piece beats a scalar-10 next-tier one — reduce to
         * this, of which the second is binding. Break it and investment stops being safe.
         */
        for (let index = 1; index < RARITIES.length; index++) {
            const ratio = RARITY_STAT_MULTIPLIER[RARITIES[index]!] / RARITY_STAT_MULTIPLIER[RARITIES[index - 1]!]
            expect(ratio, `${RARITIES[index - 1]} to ${RARITIES[index]}`)
                .toBeLessThan(RARITY_ADJACENT_RATIO_CEILING)
        }
    })

    it('honours both catch-up guarantees at the current multipliers', () => {
        // The guarantees stated directly, not through their algebraic reduction — so a future
        // change to the *formula* is caught too, not only a change to the table.
        for (let index = 1; index < RARITIES.length; index++) {
            const current = RARITIES[index - 1]!
            const next = RARITIES[index]!
            // A current-tier piece at scalar 50 (4★ Lv10) beats a freshly-pulled next-tier one.
            expect(equippedBonus('weapon', current, 4, 10), `${current} vs ${next} fresh`)
                .toBeGreaterThan(equippedBonus('weapon', next, 0, 1))
            // A maxed current-tier piece beats a next-tier one at scalar 10.
            expect(equippedBonus('weapon', current, 5, 10), `${current} maxed vs ${next} 0-star Lv10`)
                .toBeGreaterThan(equippedBonus('weapon', next, 0, 10))
        }
    })

    it('pays an unequipped piece strictly less than the same piece equipped', () => {
        // §3's whole point: collecting has value, equipping well has more. If these ever crossed,
        // the upgrade indicator would be advising players to make themselves weaker.
        for (const entry of GEAR) {
            expect(passiveBonus(entry.rarity, 5, 10), entry.id)
                .toBeLessThan(equippedBonus(entry.slot, entry.rarity, 5, 10))
        }
    })

    it('auto-equips the first piece owned for a slot, and never overrides a later choice', () => {
        const common = { contentId: 'gear_weapon_common', star: 0, level: 1 }
        const mythic = { contentId: 'gear_weapon_mythic', star: 5, level: 10 }

        // Nothing equipped, one piece owned: it equips (§3).
        expect(autoEquipFirstPieces([common], {})).toEqual({ weapon: 'gear_weapon_common' })

        // A stronger piece arrives, but a choice already exists: untouched. The indicator
        // prompts; it never swaps. That is what makes manual equip meaningful.
        expect(autoEquipFirstPieces([common, mythic], { weapon: 'gear_weapon_common' })).toBeNull()
    })

    it('raises the upgrade indicator exactly when an owned piece would out-perform the equipped one', () => {
        const weak = { contentId: 'gear_weapon_common', star: 0, level: 1 }
        const strong = { contentId: 'gear_weapon_mythic', star: 5, level: 10 }

        expect(upgradeAvailable('weapon', [weak, strong], 'gear_weapon_common')).toBe(true)
        expect(upgradeAvailable('weapon', [weak, strong], 'gear_weapon_mythic')).toBe(false)
        // Owning something with nothing equipped is itself worth prompting.
        expect(upgradeAvailable('weapon', [weak], undefined)).toBe(true)
        // Nothing owned for the slot — nothing to suggest.
        expect(upgradeAvailable('boots', [weak, strong], undefined)).toBe(false)
    })
})

/**
 * Skills (`skills-gacha.md`).
 *
 * Unlike the Champion roster this one is fully authored in §4, so these are genuinely
 * transcription checks: the 18/18 split, the per-rarity effect-line counts, and §3's universality
 * rule — the one that says no skill may reference anything class-specific, since any Hero can
 * equip any skill.
 */
describe('hero-quest skill content', () => {
    it('ships 36 skills, 6 per rarity, split exactly 3 Active / 3 Passive', () => {
        expect(SKILLS).toHaveLength(36)
        for (const rarity of RARITIES) {
            const atRarity = SKILLS.filter(entry => entry.rarity === rarity)
            expect(atRarity, rarity).toHaveLength(6)
            expect(atRarity.filter(entry => entry.type === 'active'), `${rarity} actives`).toHaveLength(3)
            expect(atRarity.filter(entry => entry.type === 'passive'), `${rarity} passives`).toHaveLength(3)
        }
        expect(SKILLS.filter(entry => entry.type === 'active')).toHaveLength(18)
        expect(SKILLS.filter(entry => entry.type === 'passive')).toHaveLength(18)
    })

    it('gives every skill the effect-line count its rarity dictates', () => {
        // §3's table, the same 1/1/1/2/2/3 shape Champions state as an ability count.
        for (const entry of SKILLS) {
            expect(entry.lines, entry.id).toHaveLength(RARITY_EFFECT_LINES[entry.rarity])
        }
    })

    it('gives every Passive one modifier per effect line, and every Active an effect', () => {
        for (const entry of SKILLS) {
            if (entry.type === 'passive') {
                expect(entry.modifiers, entry.id).toHaveLength(entry.lines.length)
                expect(entry.effect, entry.id).toBeUndefined()
            } else {
                expect(entry.effect, entry.id).toBeDefined()
                expect(entry.cooldownSeconds, entry.id).toBeGreaterThan(0)
            }
        }
    })

    it('keeps every skill universal — no effect names anything class-specific', () => {
        /**
         * §3's core rule. Every line must land on a stat every class has, or on an external
         * resource (Gold, XP, offline efficiency) that has nothing to do with class at all.
         */
        const universal = new Set<string>(['pwr', 'spd', 'lck', 'imp', 'vit', 'def'])
        for (const entry of SKILLS) {
            for (const line of entry.modifiers ?? []) {
                if (line.kind === 'stat') {
                    expect(line.stat, entry.id).toBeDefined()
                    expect(universal.has(line.stat!), `${entry.id}/${line.stat}`).toBe(true)
                }
            }
        }
    })

    it('gives every Active a payload — damage, a heal, a burst, or something applied', () => {
        // An Active with no damage and no effect would be a slot spent on nothing.
        for (const entry of SKILLS.filter(candidate => candidate.type === 'active')) {
            const effect = entry.effect!
            const hasPayload = (entry.abilityMultiplier ?? 0) > 0
                || effect.heal !== undefined
                || effect.shield !== undefined
                || effect.status !== undefined
                || effect.selfStatus !== undefined
                || effect.cleanse === true
                || effect.goldBurstMinutes !== undefined
                || effect.xpBurstMinutes !== undefined
            expect(hasPayload, entry.id).toBe(true)
        }
    })

    it('keeps every id and name unique', () => {
        expect(new Set(SKILLS.map(entry => entry.id)).size).toBe(SKILLS.length)
        expect(new Set(SKILLS.map(entry => entry.name)).size).toBe(SKILLS.length)
    })

    it('scales passive magnitude monotonically with rarity', () => {
        // §4 describes the ladder qualitatively — "small" through "large" — and this is that
        // ordering as an assertion, since the words map to `SKILL_PASSIVE_MAGNITUDE` by index.
        const magnitudeOf = (rarity: Rarity) => SKILLS
            .find(entry => entry.rarity === rarity && entry.type === 'passive' && entry.modifiers?.[0]?.kind === 'stat')!
            .modifiers![0]!.magnitude
        for (let index = 1; index < RARITIES.length; index++) {
            expect(magnitudeOf(RARITIES[index]!), RARITIES[index])
                .toBeGreaterThan(magnitudeOf(RARITIES[index - 1]!))
        }
    })

    it('holds economy lines below stat lines of the same rarity', () => {
        // "Keep Gold-granting bonuses small" (`gold-economy.md` §5) given teeth: Gold is the
        // platform's persistent currency and compounds forever, where a stat bonus is re-earned
        // each run. `SKILL_ECONOMY_COEFFICIENT` is the throttle.
        for (const rarity of RARITIES) {
            const stat = SKILLS.find(entry => entry.rarity === rarity && entry.modifiers?.[0]?.kind === 'stat')
            const economy = SKILLS.find(entry => entry.rarity === rarity && entry.modifiers?.[0]?.kind === 'gold')
            if (!stat || !economy) continue
            expect(economy.modifiers![0]!.magnitude, rarity)
                .toBeLessThan(stat.modifiers![0]!.magnitude)
        }
    })

    it('ties the Training Grounds art to the Hero class path, defaulting to Barracks', () => {
        // §1's table. Resolved from the class path rather than an ID list, so a node added under
        // Mage would inherit the Wizard Tower instead of falling through to the default.
        expect(trainingGroundsArt('class_beginner')).toBe('barracks')
        expect(trainingGroundsArt('class_paladin')).toBe('barracks')
        expect(trainingGroundsArt('class_beast_master')).toBe('archery_range')
        expect(trainingGroundsArt('class_witch_doctor')).toBe('wizard_tower')
    })

    it('builds the Hero kit from the class tree plus every equipped Active, and nothing else', () => {
        const bare = {
            classId: 'class_beginner' as const, heroLevel: 1, heroXp: ZERO,
            goldBonusPct: 0, offlineEfficiencyLevel: 0, offlineCapLevel: 0
        }
        const classOnly = heroKit(bare)
        const withSkills = heroKit({
            ...bare,
            equippedSkills: [
                { contentId: 'skill_quick_strike', star: 0, level: 1 },
                // A Passive occupies a slot but brings no firing entry — it is a stat modifier.
                { contentId: 'skill_marching_drill', star: 0, level: 1 }
            ]
        })
        expect(withSkills).toHaveLength(classOnly.length + 1)
        expect(withSkills.some(entry => entry.id === 'skill_quick_strike')).toBe(true)
        expect(withSkills.some(entry => entry.id === 'skill_marching_drill')).toBe(false)
    })
})

/**
 * Artifacts (`artifacts-dig-site-gacha.md`).
 *
 * The 48-entry roster and the 33-effect pool. Names here are **placeholders** by design, so
 * nothing below asserts a name — what is pinned is the structure: the cross product, the pool
 * sizes §3 states outright, the reuse ceiling, and the effect-line counts.
 */
describe('hero-quest artifact content', () => {
    it('ships 48 Artifacts — 2 per category per rarity', () => {
        expect(ARTIFACTS).toHaveLength(48)
        for (const category of ARTIFACT_CATEGORIES) {
            for (const rarity of RARITIES) {
                const matching = ARTIFACTS.filter(entry => entry.category === category && entry.rarity === rarity)
                expect(matching, `${category}/${rarity}`).toHaveLength(2)
            }
        }
    })

    it('holds the 33-effect pool at the sizes §3 states — 9 / 8 / 9 / 7', () => {
        const sizes = { offense: 9, defense: 8, tempo: 9, fortune: 7 } as const
        let total = 0
        for (const category of ARTIFACT_CATEGORIES) {
            expect(ARTIFACT_EFFECT_POOL[category], category).toHaveLength(sizes[category])
            total += ARTIFACT_EFFECT_POOL[category].length
        }
        expect(total).toBe(33)
    })

    it('gives every Artifact the effect-line count its rarity dictates', () => {
        for (const entry of ARTIFACTS) {
            expect(entry.effects, entry.id).toHaveLength(RARITY_EFFECT_LINES[entry.rarity])
        }
    })

    it('never reuses an effect on more than three Artifacts in its category', () => {
        // §3's ceiling — corrected there from an earlier "exactly 3 each", which is
        // arithmetically impossible against pools of 8 and 9 with a 20-fill budget.
        for (const category of ARTIFACT_CATEGORIES) {
            const counts = new Map<string, number>()
            for (const entry of ARTIFACTS.filter(candidate => candidate.category === category)) {
                for (const effect of entry.effects) {
                    counts.set(effect.id, (counts.get(effect.id) ?? 0) + 1)
                }
            }
            for (const [id, count] of counts) {
                expect(count, `${category}/${id}`).toBeLessThanOrEqual(3)
            }
        }
    })

    it('draws every effect from its own category pool', () => {
        for (const entry of ARTIFACTS) {
            const pool = ARTIFACT_EFFECT_POOL[entry.category].map(effect => effect.id)
            for (const effect of entry.effects) {
                expect(pool, `${entry.id}/${effect.id}`).toContain(effect.id)
            }
        }
    })

    it('never repeats an effect within a single Artifact', () => {
        for (const entry of ARTIFACTS) {
            const ids = entry.effects.map(effect => effect.id)
            expect(new Set(ids).size, entry.id).toBe(ids.length)
        }
    })

    it('never gives two Artifacts of the same category and rarity the same effect set', () => {
        for (const category of ARTIFACT_CATEGORIES) {
            for (const rarity of RARITIES) {
                const pair = ARTIFACTS.filter(entry => entry.category === category && entry.rarity === rarity)
                const sets = pair.map(entry => entry.effects.map(effect => effect.id).sort().join('|'))
                expect(new Set(sets).size, `${category}/${rarity}`).toBe(pair.length)
            }
        }
    })

    it('debuts each category newest effect at Epic or above', () => {
        // §3's flavour device: Shattering Blow, Unbroken, Chain Reaction and Windfall never
        // appear at a solo rarity. Optional per the doc, kept deliberately.
        const debutants = ['Shattering Blow', 'Unbroken', 'Chain Reaction', 'Windfall']
        const solo: Rarity[] = ['common', 'uncommon', 'rare']
        for (const entry of ARTIFACTS.filter(candidate => solo.includes(candidate.rarity))) {
            for (const effect of entry.effects) {
                expect(debutants, `${entry.id}/${effect.name}`).not.toContain(effect.name)
            }
        }
    })

    it('keeps every effect id and name unique across the whole pool', () => {
        const all = ARTIFACT_CATEGORIES.flatMap(category => ARTIFACT_EFFECT_POOL[category])
        expect(new Set(all.map(effect => effect.id)).size).toBe(all.length)
        expect(new Set(all.map(effect => effect.name)).size).toBe(all.length)
    })

    it('keeps every Artifact id unique', () => {
        expect(new Set(ARTIFACTS.map(entry => entry.id)).size).toBe(ARTIFACTS.length)
    })

    describe('Artifact names', () => {
        it('gives every Artifact its own name — §4 owns one instance per named Artifact', () => {
            expect(new Set(ARTIFACTS.map(entry => entry.name)).size).toBe(ARTIFACTS.length)
        })

        it('never names an Artifact after a pool effect, which would read as the effect itself', () => {
            const effectNames = new Set(
                ARTIFACT_CATEGORIES.flatMap(category => ARTIFACT_EFFECT_POOL[category]).map(effect => effect.name)
            )
            for (const entry of ARTIFACTS) {
                expect(effectNames.has(entry.name), entry.id).toBe(false)
            }
        })

        it('never reuses a Champion given name or title', () => {
            const championWords = new Set(
                CHAMPIONS.flatMap(champion => [champion.givenName, champion.title]).map(word => word.toLowerCase())
            )
            for (const entry of ARTIFACTS) {
                // Split on the possessive too, so "Warden's Seal" would still count as "Warden".
                const clashes = entry.name.split(/[\s,-]+|'s\b/).filter(word => championWords.has(word.toLowerCase()))
                expect(clashes, `${entry.id}: ${entry.name}`).toEqual([])
            }
        })
    })

    it('scales an effect line with rarity and with the copy own investment', () => {
        // §6: magnitudes ride the same `(star × 10 + level)` scalar as Gear and the Champion
        // passive. Both axes, since only one of them is stated in the shared doc.
        expect(artifactLineMagnitude('stat', 'mythic', 0, 1))
            .toBeGreaterThan(artifactLineMagnitude('stat', 'common', 0, 1))
        expect(artifactLineMagnitude('stat', 'common', 5, 10))
            .toBeGreaterThan(artifactLineMagnitude('stat', 'common', 0, 1))
    })

    it('throttles economy lines below combat lines of the same rarity and investment', () => {
        // The same "keep Gold-granting bonuses small" principle Skills applies, and §3 says it
        // applies project-wide rather than to Artifacts alone.
        for (const rarity of RARITIES) {
            expect(artifactLineMagnitude('gold', rarity, 3, 5), rarity)
                .toBeLessThan(artifactLineMagnitude('stat', rarity, 3, 5))
        }
    })
})

describe('the cooldown ladder', () => {
    const TIER_RANK = { beginner: 0, base: 1, elite: 2, master: 3 } as const
    const laddered = (rank: number) => SKILL_BASE_COOLDOWN_SECONDS * SKILL_COOLDOWN_RANK_STEP ** rank

    it('puts every class skill at its tier\'s rank, deeper classes waiting longer', () => {
        for (const node of CLASS_NODES) {
            expect(node.skill.cooldownSeconds, node.id).toBeCloseTo(laddered(TIER_RANK[node.tier]), 10)
        }
    })

    it('puts every Champion ability at its Champion\'s rarity rank', () => {
        for (const champion of CHAMPIONS) {
            for (const ability of champion.abilities) {
                expect(ability.cooldownSeconds, `${champion.id} ${ability.name}`)
                    .toBeCloseTo(laddered(RARITIES.indexOf(champion.rarity)), 10)
            }
        }
    })

    it('scales the hit with the wait, so the same ability keeps its damage per second', () => {
        const byName = new Map<string, { cooldownSeconds: number; abilityMultiplier: number }[]>()
        for (const ability of CHAMPIONS.flatMap(champion => champion.abilities)) {
            byName.set(ability.name, [...(byName.get(ability.name) ?? []), ability])
        }
        for (const [name, copies] of byName) {
            const rates = copies.map(copy => copy.abilityMultiplier / copy.cooldownSeconds)
            for (const rate of rates) expect(rate, name).toBeCloseTo(rates[0]!, 10)
        }
    })

    it('ranks damage-dealing Skill Actives by rarity, leaving the Gold-burst cadence alone', () => {
        const quick = SKILLS.find(entry => entry.name === 'Quick Strike')!
        const focused = SKILLS.find(entry => entry.name === 'Focused Blow')!
        expect(quick.cooldownSeconds).toBeCloseTo(laddered(0), 10)
        expect(focused.cooldownSeconds).toBeCloseTo(laddered(1), 10)
        expect(focused.abilityMultiplier! / focused.cooldownSeconds!)
            .toBeCloseTo(quick.abilityMultiplier! / quick.cooldownSeconds!, 10)
        expect(SKILLS.find(entry => entry.name === "Prospector's Instinct")!.cooldownSeconds)
            .toBe(GOLD_BURST_COOLDOWN_SECONDS)
    })
})
