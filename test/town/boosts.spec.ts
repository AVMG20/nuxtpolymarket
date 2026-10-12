import { describe, expect, it } from 'vitest'
import {
    TOWN_BOOST_MS,
    TOWN_TEMP_BUILDER_MS,
    isTownBoostActive,
    townBoostExtend,
    townBoostMultiplier,
    townBoostOverlapMs,
    townBoostUntil,
    townBuildBoostedCompletesAt,
    townBuildBoostedMs,
    townBuildRushedCompletesAt,
    townCrewCount,
    townMarketBonus,
    townMarketMultiplier
} from '#shared/utils/gamelogic/town-boosts'
import { settleTown, TOWN_TICK_MS, type TownSimBuilding, type TownSimState } from '#shared/utils/gamelogic/town'

const T0 = 1_700_000_000_000
const MIN = 60_000
const HOUR = 60 * MIN

function built(id: string, type: TownSimBuilding['type'], over: Partial<TownSimBuilding> = {}): TownSimBuilding {
    return { id, type, level: 1, completesAt: T0 - MIN, upgradingTo: null, createdAt: T0 - MIN, ...over }
}

function sim(over: Partial<TownSimState> = {}): TownSimState {
    // Content: ticks run at real time, so the tick counts below are exact.
    return { happiness: 60, tickProgressMs: 0, lastSettledAt: T0, inventory: {}, buildings: [], ...over }
}

/** A house and a level-2 farm: 2 wheat a tick, 1 eaten, so 1 a tick of surplus. */
function houseAndFarm(): TownSimBuilding[] {
    return [built('house', 'house', { createdAt: T0 - 90_000 }), built('farm', 'farm', { level: 2, createdAt: T0 - 80_000 })]
}

describe('Boost windows', () => {
    it('is on strictly before its end and off without one', () => {
        expect(isTownBoostActive(T0 + 1, T0)).toBe(true)
        expect(isTownBoostActive(T0, T0)).toBe(false)
        expect(isTownBoostActive(null, T0)).toBe(false)
        expect(townBoostUntil(T0 - 1, T0)).toBeNull()
        expect(townBoostUntil(T0 + HOUR, T0)).toBe(T0 + HOUR)
        expect(townBoostMultiplier(T0 + 1, T0)).toBe(2)
        expect(townBoostMultiplier(undefined, T0)).toBe(1)
        expect(townMarketMultiplier(T0 + 1, T0)).toBe(1.5)
    })

    it('starts from now, and a second one while running adds to its end', () => {
        expect(townBoostExtend(null, T0, TOWN_BOOST_MS)).toBe(T0 + HOUR)
        expect(townBoostExtend(T0 - 5 * MIN, T0, TOWN_BOOST_MS)).toBe(T0 + HOUR)
        expect(townBoostExtend(T0 + 20 * MIN, T0, TOWN_BOOST_MS)).toBe(T0 + 80 * MIN)
    })

    it('measures the overlap of a span with the window', () => {
        expect(townBoostOverlapMs(T0, T0 + 10, T0 + 4)).toBe(4)
        expect(townBoostOverlapMs(T0, T0 + 10, T0 + 20)).toBe(10)
        expect(townBoostOverlapMs(T0 + 5, T0 + 10, T0)).toBe(0)
        expect(townBoostOverlapMs(T0, T0 + 10, null)).toBe(0)
    })
})

describe('Builder\'s rush', () => {
    it('halves a job that fits in twice the window, and saves the whole window on a longer one', () => {
        expect(townBuildBoostedMs(30 * MIN, HOUR)).toBe(15 * MIN)
        expect(townBuildBoostedMs(2 * HOUR, HOUR)).toBe(HOUR)
        expect(townBuildBoostedMs(5 * HOUR, HOUR)).toBe(4 * HOUR)
        expect(townBuildBoostedMs(30 * MIN, 0)).toBe(30 * MIN)
        expect(townBuildBoostedMs(0, HOUR)).toBe(0)
    })

    it('is continuous where the two cases meet', () => {
        expect(townBuildBoostedMs(2 * HOUR + 1, HOUR)).toBe(HOUR + 1)
    })

    it('shortens a job started mid-rush by the rush left, not the full hour', () => {
        const until = T0 + 20 * MIN
        // 30 min of work, 20 min of rush: 40 min of work fits in the rush, so it all runs fast.
        expect(townBuildBoostedCompletesAt(T0, 30 * MIN, until)).toBe(T0 + 15 * MIN)
        // 3 h of work: the 20 min rush does 40 min of it.
        expect(townBuildBoostedCompletesAt(T0, 3 * HOUR, until)).toBe(T0 + 3 * HOUR - 20 * MIN)
        // No rush, or an expired one: unchanged.
        expect(townBuildBoostedCompletesAt(T0, 3 * HOUR, null)).toBe(T0 + 3 * HOUR)
        expect(townBuildBoostedCompletesAt(T0, 3 * HOUR, T0 - 1)).toBe(T0 + 3 * HOUR)
    })

    it('rewrites a running job from the start of the window on', () => {
        expect(townBuildRushedCompletesAt(T0 + 30 * MIN, T0, HOUR)).toBe(T0 + 15 * MIN)
        expect(townBuildRushedCompletesAt(T0 + 5 * HOUR, T0, HOUR)).toBe(T0 + 4 * HOUR)
        // Finishes before the window opens: untouched.
        expect(townBuildRushedCompletesAt(T0 + 10 * MIN, T0 + 20 * MIN, HOUR)).toBe(T0 + 10 * MIN)
    })

    it('extending a running rush only speeds up what is left past its old end', () => {
        // A 5 h job, rushed at T0: it now ends at T0 + 4h.
        const first = townBuildRushedCompletesAt(T0 + 5 * HOUR, T0, HOUR)
        // 30 min later a second rush adds an hour on the end of the first.
        const windowStart = Math.max(T0 + 30 * MIN, T0 + HOUR)
        const second = townBuildRushedCompletesAt(first, windowStart, HOUR)
        expect(second).toBe(T0 + 3 * HOUR)
        // The same as one two-hour rush laid down at T0.
        expect(townBuildRushedCompletesAt(T0 + 5 * HOUR, T0, 2 * HOUR)).toBe(second)
    })

    it('treats two rushes at once the same as two in a row', () => {
        for (const length of [30 * MIN, 3 * HOUR, 5 * HOUR, 10 * HOUR]) {
            const twice = townBuildRushedCompletesAt(townBuildRushedCompletesAt(T0 + length, T0, HOUR), T0 + HOUR, HOUR)
            expect(townBuildRushedCompletesAt(T0 + length, T0, 2 * HOUR)).toBe(twice)
        }
    })
})

describe('Production surge', () => {
    const ticks = 10
    const end = T0 + ticks * TOWN_TICK_MS
    const base = settleTown(sim({ buildings: houseAndFarm() }), end)

    it('leaves a settle without a surge alone', () => {
        expect(base.ticks).toBe(ticks)
        expect(settleTown(sim({ buildings: houseAndFarm(), productionBoostUntil: T0 - 1 }), end).delta).toEqual(base.delta)
        expect(settleTown(sim({ buildings: houseAndFarm(), productionBoostUntil: null }), end).delta).toEqual(base.delta)
    })

    it('doubles what the farm grows over a surged settle, but not what the town eats', () => {
        const surged = settleTown(sim({ buildings: houseAndFarm(), productionBoostUntil: end + HOUR }), end)
        expect(surged.ticks).toBe(base.ticks)
        // 2 wheat grown a tick becomes 4; the house still eats 1.
        expect(surged.delta.wheat).toBe(base.delta.wheat! + 2 * ticks)
    })

    it('only doubles the part of a settle before the surge ends', () => {
        const fourTicks = settleTown(sim({ buildings: houseAndFarm(), productionBoostUntil: T0 + 4 * TOWN_TICK_MS }), end)
        expect(fourTicks.delta.wheat).toBe(base.delta.wheat! + 2 * 4)
        // Ends halfway through tick 5: that tick grows half as much again.
        const midTick = settleTown(sim({ buildings: houseAndFarm(), productionBoostUntil: T0 + 4.5 * TOWN_TICK_MS }), end)
        expect(midTick.delta.wheat).toBe(base.delta.wheat! + 2 * 4 + 1)
    })

    it('matches one long settle when split into many short ones across the surge end', () => {
        const until = T0 + 4 * TOWN_TICK_MS
        let state = sim({ buildings: houseAndFarm(), productionBoostUntil: until })
        let wheat = 0
        for (let t = T0 + TOWN_TICK_MS / 4; t <= end; t += TOWN_TICK_MS / 4) {
            const r = settleTown(state, t)
            wheat += r.delta.wheat ?? 0
            state = { ...state, happiness: r.happiness, tickProgressMs: r.tickProgressMs, lastSettledAt: r.lastSettledAt, carry: r.carry, inventory: { wheat: (state.inventory.wheat ?? 0) + (r.delta.wheat ?? 0) } }
        }
        expect(wheat).toBe(base.delta.wheat! + 2 * 4)
    })

    it('makes a workshop eat its inputs twice as fast, and stop when they run out', () => {
        const town = [built('house', 'house'), built('saw', 'sawmill')]
        const plain = settleTown(sim({ buildings: town, inventory: { wood: 100 } }), T0 + 5 * TOWN_TICK_MS)
        const surged = settleTown(sim({ buildings: town, inventory: { wood: 100 }, productionBoostUntil: end }), T0 + 5 * TOWN_TICK_MS)
        expect(plain.delta.planks).toBeGreaterThan(0)
        expect(surged.delta.planks).toBe(2 * plain.delta.planks!)
        expect(surged.delta.wood).toBe(2 * plain.delta.wood!)

        // Wood for three runs: the surge's extra run fails on the second tick.
        const short = settleTown(sim({ buildings: town, inventory: { wood: 6 }, productionBoostUntil: end }), T0 + 5 * TOWN_TICK_MS)
        expect(short.delta.wood).toBe(-6)
        expect(short.delta.planks).toBe(3)
    })

    it('respects the offline cap', () => {
        const capped = settleTown(sim({ buildings: houseAndFarm(), productionBoostUntil: T0 + 100 * HOUR }), T0 + 100 * HOUR)
        const plain = settleTown(sim({ buildings: houseAndFarm() }), T0 + 100 * HOUR)
        expect(capped.ticks).toBe(plain.ticks)
    })
})

describe('Free builder', () => {
    it('adds one crew while it is here, never more', () => {
        expect(townCrewCount(3, T0 + TOWN_TEMP_BUILDER_MS, T0)).toBe(4)
        expect(townCrewCount(3, T0 + 2 * TOWN_TEMP_BUILDER_MS, T0)).toBe(4)
        expect(townCrewCount(3, T0, T0)).toBe(3)
        expect(townCrewCount(3, null, T0)).toBe(3)
    })
})

describe('Market day', () => {
    it('pays half again on a hall sale, capped by the budget left', () => {
        expect(townMarketBonus(1_000, 10_000, true)).toBe(500)
        expect(townMarketBonus(1_000, 120, true)).toBe(120)
        expect(townMarketBonus(1_000, 0, true)).toBe(0)
        expect(townMarketBonus(1_000, 10_000, false)).toBe(0)
        expect(townMarketBonus(0.00033, 10_000, true)).toBe(0.0001)
    })
})
