/**
 * The Passive Skill Tree (`passive-skill-tree.md`): the roster's shape, the points and prices, who
 * each node reaches, and the two value-moving routes under a burst.
 *
 * The DB half needs the local Postgres from .env, and skips without it.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { makeHero, makeParty } from '../../scripts/hero-quest/sim'
import {
    PASSIVE_BAND_MAGNITUDE,
    PASSIVE_ENDLESS_BASE_COST,
    PASSIVE_ENDLESS_COST_STEP,
    PASSIVE_NODE_MAX_LEVEL,
    PASSIVE_POINTS_PER_LEVEL,
    PASSIVE_RESPEC_GEMS,
    PASSIVE_TIER_COST
} from '#shared/utils/hero-quest/constants'
import { PASSIVE_NODES, PASSIVE_ROOT_ID, getPassiveNode, passiveChildrenOf } from '#shared/utils/hero-quest/content/passive-tree'
import {
    passiveBuyBlock,
    passiveLevelCost,
    passiveNodeSpent,
    passivePathsOf,
    passivePointsEarned,
    passivePointsLeft,
    passivePointsSpent,
    passiveTreeModifiers,
    passiveTreeOf
} from '#shared/utils/hero-quest/passive-tree'
import { economyBonuses, heroModifierTotals, partyUnitStats } from '#shared/utils/hero-quest/stats'
import { db } from '#server/database'
import { hqState, user } from '#server/database/schema'
import { ensureHqState, prestigeResetValues } from '#server/utils/hero-quest'
import { buyPassiveLevel, respecPassiveTree, serializePassiveTree } from '#server/utils/hero-quest-passive-tree'
import { SKIP, burst, cleanupUser, seedUser } from '../setup/db-helpers'

describe('the roster', () => {
    it('has one root, and every other node hangs off a node that exists', () => {
        const ids = new Set(PASSIVE_NODES.map(n => n.id))
        expect(ids.size).toBe(PASSIVE_NODES.length)
        expect(PASSIVE_NODES.filter(n => n.parent === null).map(n => n.id)).toEqual([PASSIVE_ROOT_ID])
        for (const node of PASSIVE_NODES) if (node.parent) expect(ids.has(node.parent)).toBe(true)
    })

    it('splits the root into the three class paths, beside its own leaves', () => {
        const children = passiveChildrenOf(PASSIVE_ROOT_ID)
        expect(children.filter(n => n.path !== 'root').map(n => n.path).sort()).toEqual(['archer', 'mage', 'warrior'])
        for (const own of children.filter(n => n.path === 'root')) expect(passiveChildrenOf(own.id)).toEqual([])
        for (const node of PASSIVE_NODES) {
            if (node.parent && node.parent !== PASSIVE_ROOT_ID) expect(getPassiveNode(node.parent).path).toBe(node.path)
        }
    })

    it('gives each path the same shape: two class-path nodes, two side nodes, one endless tip', () => {
        for (const path of ['warrior', 'mage', 'archer'] as const) {
            const nodes = PASSIVE_NODES.filter(n => n.path === path)
            expect(nodes.filter(n => n.pathLocked)).toHaveLength(2)
            expect(nodes.filter(n => n.side)).toHaveLength(2)
            expect(nodes.filter(n => n.endless)).toHaveLength(1)
        }
    })

    it('never lets a side node gate anything (`idea-backlog.md` item 3)', () => {
        for (const node of PASSIVE_NODES.filter(n => n.side)) expect(passiveChildrenOf(node.id)).toEqual([])
    })

    it('runs every tier outward, one ring a step', () => {
        for (const node of PASSIVE_NODES) {
            if (!node.parent || node.endless || node.parent === PASSIVE_ROOT_ID) continue
            expect(node.tier).toBe(getPassiveNode(node.parent).tier! + 1)
        }
        for (const node of PASSIVE_NODES.filter(n => !n.endless)) expect(PASSIVE_TIER_COST[node.tier! - 1]).toBeDefined()
    })

    it('keeps class-path nodes on the Hero', () => {
        for (const node of PASSIVE_NODES.filter(n => n.pathLocked)) expect(node.scope.kind).toBe('hero')
    })
})

describe('points and prices', () => {
    it('earns a point per level past the first', () => {
        expect(passivePointsEarned(1)).toBe(0)
        expect(passivePointsEarned(401)).toBe(400 * PASSIVE_POINTS_PER_LEVEL)
    })

    it('prices a regular level by its tier, and an endless one on its own ladder', () => {
        const root = getPassiveNode(PASSIVE_ROOT_ID)
        expect(passiveLevelCost(root, 3)).toBe(PASSIVE_TIER_COST[0]! * 3)
        expect(passiveNodeSpent(root, PASSIVE_NODE_MAX_LEVEL)).toBe(PASSIVE_TIER_COST[0]! * 15)
        const endless = getPassiveNode('tree_war_colossus')
        expect(passiveLevelCost(endless, 1)).toBe(PASSIVE_ENDLESS_BASE_COST)
        expect(passiveLevelCost(endless, 4)).toBe(PASSIVE_ENDLESS_BASE_COST + 3 * PASSIVE_ENDLESS_COST_STEP)
    })

    it('opens a node once its parent holds a level, and stops at the cap', () => {
        const node = getPassiveNode('tree_war_thick_blood')
        expect(passiveBuyBlock(node, 100, {})).toBe('locked')
        expect(passiveBuyBlock(node, 100, { tree_war_iron_skin: 1 })).toBeNull()
        expect(passiveBuyBlock(node, 100, { tree_war_iron_skin: 1, [node.id]: PASSIVE_NODE_MAX_LEVEL })).toBe('maxed')
        // Iron Skin's first level is all a level-2 Hero has
        expect(passiveBuyBlock(node, 2, { tree_war_iron_skin: 1 })).toBe('points')
    })

    it('opens a path only from the ring nodes either side of it, never from the root', () => {
        const first = getPassiveNode('tree_war_iron_skin')
        expect(first.links).toEqual(['tree_root_fortitude', 'tree_root_precision'])
        expect(passiveBuyBlock(first, 100, { [PASSIVE_ROOT_ID]: 5 })).toBe('locked')
        expect(passiveBuyBlock(first, 100, { [PASSIVE_ROOT_ID]: 1, tree_root_precision: 1 })).toBeNull()
        // the ring nodes themselves open from the root
        expect(passiveBuyBlock(getPassiveNode('tree_root_precision'), 100, { [PASSIVE_ROOT_ID]: 1 })).toBeNull()
        for (const node of PASSIVE_NODES) for (const id of node.links) expect(getPassiveNode(id)).toBeDefined()
    })

    it('never caps an endless node', () => {
        const levels = { tree_war_colossus: 500, tree_war_battle_trance: 1 }
        expect(passiveBuyBlock(getPassiveNode('tree_war_colossus'), 1_000_000, levels)).toBeNull()
    })

    it('reads the stored map defensively', () => {
        expect(passiveTreeOf({ [PASSIVE_ROOT_ID]: 9, tree_gone: 3, tree_war_iron_skin: -1, tree_mage_focus: 1.5, tree_war_colossus: 40 }))
            .toEqual({ [PASSIVE_ROOT_ID]: PASSIVE_NODE_MAX_LEVEL, tree_war_colossus: 40 })
        expect(passiveTreeOf(null)).toEqual({})
    })

    it('leaves what the held levels did not spend', () => {
        const levels = { [PASSIVE_ROOT_ID]: 2, tree_war_iron_skin: 1 }
        expect(passivePointsSpent(levels)).toBe(1 + 2 + 1)
        expect(passivePointsLeft(11, levels)).toBe(10 * PASSIVE_POINTS_PER_LEVEL - 4)
    })
})

describe('who a node reaches', () => {
    it('puts the Beginner on no path, a class on its line, and the Ascendant on all three', () => {
        expect([...passivePathsOf('class_beginner')]).toEqual([])
        expect([...passivePathsOf('class_warrior')]).toEqual(['warrior'])
        expect([...passivePathsOf('class_berserker')]).toEqual(['warrior'])
        expect([...passivePathsOf('class_sorcerer')]).toEqual(['mage'])
        expect([...passivePathsOf('class_beast_master')]).toEqual(['archer'])
        expect([...passivePathsOf('class_ascendant')].sort()).toEqual(['archer', 'mage', 'warrior'])
    })

    it('switches a class-path node off away from its path', () => {
        const levels = { tree_war_weapon_mastery: 3 }
        const skillOf = (classId: Parameters<typeof passiveTreeModifiers>[1]) =>
            passiveTreeModifiers(levels, classId).hero.filter(l => l.kind === 'skillDamage').reduce((a, l) => a + l.magnitude, 0)
        expect(skillOf('class_knight')).toBeCloseTo(PASSIVE_BAND_MAGNITUDE.skill * 3, 10)
        expect(skillOf('class_wizard')).toBe(0)
    })

    it('raises the Hero\'s stats through the same pipeline as every other source', () => {
        const hero = makeHero('class_warrior', 10, { passiveTree: { [PASSIVE_ROOT_ID]: 4 } })
        expect(heroModifierTotals(hero).stats.pwr).toBeCloseTo(1 + PASSIVE_BAND_MAGNITUDE.stat * 4, 10)
        const bare = partyUnitStats(makeHero('class_warrior', 10))[0]!
        expect(partyUnitStats(hero)[0]!.pwr.div(bare.pwr).toNumber()).toBeCloseTo(1 + PASSIVE_BAND_MAGNITUDE.stat * 4, 6)
    })

    it('adds its economy lines to the economy', () => {
        const hero = makeHero('class_warrior', 10, { passiveTree: { tree_war_plunder: 5 } })
        expect(economyBonuses(hero).goldPct).toBeCloseTo(PASSIVE_BAND_MAGNITUDE.economy * 5, 10)
    })

    it('reaches only the archetype a side node names', () => {
        const levels = { tree_war_shieldbearers: 5 }
        const bare = partyUnitStats(makeParty('class_warrior', 10, 5))
        const built = partyUnitStats(makeParty('class_warrior', 10, 5, { passiveTree: levels }))
        const party = makeParty('class_warrior', 10, 5).champions!
        party.forEach((champion, i) => {
            const ratio = built[i + 1]!.def.div(bare[i + 1]!.def).toNumber()
            expect(ratio).toBeCloseTo(champion.archetype === 'tank' ? 1 + PASSIVE_BAND_MAGNITUDE.stat * 5 : 1, 6)
        })
        // and never the Hero
        expect(built[0]!.def.eq(bare[0]!.def)).toBe(true)
    })

    it('reaches every Champion from an every-Champion node', () => {
        const bare = partyUnitStats(makeParty('class_archer', 10, 5))
        const built = partyUnitStats(makeParty('class_archer', 10, 5, { passiveTree: { tree_arc_volley_drill: 2 } }))
        for (let i = 1; i < bare.length; i++) expect(built[i]!.spd.div(bare[i]!.spd).toNumber()).toBeCloseTo(1 + PASSIVE_BAND_MAGNITUDE.stat * 2, 6)
    })
})

const USER_ID = 'test-hero-quest-passive-tree-user'

async function cleanup() {
    await db.delete(hqState).where(eq(hqState.userId, USER_ID))
    await cleanupUser(USER_ID)
}

describe.skipIf(SKIP)('the tree routes', () => {
    beforeEach(async () => {
        await cleanup()
        await seedUser(USER_ID, { balance: '0' })
        await ensureHqState(USER_ID)
    })
    afterEach(cleanup)
    afterAll(async () => { await db.$client.end() })

    const stateOf = async () => (await db.select().from(hqState).where(eq(hqState.userId, USER_ID)))[0]!
    const gemsOf = async () => (await db.select({ gems: user.gems }).from(user).where(eq(user.id, USER_ID)))[0]!.gems
    const setLevel = (heroLevel: number) => db.update(hqState).set({ heroLevel }).where(eq(hqState.userId, USER_ID))

    it('pays for each of a burst of buys once, and never spends past the points', async () => {
        // the root's first three levels cost 1 + 2 + 3: exactly the six points a level-7 Hero has
        await setLevel(1 + 6 / PASSIVE_POINTS_PER_LEVEL)

        const result = await burst(10, () => db.transaction(tx => buyPassiveLevel(tx, USER_ID, PASSIVE_ROOT_ID)))

        expect(result.ok).toBe(3)
        const state = await stateOf()
        expect(state.passiveTree).toEqual({ [PASSIVE_ROOT_ID]: 3 })
        expect(serializePassiveTree(state).pointsLeft).toBe(0)
    })

    it('refuses a node whose parent holds nothing', async () => {
        await setLevel(100)
        await expect(db.transaction(tx => buyPassiveLevel(tx, USER_ID, 'tree_war_thick_blood'))).rejects.toThrow()
        expect((await stateOf()).passiveTree).toEqual({})
    })

    it('spends a prestige\'s free respec once, however many race for it', async () => {
        await setLevel(100)
        await db.update(hqState).set({ passiveTree: { [PASSIVE_ROOT_ID]: 2 }, passiveRespecFree: true }).where(eq(hqState.userId, USER_ID))

        const result = await burst(10, () => db.transaction(tx => respecPassiveTree(tx, USER_ID)))

        // the first clears the tree; the rest find nothing to refund, and none of them touches Gems
        expect(result.ok).toBe(1)
        const state = await stateOf()
        expect(state.passiveTree).toEqual({})
        expect(state.passiveRespecFree).toBe(false)
        expect(await gemsOf()).toBe(0)
    })

    it('charges a paid respec once', async () => {
        await setLevel(100)
        await db.update(user).set({ gems: PASSIVE_RESPEC_GEMS * 3 }).where(eq(user.id, USER_ID))
        await db.update(hqState).set({ passiveTree: { [PASSIVE_ROOT_ID]: 2 } }).where(eq(hqState.userId, USER_ID))

        const result = await burst(10, () => db.transaction(tx => respecPassiveTree(tx, USER_ID)))

        expect(result.ok).toBe(1)
        expect(await gemsOf()).toBe(PASSIVE_RESPEC_GEMS * 2)
        expect((await stateOf()).passiveTree).toEqual({})
    })

    it('grants a free respec with every prestige, and keeps the tree', async () => {
        const state = await stateOf()
        const reset = prestigeResetValues(state)
        expect(reset.passiveRespecFree).toBe(true)
        expect(reset).not.toHaveProperty('passiveTree')
    })
})
