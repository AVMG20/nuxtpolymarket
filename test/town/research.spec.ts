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
            output: 0, supplyTiles: 0, buildTime: 0, popPerHouseLevel: 0, happiness: 0, storage: 0, floorPrice: 0
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
    })

    it('spreads its effects across every branch, so no branch is skippable', () => {
        for (const branch of TOWN_RESEARCH_BRANCHES) {
            const ids = TOWN_RESEARCH.filter(r => r.branch === branch).map(r => r.id)
            const effect = townResearchEffects(ids)
            expect(Object.values(effect).some(v => v > 0)).toBe(true)
        }
    })
})
