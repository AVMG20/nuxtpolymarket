import { describe, expect, it } from 'vitest'
import { RESEARCH, RESEARCH_BY_ID, STORAGE_CAP, STORAGE_CAP_RESEARCH, researchAvailable, storageLevel, tierOpen, type OreId, MAP_TILES } from '#shared/utils/gridworks/defs'
import { buildGraph, localToWorld, outputPorts, type Entity } from '#shared/utils/gridworks/layout'
import { solve, waterFill } from '#shared/utils/gridworks/flow'
import { applyOp, newState, parseOp, settle, storageCap, type GridState } from '#shared/utils/gridworks/game'
import { GOALS, GOAL_BY_ID, currentGoal, goalFocus } from '#shared/utils/gridworks/goals'
import { oreAt, oreMap } from '#shared/utils/gridworks/world'

const SEED = 12345
const ore = oreMap(SEED)

function findOre(kind: OreId, near = MAP_TILES / 2): [number, number] {
    for (let d = 0; d < 12; d++) {
        for (let y = near - d; y <= near + d; y++) {
            for (let x = near - d; x <= near + d; x++) {
                if (oreAt(ore, x, y) === kind) return [x, y]
            }
        }
    }
    throw new Error(`no ${kind} near the centre`)
}

/** A miner at (x, y) feeding `len` belts east into a 2×2 storage. */
function minerLine(x: number, y: number, len: number): Entity[] {
    const out: Entity[] = [{ k: 'miner', x, y, r: 0 }]
    for (let i = 1; i <= len; i++) out.push({ k: 'belt', x: x + i, y, r: 0 })
    out.push({ k: 'storage', x: x + len + 1, y, r: 0 })
    return out
}

describe('gridworks world', () => {
    it('is deterministic per seed and has every early ore in the start area', () => {
        expect(oreMap(SEED).tiles).toBe(ore.tiles)
        for (const kind of ['iron-ore', 'copper-ore', 'stone', 'coal'] as const) expect(() => findOre(kind)).not.toThrow()
    })
})

describe('gridworks layout', () => {
    it('rotates multi-tile footprints so the input edge faces the flow', () => {
        // A 1×2 mixer facing south: its two input tiles sit side by side on the top row.
        expect(localToWorld('mixer', 1, 0, 0)).toEqual([1, 0])
        expect(localToWorld('mixer', 1, 0, 1)).toEqual([0, 0])
        expect(localToWorld('mixer', 0, 0, 1)).toEqual([0, 1])
    })

    it('feeds a belt from behind before a side feeder', () => {
        const ents: Entity[] = [
            { k: 'belt', x: 0, y: 1, r: 0 },
            { k: 'belt', x: 1, y: 0, r: 1 },
            { k: 'belt', x: 1, y: 1, r: 0 }
        ]
        const g = buildGraph(ents)
        expect(g.inc[2]!.map(l => l.from)).toEqual([0])
        expect(g.out[1]![0]).toBeNull()
    })

    it('ramps lift a line to layer 1 over a machine', () => {
        const ents: Entity[] = [
            { k: 'ramp-up', x: 0, y: 0, r: 0 },
            { k: 'belt', x: 1, y: 0, r: 0, l: 1 },
            { k: 'smelter', x: 1, y: 0, r: 0 },
            { k: 'ramp-down', x: 2, y: 0, r: 0 }
        ]
        expect(outputPorts(ents[0]!)[0]).toMatchObject({ x: 1, y: 0, l: 1 })
        const g = buildGraph(ents)
        expect(g.out[0]![0]?.to).toBe(1)
        expect(g.out[1]![0]?.to).toBe(3)
    })
})

describe('gridworks flow', () => {
    it('splits a budget evenly and hands leftovers on', () => {
        expect(waterFill([1, 5, 5], 7)).toEqual([1, 3, 3])
        expect(waterFill([0, 2], 1)).toEqual([0, 1])
    })

    it('a miner delivers its rate into storage', () => {
        const [x, y] = findOre('iron-ore')
        const sol = solve(minerLine(x, y, 4), ore, { blocked: [], labWants: [] })
        expect(sol.store['iron-ore']).toBeCloseTo(0.5, 2)
    })

    it('a smelter turns ore into plates at its recipe rate', () => {
        const [x, y] = findOre('iron-ore')
        const ents: Entity[] = [
            { k: 'miner', x, y, r: 0 },
            { k: 'belt', x: x + 1, y, r: 0 },
            { k: 'smelter', x: x + 2, y, r: 0 },
            { k: 'belt', x: x + 3, y, r: 0 },
            { k: 'storage', x: x + 4, y, r: 0 }
        ]
        const sol = solve(ents, ore, { blocked: [], labWants: [] })
        // One smelter does 0.5 plates/s and the miner gives 0.5 ore/s.
        expect(sol.store['iron-plate']).toBeCloseTo(0.5, 2)
        expect(sol.store['iron-ore'] ?? 0).toBe(0)
    })

    it('a full storage stops taking that item and the line backs up', () => {
        const [x, y] = findOre('iron-ore')
        const sol = solve(minerLine(x, y, 3), ore, { blocked: ['iron-ore'], labWants: [] })
        expect(sol.store['iron-ore'] ?? 0).toBe(0)
    })

    it('labs only take what the research still needs', () => {
        const [x, y] = findOre('iron-ore')
        const ents: Entity[] = [
            { k: 'miner', x, y, r: 0 },
            { k: 'belt', x: x + 1, y, r: 0 },
            { k: 'lab', x: x + 2, y, r: 0 }
        ]
        expect(solve(ents, ore, { blocked: [], labWants: ['iron-ore'] }).lab['iron-ore']).toBeCloseTo(0.5, 2)
        expect(solve(ents, ore, { blocked: [], labWants: ['stone'] }).lab['iron-ore'] ?? 0).toBe(0)
    })
})

describe('gridworks settle and ops', () => {
    const now = Date.UTC(2026, 10, 14)
    const fresh = (): GridState => newState(SEED, now)

    it('pays for placing and refunds removing in full', () => {
        const s = fresh()
        const [x, y] = findOre('iron-ore')
        const before = { ...s.stock }
        expect(applyOp(s, { op: 'place', e: { k: 'miner', x, y, r: 0 } }, now)).toBeNull()
        expect(s.stock['iron-ore']).toBe((before['iron-ore'] ?? 0) - 10)
        expect(applyOp(s, { op: 'remove', x, y, l: 0 }, now)).toBeNull()
        expect(s.stock).toEqual(before)
    })

    it('rejects miners off ore, overlaps and locked buildings', () => {
        const s = fresh()
        const [x, y] = findOre('iron-ore')
        expect(applyOp(s, { op: 'place', e: { k: 'miner', x: 47, y: 47, r: 0 } }, now)).toBe('blocked')
        expect(applyOp(s, { op: 'place', e: { k: 'smelter', x, y, r: 0 } }, now)).toBe('locked')
        expect(applyOp(s, { op: 'place', e: { k: 'belt', x: 0, y: 0, r: 0 } }, now)).toBe('land')
    })

    it('settles from dates: an hour away fills storage up to the cap', () => {
        const s = fresh()
        const [x, y] = findOre('iron-ore')
        s.entities.push(...minerLine(x, y, 2))
        s.layout++
        const start = s.stock['iron-ore'] ?? 0
        settle('t', s, now + 60_000)
        expect(s.stock['iron-ore']).toBeCloseTo(start + 30, 0)
        settle('t', s, now + 3_600_000)
        expect(s.stock['iron-ore']).toBe(storageCap(s))
        expect(s.settledAt).toBe(now + 3_600_000)
    })

    it('research completes offline once the labs got everything', () => {
        const s = fresh()
        const [x, y] = findOre('iron-ore')
        s.entities.push({ k: 'miner', x, y, r: 0 }, { k: 'belt', x: x + 1, y, r: 0 }, { k: 'lab', x: x + 2, y, r: 0 })
        s.layout++
        expect(applyOp(s, { op: 'research', id: 'smelting' }, now)).toBeNull()
        // 40 ore at 0.5/s is 80 s.
        const events = settle('t2', s, now + 200_000)
        expect(events.map(e => e.id)).toEqual(['smelting'])
        expect(events[0]!.t).toBeGreaterThan(now + 70_000)
        expect(events[0]!.t).toBeLessThan(now + 95_000)
        expect(s.done).toContain('smelting')
        expect(s.queue).toEqual([])
    })

    it('never rewinds, and an earlier clock leaves the plot alone', () => {
        const s = fresh()
        const [x, y] = findOre('iron-ore')
        s.entities.push(...minerLine(x, y, 2))
        s.layout++
        settle('t3', s, now + 10_000)
        const stock = { ...s.stock }
        expect(settle('t3', s, now + 4_000)).toEqual([])
        expect(s.settledAt).toBe(now + 10_000)
        expect(s.stock).toEqual(stock)
    })

    it('the highest storage research sets the cap, whichever came before it', () => {
        expect(storageLevel([])).toBe(0)
        STORAGE_CAP_RESEARCH.forEach((id, i) => expect(storageLevel([id])).toBe(i + 1))
        expect(storageLevel([STORAGE_CAP_RESEARCH[0]!, STORAGE_CAP_RESEARCH[3]!])).toBe(4)
        const s = fresh()
        s.done.push(STORAGE_CAP_RESEARCH[3]!)
        expect(storageCap(s)).toBe(2 * STORAGE_CAP[4]!)
    })

    it('hand mining stops at the storage cap', () => {
        const s = fresh()
        const [x, y] = findOre('stone')
        const cap = storageCap(s)
        s.stock.stone = cap - 3
        expect(applyOp(s, { op: 'mine', x, y, n: 10 }, now)).toBeNull()
        expect(s.stock.stone).toBe(cap)
        expect(s.mined).toBe(3)
        const tokens = s.mine.tokens
        expect(applyOp(s, { op: 'mine', x, y, n: 1 }, now)).toBe('full')
        expect(s.stock.stone).toBe(cap)
        expect(s.mine.tokens).toBe(tokens)
    })

    it('refunds arrive in full even above the storage cap', () => {
        const s = fresh()
        const [x, y] = findOre('iron-ore')
        expect(applyOp(s, { op: 'place', e: { k: 'miner', x, y, r: 0 } }, now)).toBeNull()
        const cap = storageCap(s)
        s.stock.stone = cap
        expect(applyOp(s, { op: 'remove', x, y, l: 0 }, now)).toBeNull()
        expect(s.stock.stone).toBeGreaterThan(cap)
        // Settling never takes the surplus away again.
        settle('t4', s, now + 60_000)
        expect(s.stock.stone).toBeGreaterThan(cap)
    })

    it('hand mining is rate limited by a token bucket', () => {
        const s = fresh()
        const [x, y] = findOre('stone')
        const start = s.stock.stone ?? 0
        expect(applyOp(s, { op: 'mine', x, y, n: 100 }, now)).toBeNull()
        expect(s.stock.stone).toBe(start + 24)
        expect(applyOp(s, { op: 'mine', x, y, n: 5 }, now)).toBe('busy')
        expect(applyOp(s, { op: 'mine', x, y, n: 5 }, now + 1000)).toBeNull()
        expect(s.stock.stone).toBe(start + 29)
    })
})

describe('gridworks goals', () => {
    const now = Date.UTC(2026, 10, 14)

    it('claims goals in order, once each, only when met', () => {
        const s = newState(SEED, now)
        expect(currentGoal(s)?.id).toBe('hello')
        expect(applyOp(s, { op: 'goal', id: 'hand-mine' }, now, null)).toBe('missing')
        expect(applyOp(s, { op: 'goal', id: 'hello' }, now, null)).toBeNull()
        expect(applyOp(s, { op: 'goal', id: 'hello' }, now, null)).toBe('missing')
        expect(currentGoal(s)?.id).toBe('hand-mine')

        const stone = s.stock.stone ?? 0
        expect(applyOp(s, { op: 'goal', id: 'hand-mine' }, now, null)).toBe('goal')
        const [x, y] = findOre('iron-ore')
        expect(applyOp(s, { op: 'mine', x, y, n: 10 }, now)).toBeNull()
        expect(s.mined).toBe(10)
        expect(applyOp(s, { op: 'goal', id: 'hand-mine' }, now, null)).toBeNull()
        expect(s.stock.stone).toBe(stone + (GOAL_BY_ID['hand-mine']!.reward.stone ?? 0))
        expect(s.goals).toEqual(['hello', 'hand-mine'])
    })

    it('rejects unknown and oversized goal ids', () => {
        expect(parseOp({ op: 'goal', id: 'x'.repeat(41) })).toBeNull()
        expect(parseOp({ op: 'goal', id: 1 })).toBeNull()
        expect(parseOp({ op: 'goal', id: 'nope' })).toBeNull()
        expect(parseOp({ op: 'goal', id: 'hello' })).toEqual({ op: 'goal', id: 'hello' })
    })

    it('keeps the ids players already claimed and leads through tier 5', () => {
        const ids = GOALS.map(g => g.id)
        expect(new Set(ids).size).toBe(ids.length)
        for (const id of ['hello', 'hand-mine', 'first-miner', 'first-belt', 'two-ores', 'pick-research', 'lab', 'smelting', 'plates', 'bricks', 'land', 'plates-60', 'tier-2', 'gears', 'steel', 'tier-3', 'motors', 'tier-4', 'chips', 'fusion']) {
            expect(ids).toContain(id)
        }
        expect(ids.indexOf('tier-5')).toBeGreaterThan(ids.indexOf('chips'))
        expect(ids.indexOf('tier-5')).toBeLessThan(ids.indexOf('fusion'))
    })

    it('points at the research tree until the building a goal needs is unlocked', () => {
        const s = newState(SEED, now)
        const bricks = GOAL_BY_ID.bricks!
        expect(goalFocus(bricks, s)).toBe('research')
        s.done.push('kiln')
        expect(goalFocus(bricks, s)).toBe('build:kiln')
        const chips = GOAL_BY_ID.chips!
        expect(goalFocus(chips, s)).toBe('research')
        s.done.push('oil')
        expect(goalFocus(chips, s)).toBe('build:pumpjack')
    })
})

describe('gridworks untrusted input', () => {
    const now = Date.UTC(2026, 10, 14)
    // Names every plain object answers to through its prototype.
    const INHERITED = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']

    it('lookup tables have no inherited keys', () => {
        for (const id of INHERITED) {
            expect(RESEARCH_BY_ID[id]).toBeUndefined()
            expect(GOAL_BY_ID[id]).toBeUndefined()
            expect(researchAvailable(id, [])).toBe(false)
        }
        expect(tierOpen(Number.NaN, [])).toBe(false)
        expect(tierOpen(undefined as unknown as number, [])).toBe(false)
    })

    it('parseOp rejects ids that only exist on Object.prototype', () => {
        for (const id of INHERITED) {
            expect(parseOp({ op: 'research', id })).toBeNull()
            expect(parseOp({ op: 'unqueue', id })).toBeNull()
            expect(parseOp({ op: 'goal', id })).toBeNull()
            expect(parseOp({ op: 'place', e: { k: id, x: 44, y: 44, r: 0 } })).toBeNull()
            expect(parseOp({ op: 'place', e: { k: 'smelter', x: 44, y: 44, r: 0, recipe: id } })).toBeNull()
            expect(parseOp({ op: 'place', e: { k: 'smart-splitter', x: 44, y: 44, r: 0, filter: id } })).toBeNull()
            expect(parseOp({ op: 'recipe', x: 44, y: 44, recipe: id })).toBeNull()
            expect(parseOp({ op: 'filter', x: 44, y: 44, item: id })).toBeNull()
            expect(parseOp({ op: 'chunk', key: id })).toBeNull()
        }
    })

    it('parseOp keeps every real id', () => {
        for (const n of RESEARCH) expect(parseOp({ op: 'research', id: n.id })).toEqual({ op: 'research', id: n.id })
        expect(parseOp({ op: 'place', e: { k: 'smelter', x: 44, y: 44, r: 1, recipe: 'copper-plate' } }))
            .toEqual({ op: 'place', e: { k: 'smelter', x: 44, y: 44, r: 1, recipe: 'copper-plate' } })
        expect(parseOp({ op: 'recipe', x: 1, y: 2, recipe: 'gear' })).toEqual({ op: 'recipe', x: 1, y: 2, recipe: 'gear' })
        expect(parseOp({ op: 'filter', x: 1, y: 2, item: 'gear' })).toEqual({ op: 'filter', x: 1, y: 2, item: 'gear' })
        expect(parseOp({ op: 'filter', x: 1, y: 2, item: null })).toEqual({ op: 'filter', x: 1, y: 2, item: null })
        expect(parseOp({ op: 'chunk', key: '4,5' })).toEqual({ op: 'chunk', key: '4,5' })
    })

    it('parseOp rejects chunk keys off the map or not in canonical form', () => {
        for (const key of ['12,0', '0,12', '05,5', '-1,5', '5', '5,5,5', ' 5,5', '5.0,5', '1e1,5']) {
            expect(parseOp({ op: 'chunk', key })).toBeNull()
        }
    })

    it('applyOp turns away a hand-built op with a made-up id instead of throwing', () => {
        const s = newState(SEED, now)
        for (const id of INHERITED) {
            expect(applyOp(s, { op: 'research', id }, now)).toBe('research')
            expect(applyOp(s, { op: 'place', e: { k: id as 'belt', x: 44, y: 44, r: 0 } }, now)).toBe('invalid')
            expect(applyOp(s, { op: 'recipe', x: 47, y: 47, recipe: id }, now)).toBe('recipe')
            expect(applyOp(s, { op: 'goal', id }, now, null)).toBe('missing')
        }
        expect(s.queue).toEqual([])
    })
})
