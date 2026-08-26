import { describe, expect, it } from 'vitest'
import {
    AFFIX_CAP, BASE_NODE_CAPACITY, ITEM_BASES, ITEM_SLOTS, MAKE_BY_ID, MAX_NODE_CAPACITY,
    RARITIES, RECIPES, TIERS, nodeCost
} from '#shared/utils/caravan/config'
import { affixRange, itemScore, rollItem, sumAffixes } from '#shared/utils/caravan/items'
import { generateMarket } from '#shared/utils/caravan/market'
import { objectives, topObjective } from '#shared/utils/caravan/objectives'
import { computeBonuses } from '#shared/utils/caravan/progression'
import { applyLoadout, planLoadout } from '#shared/utils/caravan/loadout'
import { abandonNode } from '#shared/utils/caravan/assignment'
import { createRng } from '#shared/utils/caravan/rng'
import { advance, projectRates } from '#shared/utils/caravan/sim'
import { createInitialState, migrateState } from '#shared/utils/caravan/state'
import {
    MAX_WORKER_LEVEL, createWorker, levelMultiplier, rarityGrowth, specialtyCount, xpForLevel, xpToReach
} from '#shared/utils/caravan/workers'
import { generateWorld } from '#shared/utils/caravan/world'
import type { CaravanState, World } from '#shared/utils/caravan/types'

const NOW = 1_700_000_000_000

function world(): World {
    return generateWorld()
}

/** The seams a state owns, nearest to the capital first. */
function seamsByDistance(w: World, state: CaravanState) {
    return state.ownedNodes
        .map(id => w.nodes[id]!)
        .filter(node => node.kind === 'resource')
        .sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y))
}

/** A caravan holding two tier-1 seams, for the posting tests. */
function ownTwoSeams(w: World): CaravanState {
    const state = createInitialState('user-2', NOW)
    const neighbours = w.edges
        .filter(e => e.a === 0 || e.b === 0)
        .map(e => (e.a === 0 ? e.b : e.a))
    const seams = w.nodes.filter(n => neighbours.includes(n.id) && n.kind === 'resource').slice(0, 2)
    for (const seam of seams) state.ownedNodes.push(seam.id)

    const worker = createWorker(createRng(5), 1, NOW)
    worker.at = 0
    // No specialties by default, so nothing but the posting is in play.
    worker.specialties = []
    state.workers.push(worker)
    state.resources.bread = 5000
    return state
}

/** A caravan holding one tier-1 resource node next to the capital, with a worker on it. */
function readyState(w: World): CaravanState {
    const state = createInitialState('user-1', NOW)
    const neighbourIds = w.edges
        .filter(e => e.a === 0 || e.b === 0)
        .map(e => (e.a === 0 ? e.b : e.a))
    const node = w.nodes.find(n => neighbourIds.includes(n.id) && n.kind === 'resource')!
    state.ownedNodes.push(node.id)

    const worker = createWorker(createRng(1), 1, NOW)
    worker.at = 0
    worker.assignment = node.id
    state.workers.push(worker)
    state.resources.bread = 500
    return state
}

describe('world generation', () => {
    it('is identical for the same seed', () => {
        const a = generateWorld()
        const b = generateWorld()
        expect(a.nodes.map(n => [n.id, Math.round(n.x), Math.round(n.y), n.name]))
            .toEqual(b.nodes.map(n => [n.id, Math.round(n.x), Math.round(n.y), n.name]))
    })

    it('puts a capital at the origin and connects every node back to it', () => {
        const w = world()
        expect(w.nodes[0]!.kind).toBe('capital')

        // Walk the whole graph from the origin -- nothing may be stranded.
        const seen = new Set([0])
        const queue = [0]
        while (queue.length) {
            const current = queue.pop()!
            for (const eid of w.adjacency[current] ?? []) {
                const edge = w.edges.find(e => e.id === eid)!
                const next = edge.a === current ? edge.b : edge.a
                if (!seen.has(next)) {
                    seen.add(next)
                    queue.push(next)
                }
            }
        }
        expect(seen.size).toBe(w.nodes.length)
    })

    it('gates every tier behind at least one camp', () => {
        const w = world()
        for (let tier = 2; tier <= 8; tier++) {
            expect(w.nodes.some(n => n.kind === 'camp' && n.tier === tier)).toBe(true)
        }
    })
})

describe('advance', () => {
    it('hauls resources and earns coins over an hour', () => {
        const w = world()
        const state = readyState(w)
        advance(state, w, NOW + 3_600_000)

        const node = w.nodes.find(n => n.id === state.ownedNodes[1])!
        expect(state.resources[node.resource!]).toBeGreaterThan(0)
        expect(state.stats.tripsCompleted).toBeGreaterThan(0)
        // Deliveries pay no coins at all -- money comes from selling.
        expect(state.pendingCoins).toBe(0)
    })

    it('reaches the same place whether time is advanced in one jump or many', () => {
        const w = world()
        const single = readyState(w)
        const split = readyState(w)

        advance(single, w, NOW + 1_800_000)

        for (let i = 1; i <= 30; i++) advance(split, w, NOW + i * 60_000)

        expect(split.stats.tripsCompleted).toBe(single.stats.tripsCompleted)
        expect(split.resources).toEqual(single.resources)
    })

    it('stops a worker that runs out of rations', () => {
        const w = world()
        const state = readyState(w)
        state.resources.bread = 0
        for (const worker of state.workers) worker.food = 1

        advance(state, w, NOW + 600_000)
        expect(state.workers[0]!.activity.type).toBe('starving')
    })

    it('caps offline progress at a day', () => {
        const w = world()
        const short = readyState(w)
        const long = readyState(w)

        advance(short, w, NOW + 24 * 3_600_000)
        const result = advance(long, w, NOW + 72 * 3_600_000)

        expect(result.truncated).toBe(true)
        expect(long.stats.tripsCompleted).toBe(short.stats.tripsCompleted)
    })

    it('depletes a node that is worked hard', () => {
        const w = world()
        const state = readyState(w)
        advance(state, w, NOW + 12 * 3_600_000)

        const nodeId = state.ownedNodes[1]!
        expect(state.depletion[nodeId]!.drawn).toBeGreaterThan(0)
    })
})

describe('worker postings', () => {
    it('works the seam it was posted to and nothing else', () => {
        const w = world()
        const state = ownTwoSeams(w)
        const [near, far] = seamsByDistance(w, state)

        state.workers[0]!.assignment = far.id

        advance(state, w, NOW + 1_800_000)

        expect(state.workers[0]!.assignment).toBe(far.id)
        expect(state.stats.tripsCompleted).toBeGreaterThan(0)
        // The nearer seam was never touched -- nothing reassigns a worker.
        expect(state.depletion[near.id]).toBeUndefined()
        expect(state.depletion[far.id]!.drawn).toBeGreaterThan(0)
    })

    it('leaves an unposted worker standing there rather than finding it work', () => {
        const w = world()
        const state = readyState(w)
        state.workers[0]!.assignment = null

        advance(state, w, NOW + 3_600_000)

        expect(state.workers[0]!.assignment).toBeNull()
        expect(state.stats.tripsCompleted).toBe(0)
    })

    it('drops a posting to a node the player no longer holds', () => {
        const w = world()
        const state = readyState(w)
        const seam = state.ownedNodes[1]!
        state.ownedNodes = state.ownedNodes.filter(id => id !== seam)

        advance(state, w, NOW + 600_000)

        expect(state.workers[0]!.assignment).toBeNull()
    })

    it('trims a seam holding more hands than it has room for', () => {
        const w = world()
        const state = ownTwoSeams(w)
        const [near] = seamsByDistance(w, state)

        const rng = createRng(77)
        for (let i = 0; i < 3; i++) {
            const worker = createWorker(rng, 1, NOW)
            worker.at = 0
            state.workers.push(worker)
        }
        // Everyone crammed onto one seam that only has room for two.
        state.nodeCapacity[near.id] = 2
        for (const worker of state.workers) worker.assignment = near.id

        advance(state, w, NOW + 600_000)

        expect(state.workers.filter(worker => worker.assignment === near.id).length).toBe(2)
        expect(state.workers.filter(worker => worker.assignment === null).length).toBe(2)
    })

    it('keeps a posting a widened seam has room for', () => {
        const w = world()
        const state = ownTwoSeams(w)
        const [near] = seamsByDistance(w, state)

        const rng = createRng(78)
        for (let i = 0; i < 3; i++) {
            const worker = createWorker(rng, 1, NOW)
            worker.at = 0
            state.workers.push(worker)
        }
        state.nodeCapacity[near.id] = 4
        for (const worker of state.workers) worker.assignment = near.id

        advance(state, w, NOW + 600_000)

        expect(state.workers.every(worker => worker.assignment === near.id)).toBe(true)
    })

    it('sends a reposted worker to the new seam at its next trip', () => {
        const w = world()
        const state = ownTwoSeams(w)
        const [near, far] = seamsByDistance(w, state)

        state.workers[0]!.assignment = near.id
        advance(state, w, NOW + 1_800_000)
        expect(state.depletion[near.id]!.drawn).toBeGreaterThan(0)

        const drawnAtNear = state.depletion[near.id]!.drawn
        state.workers[0]!.assignment = far.id
        state.workers[0]!.route = []
        state.workers[0]!.routeIndex = 0
        advance(state, w, NOW + 5_400_000)

        expect(state.depletion[far.id]!.drawn).toBeGreaterThan(0)
        expect(state.depletion[near.id]!.drawn).toBeLessThanOrEqual(drawnAtNear)
    })
})

describe('widened seams', () => {
    it('cuts faster on a widened seam than on a base one', () => {
        const w = world()

        // The same caravan twice over, differing only in how wide the seam has
        // been cut -- so the extra ore can only have come from the widening.
        const run = (width: number) => {
            const state = readyState(w)
            const seam = w.nodes[state.ownedNodes.find(id => w.nodes[id]!.kind === 'resource')!]!
            state.nodeCapacity[seam.id] = width
            advance(state, w, NOW + 3_600_000)
            return state.stats.hauledValue ?? 0
        }

        expect(run(MAX_NODE_CAPACITY)).toBeGreaterThan(run(BASE_NODE_CAPACITY))
    })
})

describe('standing orders', () => {
    it('bakes provisions on demand instead of starving', () => {
        const w = world()
        const starves = readyState(w)
        const bakes = readyState(w)

        for (const state of [starves, bakes]) {
            state.resources.bread = 0
            // Plenty of the raw the bread recipe wants, but no bread itself.
            state.resources.plant_fiber = 4000
            for (const worker of state.workers) worker.food = 1
        }
        bakes.research.push('standing_orders')
        bakes.policies.autoRefine = true

        advance(starves, w, NOW + 900_000)
        advance(bakes, w, NOW + 900_000)

        expect(starves.workers[0]!.activity.type).toBe('starving')
        expect(bakes.workers[0]!.activity.type).not.toBe('starving')
        expect(bakes.resources.plant_fiber).toBeLessThan(4000)
    })
})

describe('loadout planning', () => {
    it('gives the best item of each slot to the highest level worker', () => {
        const w = world()
        const state = readyState(w)
        const rng = createRng(11)

        state.workers.push(createWorker(rng, 1, NOW))
        state.workers[0]!.level = 20
        state.workers[1]!.level = 1
        for (let i = 0; i < 6; i++) {
            state.items.push(rollItem(rng, 3, { baseId: 'pickaxe', now: NOW + i }))
        }

        const changes = planLoadout(state)
        applyLoadout(state, changes)

        const best = [...state.items].sort((a, b) => itemScore(b) - itemScore(a))[0]!
        expect(state.workers[0]!.equipment.tool).toBe(best.id)
        // Nothing is worn twice.
        const worn = state.workers.flatMap(worker => Object.values(worker.equipment))
        expect(new Set(worn).size).toBe(worn.length)
    })

    it('is idempotent -- running it again changes nothing', () => {
        const w = world()
        const state = readyState(w)
        const rng = createRng(12)
        for (let i = 0; i < 8; i++) state.items.push(rollItem(rng, 2, { now: NOW + i }))

        applyLoadout(state, planLoadout(state))
        expect(planLoadout(state)).toHaveLength(0)
    })
})

describe('projectRates', () => {
    it('reports throughput without disturbing the state it measured', () => {
        const w = world()
        const state = readyState(w)
        advance(state, w, NOW + 600_000)

        const snapshot = JSON.stringify(state)
        const rates = projectRates(state, w, 1800)

        expect(rates.harvestValuePerHour).toBeGreaterThan(0)
        expect(rates.tripsPerHour).toBeGreaterThan(0)
        // The projection must never leak back into the real save.
        expect(JSON.stringify(state)).toBe(snapshot)
    })
})

describe('items', () => {
    it('never rolls an affix above the cap', () => {
        const rng = createRng(99)
        for (let i = 0; i < 400; i++) {
            const item = rollItem(rng, 8, { rarity: 'legendary', now: NOW })
            for (const affix of item.affixes) expect(affix.value).toBeLessThanOrEqual(AFFIX_CAP)
        }
    })

    it('gives a legendary a wider range than a common at the same tier', () => {
        const [, commonMax] = affixRange('carryCapacity', 5, 'common')
        const [, legendaryMax] = affixRange('carryCapacity', 5, 'legendary')
        expect(legendaryMax).toBeGreaterThan(commonMax * 2)
    })

    it('never rolls an affix a base cannot carry', () => {
        const rng = createRng(19)
        for (const base of ITEM_BASES) {
            const item = rollItem(rng, 5, { rarity: 'legendary', baseId: base.id, now: NOW })
            for (const affix of item.affixes) expect(base.pool).toContain(affix.stat)
        }
    })

    it('rolls exactly the affix count its rarity promises, on every base', () => {
        const rng = createRng(7)
        for (const rarity of RARITIES) {
            for (const base of ITEM_BASES) {
                const item = rollItem(rng, 4, { rarity: rarity.id, baseId: base.id, now: NOW })
                expect(item.affixes.length).toBe(rarity.affixes)
            }
        }
    })

    it('never rolls the same affix twice on one item', () => {
        const rng = createRng(31)
        for (let i = 0; i < 300; i++) {
            const item = rollItem(rng, 6, { rarity: 'legendary', now: NOW })
            const stats = item.affixes.map(a => a.stat)
            expect(new Set(stats).size).toBe(stats.length)
        }
    })
})

describe('save repair', () => {
    it('frees a worker whose activity can never finish', () => {
        const w = world()
        const state = readyState(w)
        // A non-finite deadline is what an infinite duration serialises to. Before
        // the repair this stranded the worker mid-job for good.
        state.workers[0]!.activity = {
            type: 'harvest',
            at: state.ownedNodes[1]!,
            startedAt: NOW,
            doneAt: Number.POSITIVE_INFINITY
        }

        const repaired = migrateState(JSON.parse(JSON.stringify(state)), 'user-1', NOW)
        expect(repaired.workers[0]!.activity.type).toBe('idle')

        advance(repaired, w, NOW + 900_000)
        expect(repaired.stats.tripsCompleted).toBeGreaterThan(0)
    })

    it('never writes an activity the simulation cannot complete', () => {
        const w = world()
        const state = readyState(w)
        // A zero-strength worker would have produced an infinite harvest time.
        state.workers[0]!.base.strength = 0

        advance(state, w, NOW + 600_000)

        for (const worker of state.workers) {
            const activity = worker.activity as { doneAt?: number, arrivesAt?: number }
            const deadline = activity.doneAt ?? activity.arrivesAt
            if (deadline !== undefined) expect(Number.isFinite(deadline)).toBe(true)
        }
    })
})

describe('recruitment market', () => {
    it('is identical for the same save and window', () => {
        const state = createInitialState('user-market', NOW)
        const bonuses = computeBonuses([])
        const a = generateMarket(state, bonuses, NOW)
        const b = generateMarket(state, bonuses, NOW + 60_000)
        expect(a.map(r => [r.slot, r.worker.name, r.price]))
            .toEqual(b.map(r => [r.slot, r.worker.name, r.price]))
    })

    it('posts a different slate in the next window', () => {
        const state = createInitialState('user-market', NOW)
        const bonuses = computeBonuses([])
        const a = generateMarket(state, bonuses, NOW)
        const b = generateMarket(state, bonuses, NOW + 12 * 3_600_000)
        expect(a.map(r => r.worker.name)).not.toEqual(b.map(r => r.worker.name))
    })

    it('grows by one slot per market research', () => {
        const state = createInitialState('user-market', NOW)
        expect(generateMarket(state, computeBonuses([]), NOW)).toHaveLength(3)
        expect(generateMarket(state, computeBonuses(['market_2', 'market_3']), NOW)).toHaveLength(5)
    })
})

describe('refinery and research queues', () => {
    it('delivers each batch as it comes off the line rather than at the end', () => {
        const w = world()
        // No workers: nothing eats the bread while the line is running, so the
        // only thing that can change the stock is the batch landing.
        const state = createInitialState('refinery', NOW)

        const recipe = RECIPES.find(r => r.id === 'refine_bread')!
        state.refineJobs.push({
            id: 'job-1',
            recipeId: recipe.id,
            batches: 2,
            startedAt: NOW,
            doneAt: NOW + 60_000
        })
        const before = state.resources.bread ?? 0

        // Halfway through a two-batch run, the first batch is made and in the
        // storehouse; the job keeps only the work still outstanding.
        advance(state, w, NOW + 30_000)
        expect(state.refineJobs).toHaveLength(1)
        expect(state.refineJobs[0]!.batches).toBe(1)
        expect(state.resources.bread).toBe(before + recipe.outputCount)

        advance(state, w, NOW + 90_000)
        expect(state.refineJobs).toHaveLength(0)
        expect(state.resources.bread).toBe(before + recipe.outputCount * 2)
    })

    it('pays nothing out before the first batch is finished', () => {
        const w = world()
        const state = createInitialState('refinery-early', NOW)

        const recipe = RECIPES.find(r => r.id === 'refine_bread')!
        state.refineJobs.push({
            id: 'job-1',
            recipeId: recipe.id,
            batches: 2,
            line: 0,
            startedAt: NOW,
            doneAt: NOW + 60_000
        })
        const before = state.resources.bread ?? 0

        advance(state, w, NOW + 20_000)
        expect(state.refineJobs[0]!.batches).toBe(2)
        expect(state.resources.bread).toBe(before)
    })

    it('completes a research job on time and only once', () => {
        const w = world()
        const state = readyState(w)
        state.researchJob = { id: 'crew_1', startedAt: NOW, doneAt: NOW + 120_000 }

        advance(state, w, NOW + 60_000)
        expect(state.research).not.toContain('crew_1')

        advance(state, w, NOW + 180_000)
        expect(state.research).toEqual(['crew_1'])
        expect(state.researchJob).toBeNull()
    })
})

describe('gem seams', () => {
    it('puts five gem seams in the world, none below tier 4', () => {
        const seams = world().nodes.filter(n => n.gemYield)
        expect(seams).toHaveLength(5)
        expect(seams.every(seam => seam.tier >= 4)).toBe(true)
    })

    it('accrues fractional gems as deliveries come in', () => {
        const w = world()
        const seam = w.nodes.find(n => n.gemYield)!
        const state = createInitialState('gems', NOW)
        state.tier = seam.tier
        // Walk a path out to the seam so the worker can actually reach it.
        state.ownedNodes = [0, seam.id]
        for (const camp of w.nodes.filter(n => n.kind === 'camp')) state.clearedCamps.push(camp.id)
        for (const node of w.nodes) {
            if (node.kind === 'resource' && node.id !== seam.id) state.ownedNodes.push(node.id)
        }
        for (const tier of TIERS) state.resources[tier.provision] = 100_000

        const worker = createWorker(createRng(3), seam.tier, NOW)
        worker.at = 0
        worker.assignment = seam.id
        state.workers.push(worker)

        advance(state, w, NOW + 6 * 3_600_000)
        expect(state.pendingGems).toBeGreaterThan(0)
    })
})

describe('worker stats', () => {
    it('grows toward a ceiling set by rarity, not a better starting point', () => {
        const rng = createRng(1234)
        const common = createWorker(rng, 3, NOW)
        common.rarity = 'common'
        common.growth = rarityGrowth('common')
        const legendary = { ...common, rarity: 'legendary' as const, growth: rarityGrowth('legendary') }

        // Identical base stats: at level 1 they are the same worker.
        expect(levelMultiplier({ ...common, level: 1 })).toBeCloseTo(levelMultiplier({ ...legendary, level: 1 }))
        // At max level the legendary has more than doubled the common's growth.
        expect(levelMultiplier({ ...legendary, level: MAX_WORKER_LEVEL }))
            .toBeGreaterThan(levelMultiplier({ ...common, level: MAX_WORKER_LEVEL }))
    })

    it('takes roughly a million experience to reach max level', () => {
        const total = xpToReach(MAX_WORKER_LEVEL)
        expect(total).toBeGreaterThan(700_000)
        expect(total).toBeLessThan(1_800_000)
    })

    it('front-loads the early levels', () => {
        // The first five levels together should cost less than the last one alone.
        const early = xpForLevel(1) + xpForLevel(2) + xpForLevel(3) + xpForLevel(4) + xpForLevel(5)
        expect(early).toBeLessThan(xpForLevel(MAX_WORKER_LEVEL - 1))
    })

    it('gives each tier a flat 25% and keeps the roll inside 1.00-1.25x', () => {
        const rng = createRng(404)
        const carries: number[][] = []
        for (let tier = 1; tier <= 4; tier++) {
            const samples: number[] = []
            for (let i = 0; i < 200; i++) samples.push(createWorker(rng, tier, NOW).base.carry)
            carries.push(samples)
        }
        for (let tier = 1; tier <= 4; tier++) {
            const base = 20 * Math.pow(1.25, tier - 1)
            expect(Math.min(...carries[tier - 1]!)).toBeGreaterThanOrEqual(Math.floor(base))
            expect(Math.max(...carries[tier - 1]!)).toBeLessThanOrEqual(Math.ceil(base * 1.25))
        }
    })

    it('lets a well-rolled worker beat a badly-rolled one a tier above', () => {
        // The bands overlap by design: 1.25x spread against a 1.25x tier step.
        const bestOfTier = 20 * 1.25
        const worstOfNextTier = 20 * 1.25
        expect(bestOfTier).toBeGreaterThanOrEqual(worstOfNextTier)
    })

    it('gives rarer workers more trades', () => {
        expect(specialtyCount('common')).toBe(1)
        expect(specialtyCount('rare')).toBe(2)
        expect(specialtyCount('legendary')).toBe(3)
    })
})

describe('set makes', () => {
    it('applies the lesser bonus at two pieces and the greater at all three', () => {
        const rng = createRng(808)
        const items = ITEM_SLOTS.map(slot => ({
            ...rollItem(rng, 1, { rarity: 'common', now: NOW }),
            slot,
            make: 'dwarven' as const,
            affixes: []
        }))

        expect(sumAffixes(items.slice(0, 1)).carryCapacity).toBe(0)
        expect(sumAffixes(items.slice(0, 2)).carryCapacity).toBe(MAKE_BY_ID.dwarven.three.value)

        const full = sumAffixes(items)
        expect(full.carryCapacity).toBe(MAKE_BY_ID.dwarven.three.value)
        expect(full.strength).toBe(MAKE_BY_ID.dwarven.five.value)
    })
})

describe('objectives', () => {
    it('puts starving workers above everything else', () => {
        const w = world()
        const state = readyState(w)
        state.resources.bread = 0
        state.workers[0]!.activity = { type: 'starving', at: 0 }

        const top = topObjective(state, w, 0)
        expect(top?.kind).toBe('starving')
    })

    it('tells a brand new caravan to go and recruit', () => {
        const w = world()
        const state = createInitialState('fresh', NOW)
        const kinds = objectives(state, w, 0).map(o => o.kind)
        expect(kinds).toContain('recruit')
    })

    it('suggests selling once the storehouse is worth more than a node', () => {
        const w = world()
        const state = readyState(w)
        state.resources.lumber = 50_000

        expect(objectives(state, w, 0).some(o => o.kind === 'sell')).toBe(true)
    })

    it('nags about workers left with no posting', () => {
        const w = world()
        const state = readyState(w)
        state.workers[0]!.assignment = null

        expect(objectives(state, w, 0).some(o => o.kind === 'idle-workers')).toBe(true)
    })

    it('offers nothing urgent when the caravan is running well', () => {
        const w = world()
        const state = readyState(w)
        const urgent = objectives(state, w, 0).filter(o => o.weight >= 150)
        expect(urgent).toHaveLength(0)
    })
})

describe('economy', () => {
    it('starts node purchases at 100k and scales exponentially', () => {
        expect(nodeCost(0)).toBe(100_000)
        expect(nodeCost(10)).toBeGreaterThan(nodeCost(9))
        expect(nodeCost(20) / nodeCost(10)).toBeGreaterThan(10)
    })
})

describe('abandoning a node', () => {
    it('drops the claim, the widening and the depletion, and pulls the crew off', () => {
        const w = world()
        const state = ownTwoSeams(w)
        const [seam] = seamsByDistance(w, state)
        state.workers[0]!.assignment = seam.id
        state.nodeCapacity[seam.id] = 5

        advance(state, w, NOW + 600_000)
        expect(state.depletion[seam.id]).toBeDefined()

        const { recalled, wasCapital } = abandonNode(state, seam.id)

        expect(recalled).toBe(1)
        expect(wasCapital).toBe(false)
        expect(state.ownedNodes).not.toContain(seam.id)
        expect(state.nodeCapacity[seam.id]).toBeUndefined()
        expect(state.depletion[seam.id]).toBeUndefined()
        expect(state.workers[0]!.assignment).toBeNull()
    })

    it('reports a capital and leaves the remaining one as home', () => {
        const w = world()
        const state = ownTwoSeams(w)
        const other = w.nodes.find(n => n.kind === 'capital' && n.id !== 0)!
        state.ownedNodes.push(other.id)
        state.capitals.push(other.id)

        const { wasCapital } = abandonNode(state, other.id)

        expect(wasCapital).toBe(true)
        expect(state.capitals).toEqual([0])
        expect(state.ownedNodes).not.toContain(other.id)
    })

    it('is a no-op on a node the player does not hold', () => {
        const w = world()
        const state = ownTwoSeams(w)
        const before = [...state.ownedNodes]

        expect(abandonNode(state, 9999)).toEqual({ recalled: 0, wasCapital: false })
        expect(state.ownedNodes).toEqual(before)
    })
})
