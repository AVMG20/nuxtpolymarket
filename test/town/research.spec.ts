import { describe, expect, it } from 'vitest'
import {
    TOWN_RESEARCH,
    TOWN_RESEARCH_BRANCHES,
    TOWN_RESEARCH_BRANCH_DEFS,
    TOWN_RESEARCH_STEP_HOURS,
    getTownResearch,
    townResearchEffects,
    townResearchPrerequisite,
    townResearchTotalMs,
    townResearchUnlocked
} from '#shared/utils/gamelogic/town-research'
import {
    TOWN_NO_RESEARCH,
    TOWN_TICK_MS,
    deriveTown,
    getTownBuilding,
    settleTown,
    townFloorIncomePerDay,
    townLevelBuildMs,
    townTierRequirement,
    type TownBuildingId,
    type TownResearchBonus,
    type TownSimBuilding
} from '#shared/utils/gamelogic/town'

const HOUR = 60 * 60_000
const DAY = 24 * HOUR

const allIds = TOWN_RESEARCH.map(r => r.id)

describe('the research board', () => {
    it('gives every branch the same number of steps, so the tree reads straight', () => {
        for (const branch of TOWN_RESEARCH_BRANCHES) {
            const steps = TOWN_RESEARCH.filter(r => r.branch === branch)
            expect(steps).toHaveLength(TOWN_RESEARCH_STEP_HOURS.length)
            expect(steps.map(s => s.step)).toEqual(steps.map((_, i) => i + 1))
        }
        expect(TOWN_RESEARCH_BRANCH_DEFS.map(b => b.id)).toEqual([...TOWN_RESEARCH_BRANCHES])
    })

    it('has a unique id for every project', () => {
        expect(new Set(allIds).size).toBe(allIds.length)
        for (const id of allIds) expect(getTownResearch(id)).toBeDefined()
        expect(getTownResearch('nope')).toBeUndefined()
    })

    it('makes every project cost more and take longer than the one before it', () => {
        for (const branch of TOWN_RESEARCH_BRANCHES) {
            const steps = TOWN_RESEARCH.filter(r => r.branch === branch)
            for (let i = 1; i < steps.length; i++) {
                expect(steps[i]!.durationMs).toBeGreaterThan(steps[i - 1]!.durationMs)
                expect(steps[i]!.coins).toBeGreaterThan(steps[i - 1]!.coins)
            }
        }
    })

    it('runs from half a day to the three-day wall, and no further', () => {
        for (const r of TOWN_RESEARCH) {
            expect(r.durationMs).toBeGreaterThanOrEqual(12 * HOUR)
            expect(r.durationMs).toBeLessThanOrEqual(72 * HOUR)
        }
    })

    it('takes about two months to finish back to back', () => {
        const days = townResearchTotalMs() / DAY
        expect(days).toBeGreaterThan(50)
        expect(days).toBeLessThan(70)
    })
})

describe('townResearchUnlocked', () => {
    it('opens the first step of every branch to a town that has done nothing', () => {
        for (const branch of TOWN_RESEARCH_BRANCHES) {
            const first = TOWN_RESEARCH.find(r => r.branch === branch && r.step === 1)!
            expect(townResearchPrerequisite(first)).toBeNull()
            expect(townResearchUnlocked(first, [])).toBe(true)
        }
    })

    it('keeps every later step shut until the one before it is finished', () => {
        const second = TOWN_RESEARCH.find(r => r.branch === 'yield' && r.step === 2)!
        const first = TOWN_RESEARCH.find(r => r.branch === 'yield' && r.step === 1)!
        expect(townResearchPrerequisite(second)!.id).toBe(first.id)
        expect(townResearchUnlocked(second, [])).toBe(false)
        expect(townResearchUnlocked(second, [first.id])).toBe(true)
    })

    it('does not let one branch unlock another', () => {
        const yieldFirst = TOWN_RESEARCH.find(r => r.branch === 'yield' && r.step === 1)!
        const tradeSecond = TOWN_RESEARCH.find(r => r.branch === 'trade' && r.step === 2)!
        expect(townResearchUnlocked(tradeSecond, [yieldFirst.id])).toBe(false)
    })
})

describe('townResearchEffects', () => {
    it('adds up to nothing for a town that has researched nothing', () => {
        expect(townResearchEffects([])).toEqual({
            output: 0, supplyTiles: 0, buildTime: 0, popPerHouseLevel: 0, happiness: 0, storage: 0
        })
    })

    it('sums percentages without float noise leaking out', () => {
        // 0.04 + 0.05 + ... lands on 0.39999999999999997 unrounded.
        const all = townResearchEffects(allIds)
        for (const value of Object.values(all)) {
            expect(String(value).replace('-', '').split('.')[1]?.length ?? 0).toBeLessThanOrEqual(4)
        }
    })

    it('does not care what order the projects were finished in', () => {
        const forward = townResearchEffects(allIds)
        const backward = townResearchEffects([...allIds].reverse())
        expect(forward).toEqual(backward)
    })

    it('ignores ids that are not projects', () => {
        expect(townResearchEffects(['nope', 'yield-1'])).toEqual(townResearchEffects(['yield-1']))
    })

    it('keeps the whole board worth having without letting it replace the town', () => {
        const all = townResearchEffects(allIds)
        // Output and build time are the two that compound with everything else.
        expect(all.output).toBeGreaterThan(0.2)
        expect(all.output).toBeLessThanOrEqual(0.5)
        expect(all.buildTime).toBeGreaterThan(0.2)
        expect(all.buildTime).toBeLessThan(0.5)
        // Nothing may ever take a timer to zero or reverse a cost.
        expect(all.buildTime).toBeLessThan(1)
        expect(all.popPerHouseLevel).toBeLessThanOrEqual(1)
        expect(all.happiness).toBeLessThanOrEqual(20)
        // Nothing in the board may move a price: the town hall's floor is also
        // the book's minimum ask, and a per-player gap between them is free money.
        expect('floorPrice' in all).toBe(false)
    })

    it('spreads its effects across every branch, so no branch is skippable', () => {
        for (const branch of TOWN_RESEARCH_BRANCHES) {
            const ids = TOWN_RESEARCH.filter(r => r.branch === branch).map(r => r.id)
            const effect = townResearchEffects(ids)
            expect(Object.values(effect).some(v => v > 0)).toBe(true)
        }
    })
})

describe('research reaches the rules it is supposed to', () => {
    const T0 = 1_700_000_000_000
    const bonus = (over: Partial<TownResearchBonus> = {}): TownResearchBonus => ({ ...TOWN_NO_RESEARCH, ...over })

    const built = (id: string, type: TownBuildingId, over: Partial<TownSimBuilding> = {}): TownSimBuilding => ({
        id, type, level: 1, completesAt: T0 - 60_000, upgradingTo: null, createdAt: T0 - 60_000, ...over
    })

    it('shortens a build timer by exactly what the Construction branch adds up to', () => {
        const smithy = getTownBuilding('smithy')!
        const plain = townLevelBuildMs(smithy, 2, 50)
        const researched = townLevelBuildMs(smithy, 2, 50, bonus({ buildTime: 0.34 }))
        expect(researched).toBe(Math.round(plain * 0.66))
        expect(researched).toBeLessThan(plain)
    })

    it('raises what a workshop puts through', () => {
        const town = [
            built('road', 'road', { wx: 0, wy: 1 }),
            built('farm', 'farm', { level: 5, wx: 0, wy: 0, rotation: 0 })
        ]
        const plain = deriveTown(town, 50, T0).throughput.get('farm')!
        const researched = deriveTown(town, 50, T0, {}, undefined, bonus({ output: 0.34 })).throughput.get('farm')!
        expect(researched).toBeCloseTo(plain * 1.34, 6)
    })

    it('houses more people, and the tier gate counts them', () => {
        const town = [
            built('road', 'road', { wx: 0, wy: 1 }),
            built('house', 'house', { level: 5, wx: 0, wy: 0, rotation: 0 })
        ]
        const withRoom = bonus({ popPerHouseLevel: 1 })
        const plainPop = deriveTown(town, 50, T0).popCap
        const roomyPop = deriveTown(town, 50, T0, {}, undefined, withRoom).popCap
        expect(roomyPop).toBeGreaterThan(plainPop)

        // The gate has to see the same residents the workshops are staffed with.
        const gate = townTierRequirement(town, 2, T0, {}, withRoom)
        expect(gate === null ? Infinity : gate.pop).toBe(roomyPop)
    })

    it('raises the storage cap and the happiness target', () => {
        const town = [
            built('road', 'road', { wx: 0, wy: 1 }),
            built('house', 'house', { level: 2, wx: 0, wy: 0, rotation: 0 })
        ]
        const plain = deriveTown(town, 50, T0)
        const researched = deriveTown(town, 50, T0, {}, undefined, bonus({ storage: 0.6, happiness: 12 }))
        expect(researched.storageCap).toBe(Math.round(plain.storageCap * 1.6))
        expect(researched.happinessTarget).toBe(Math.min(100, plain.happinessTarget + 12))
    })

    it('pays more per day once Trade and Yield are in', () => {
        // A farm with nobody to work it earns nothing at all, researched or not.
        const town = [
            built('road', 'road', { wx: 0, wy: 1 }),
            built('houseroad', 'road', { wx: 1, wy: 1 }),
            built('house', 'house', { level: 6, wx: 1, wy: 0, rotation: 0 }),
            built('farm', 'farm', { level: 8, wx: 0, wy: 0, rotation: 0 })
        ]
        const plain = townFloorIncomePerDay(town, 50, T0)
        expect(plain).toBeGreaterThan(0)
        const researched = townFloorIncomePerDay(town, 50, T0, bonus({ output: 0.34 }))
        expect(researched).toBeGreaterThan(plain)
    })

    it('carries the bonus through a settle, so the town really banks it', () => {
        const buildings = [
            built('road', 'road', { wx: 0, wy: 1 }),
            built('farm', 'farm', { level: 10, wx: 0, wy: 0, rotation: 0 }),
            built('house', 'house', { level: 3, wx: 1, wy: 0, rotation: 0 }),
            built('houseroad', 'road', { wx: 1, wy: 1 })
        ]
        const state = { happiness: 50, tickProgressMs: 0, lastSettledAt: T0, inventory: {}, buildings }
        const plain = settleTown({ ...state }, T0 + 5 * TOWN_TICK_MS)
        const researched = settleTown({ ...state, research: bonus({ output: 0.34 }) }, T0 + 5 * TOWN_TICK_MS)
        expect(researched.delta.wheat!).toBeGreaterThan(plain.delta.wheat!)
    })
})
