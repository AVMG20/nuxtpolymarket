import { describe, expect, it } from 'vitest'
import {
    ASCENDANT_ID,
    ASCENDANT_PICKABLE,
    CLASS_BY_ID,
    CLASS_IDS,
    CLASS_NODES,
    CONVERGENCE,
    ROOT_CLASS_ID,
    childrenOf,
    classPath,
    isDescendantOf,
    kitFor
} from '#shared/utils/hero-quest/content/classes'
import { baseSpreadFor } from '#shared/utils/hero-quest/stats'
import { ASCENDANT_KIT_SIZE, MIN_STAT_VALUE } from '#shared/utils/hero-quest/constants'
import {
    CHAMPIONS,
    CHAMPION_ABILITY_POOL,
    CHAMPION_BY_ID,
    RARITIES
} from '#shared/utils/hero-quest/content/champions'
import {
    GEAR,
    GEAR_SLOTS,
    autoEquipFirstPieces,
    upgradeAvailable
} from '#shared/utils/hero-quest/content/gear'
import { SKILLS, heroKit } from '#shared/utils/hero-quest/content/skills'
import { ARTIFACTS, ARTIFACT_CATEGORIES, ARTIFACT_EFFECT_POOL } from '#shared/utils/hero-quest/content/artifacts'
import { ZERO } from '#shared/utils/hero-quest/numbers'

/** The 16-node tree; the Ascendant stands past it, joined to all six masters (`capstone-class.md`). */
const TREE = CLASS_NODES.filter(node => node.tier !== 'capstone')

describe('hero-quest class content', () => {
    it('is a tree: one root, every parentId resolves, and every node walks up to the root', () => {
        const roots = TREE.filter(node => node.parentId === null)
        expect(roots.map(node => node.id)).toEqual([ROOT_CLASS_ID])
        for (const node of TREE) {
            if (node.parentId !== null) expect(CLASS_BY_ID[node.parentId], `${node.id} → ${node.parentId}`).toBeDefined()
            const path = classPath(node.id)
            expect(path[0]!.id).toBe(ROOT_CLASS_ID)
            expect(path.at(-1)!.id).toBe(node.id)
            expect(new Set(path.map(entry => entry.id)).size).toBe(path.length)
        }
    })

    it('has unique class and skill IDs', () => {
        expect(new Set(CLASS_IDS).size).toBe(CLASS_NODES.length)
        expect(new Set(CLASS_NODES.map(node => node.skill.id)).size).toBe(CLASS_NODES.length)
    })

    it('gives every node a skill that fires and does something', () => {
        for (const node of TREE) {
            expect(node.skill.cooldownSeconds, node.id).toBeGreaterThan(0)
            // A skill with neither damage nor an effect is a cooldown that does nothing.
            const effect = node.skill.effect
            const doesSomething = node.skill.abilityMultiplier > 0
                || Boolean(effect?.status || effect?.selfStatus || effect?.heal || effect?.shield)
            expect(doesSomething, node.id).toBe(true)
        }
    })

    it('builds a cumulative kit — a specialization never replaces what it inherited', () => {
        // `classes-and-combat.md` §4: re-picking Berserker restores Whirlwind and
        // Threatening Roar alongside Enrage, not Enrage on its own.
        expect(kitFor('class_berserker').map(entry => entry.id)).toEqual([
            'skill_haste',
            'skill_whirlwind',
            'skill_threatening_roar',
            'skill_enrage'
        ])
        for (const node of TREE) {
            const own = kitFor(node.id)
            expect(own.length, node.id).toBe(classPath(node.id).length)
            expect(own.at(-1)!.id, node.id).toBe(node.skill.id)
        }
    })

    it('tracks ancestry without counting a node as its own descendant', () => {
        expect(isDescendantOf('class_berserker', 'class_warrior')).toBe(true)
        expect(isDescendantOf('class_berserker', 'class_mage')).toBe(false)
        expect(isDescendantOf('class_warrior', 'class_warrior')).toBe(false)
    })

    it('keeps every derived stat at or above the floor', () => {
        for (const node of CLASS_NODES) {
            for (const [key, value] of Object.entries(baseSpreadFor(node))) {
                expect(value.gte(MIN_STAT_VALUE), `${node.id}.${key}`).toBe(true)
            }
        }
    })
})

describe('the Ascendant', () => {
    it('stands alone past the tree: parentless, and nobody\'s child', () => {
        expect(CLASS_NODES.filter(node => node.tier === 'capstone').map(node => node.id)).toEqual([ASCENDANT_ID])
        expect(CLASS_BY_ID[ASCENDANT_ID].parentId).toBeNull()
        for (const node of CLASS_NODES) expect(childrenOf(node.id).some(child => child.id === ASCENDANT_ID), node.id).toBe(false)
    })

    it('can pick from every class skill in the tree', () => {
        expect(ASCENDANT_PICKABLE.map(skill => skill.id)).toEqual(TREE.map(node => node.skill.id))
    })

    it('fires its picks, capped and deduplicated, then Convergence', () => {
        const picks = ['skill_haste', 'skill_kill_shot', 'skill_kill_shot', 'skill_meteor_shower', 'not_a_skill', 'skill_whirlwind', 'skill_enrage']
        const kit = kitFor(ASCENDANT_ID, picks)
        expect(kit.slice(0, ASCENDANT_KIT_SIZE).map(skill => skill.id)).toEqual(['skill_haste', 'skill_kill_shot', 'skill_meteor_shower', 'skill_whirlwind'])
        expect(kit.slice(ASCENDANT_KIT_SIZE)).toEqual(CONVERGENCE)
        // nothing picked: Convergence alone
        expect(kitFor(ASCENDANT_ID)).toEqual(CONVERGENCE)
    })
})

describe('champion roster', () => {
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

    it('draws every ability from its own archetype’s pool', () => {
        for (const entry of CHAMPIONS) {
            const pool = CHAMPION_ABILITY_POOL[entry.archetype]
            for (const skill of entry.abilities) {
                expect(pool, `${entry.id}/${skill.name}`).toContain(skill.name)
            }
        }
    })

    it('keeps every id unique', () => {
        expect(new Set(CHAMPIONS.map(c => c.id)).size).toBe(CHAMPIONS.length)
    })
})

describe('hero-quest gear content', () => {
    it('ships exactly one item per slot per rarity', () => {
        for (const slot of GEAR_SLOTS) {
            for (const rarity of RARITIES) {
                expect(GEAR.filter(entry => entry.slot === slot && entry.rarity === rarity), `${slot}/${rarity}`).toHaveLength(1)
            }
        }
        expect(new Set(GEAR.map(entry => entry.id)).size).toBe(GEAR.length)
    })

    it('auto-equips the first piece owned for a slot, and never overrides a later choice', () => {
        const common = { contentId: 'gear_weapon_common', star: 0, level: 1 }
        const mythic = { contentId: 'gear_weapon_mythic', star: 5, level: 10 }

        expect(autoEquipFirstPieces([common], {})).toEqual({ weapon: 'gear_weapon_common' })
        // A stronger piece arrives, but a choice already exists: untouched.
        expect(autoEquipFirstPieces([common, mythic], { weapon: 'gear_weapon_common' })).toBeNull()
    })

    it('raises the upgrade indicator exactly when an owned piece would out-perform the equipped one', () => {
        const weak = { contentId: 'gear_weapon_common', star: 0, level: 1 }
        const strong = { contentId: 'gear_weapon_mythic', star: 5, level: 10 }

        expect(upgradeAvailable('weapon', [weak, strong], 'gear_weapon_common')).toBe(true)
        expect(upgradeAvailable('weapon', [weak, strong], 'gear_weapon_mythic')).toBe(false)
        expect(upgradeAvailable('weapon', [weak], undefined)).toBe(true)
        expect(upgradeAvailable('boots', [weak, strong], undefined)).toBe(false)
    })
})

describe('hero-quest skill content', () => {
    it('gives every Passive one modifier per effect line, and every Active an effect with a payload', () => {
        for (const entry of SKILLS) {
            if (entry.type === 'passive') {
                expect(entry.modifiers, entry.id).toHaveLength(entry.lines.length)
                expect(entry.effect, entry.id).toBeUndefined()
                continue
            }
            expect(entry.cooldownSeconds, entry.id).toBeGreaterThan(0)
            // An Active with no damage and no effect would be a slot spent on nothing.
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

    it('keeps every skill universal — no effect names anything class-specific', () => {
        // Any Hero can equip any skill, so every stat line must land on a stat every class has.
        const universal = new Set<string>(['pwr', 'spd', 'lck', 'imp', 'vit', 'def'])
        for (const entry of SKILLS) {
            for (const line of entry.modifiers ?? []) {
                if (line.kind === 'stat') expect(universal.has(line.stat!), `${entry.id}/${line.stat}`).toBe(true)
            }
        }
    })

    it('keeps every id unique', () => {
        expect(new Set(SKILLS.map(entry => entry.id)).size).toBe(SKILLS.length)
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

describe('hero-quest artifact content', () => {
    it('draws every effect from its own category pool', () => {
        for (const entry of ARTIFACTS) {
            const pool = ARTIFACT_EFFECT_POOL[entry.category].map(effect => effect.id)
            for (const effect of entry.effects) {
                expect(pool, `${entry.id}/${effect.id}`).toContain(effect.id)
            }
        }
    })

    it('keeps every Artifact id and effect id unique', () => {
        expect(new Set(ARTIFACTS.map(entry => entry.id)).size).toBe(ARTIFACTS.length)
        const all = ARTIFACT_CATEGORIES.flatMap(category => ARTIFACT_EFFECT_POOL[category])
        expect(new Set(all.map(effect => effect.id)).size).toBe(all.length)
    })
})
