import { describe, expect, it } from 'vitest'
import {
    deriveTown,
    getTownBuilding,
    townBuildersBusy,
    townBuildingsFronting,
    townGroupMoveIssue,
    townMonumentBonus,
    townMonumentJob,
    townPlacementIssue,
    townPlotIsFlat,
    townReachableTier,
    townSpiralCoords,
    townRoadAccess,
    townTierRequirement,
    type TownBuildingId,
    type TownSimBuilding
} from '#shared/utils/gamelogic/town'
import {
    TOWN_MONUMENT_STAGES,
    getTownMonument,
    townMonumentEffect
} from '#shared/utils/gamelogic/town-monuments'

const T0 = 1_700_000_000_000
// Every layout here sits on a plot the terrain generator leaves flat, so no
// pond decides a placement the test meant to be about something else.
const FLAT = (() => {
    for (let i = 0; i < 10_000; i++) {
        const spot = townSpiralCoords(i)
        if (townPlotIsFlat(spot.x, spot.y)) return spot
    }
    throw new Error('no flat plot')
})()
const PX = FLAT.x
const PY = FLAT.y

function at(id: string, type: TownBuildingId, wx: number, wy: number, over: Partial<TownSimBuilding> = {}): TownSimBuilding {
    return { id, type, level: 1, completesAt: T0 - 60_000, upgradingTo: null, createdAt: T0 - 60_000, wx, wy, rotation: 0, ...over }
}
function road(wx: number, wy: number) {
    return at(`road-${wx}-${wy}`, 'road', wx, wy)
}

describe('monument footprints', () => {
    const pyramid = getTownBuilding('pyramid')!
    const ox = PX * 8
    const oy = PY * 8

    it('takes every tile it covers, not just its anchor', () => {
        const layout = [at('p', 'pyramid', ox + 2, oy + 1, { rotation: 2 })]
        expect(townPlacementIssue(layout, getTownBuilding('road')!, ox + 4, oy + 3, 0)).toMatch(/taken/)
        expect(townPlacementIssue(layout, getTownBuilding('road')!, ox + 5, oy + 3, 0)).toBeNull()
    })

    it('has to fit on one plot', () => {
        expect(townPlacementIssue([road(ox + 6, oy)], pyramid, ox + 6, oy + 1, 2)).toMatch(/one plot/)
    })

    it('can be placed without a road, but only connects along its front', () => {
        expect(townPlacementIssue([], pyramid, ox + 2, oy + 1, 2)).toBeNull()
        expect(townPlacementIssue([road(ox + 4, oy)], pyramid, ox + 2, oy + 1, 2)).toBeNull()
        const standing = at('p', 'pyramid', ox + 2, oy + 1, { rotation: 2 })
        expect(townRoadAccess([standing, road(ox + 3, oy)], standing)).toBe(true)
        expect(townRoadAccess([standing, road(ox + 5, oy)], standing)).toBe(false)
        expect(townBuildingsFronting([standing], ox + 3, oy).map(b => b.id)).toEqual(['p'])
    })

    it('moves as a whole square, and cannot land over something else', () => {
        const layout = [at('p', 'pyramid', ox + 2, oy + 1), at('h', 'house', ox + 6, oy + 6)]
        expect(townGroupMoveIssue(layout, [{ id: 'p', wx: ox + 4, wy: oy + 4, rotation: 0 }])).toMatch(/in the way/)
        expect(townGroupMoveIssue(layout, [{ id: 'p', wx: ox + 3, wy: oy + 3, rotation: 0 }])).toBeNull()
    })
})

describe('monuments in the town', () => {
    const ox = PX * 8
    const oy = PY * 8

    it('adds its perk only once a stage stands and a road reaches it', () => {
        const eiffel = (over: Partial<TownSimBuilding>) => at('e', 'eiffel', ox, oy + 1, { rotation: 2, ...over })
        const stage3 = townMonumentEffect(getTownMonument('eiffel')!, 3).output!
        expect(stage3).toBeGreaterThan(0)
        expect(townMonumentBonus([eiffel({ level: 3 }), road(ox, oy)], T0).output).toBeCloseTo(stage3)
        expect(townMonumentBonus([eiffel({ level: 3 })], T0).output).toBe(0)
        // A stage going up gives nothing until it is done.
        expect(townMonumentBonus([eiffel({ level: 3, upgradingTo: 4, completesAt: T0 + 1 }), road(ox, oy)], T0).output).toBeCloseTo(stage3)
        expect(townMonumentBonus([eiffel({ level: 0, completesAt: T0 + 1 }), road(ox, oy)], T0).output).toBe(0)
    })

    it('makes every workshop run faster through the derive', () => {
        const farm = at('f', 'farm', ox + 3, oy + 1, { rotation: 2 })
        const house = at('h', 'house', ox + 4, oy + 1, { rotation: 2, level: 5 })
        const street = [farm, house, road(ox + 3, oy), road(ox + 4, oy)]
        const plain = deriveTown(street, 50, T0).throughput.get('f')!
        const boosted = deriveTown([...street, at('e', 'eiffel', ox, oy + 1, { rotation: 2, level: TOWN_MONUMENT_STAGES }), road(ox, oy), road(ox + 1, oy), road(ox + 2, oy)], 50, T0).throughput.get('f')!
        expect(boosted / plain).toBeCloseTo(1 + townMonumentEffect(getTownMonument('eiffel')!, TOWN_MONUMENT_STAGES).output!)
    })

    it('never counts as a workshop of its tier', () => {
        const eiffel = at('e', 'eiffel', ox, oy + 1, { level: TOWN_MONUMENT_STAGES })
        expect(townReachableTier([eiffel], T0)).toBe(1)
        expect(townTierRequirement([eiffel], 5, T0, { steel: 10_000_000 })?.needsBuilding).toBe(true)
    })

    it('has its own crew: one monument job at a time, and never a builder', () => {
        const job = at('p', 'pyramid', ox + 2, oy + 1, { level: 1, upgradingTo: 2, completesAt: T0 + 60_000 })
        const site = at('h', 'house', ox + 6, oy + 6, { level: 0, completesAt: T0 + 60_000 })
        expect(townBuildersBusy([job, site], T0)).toBe(1)
        expect(townMonumentJob([job, site], T0)?.id).toBe('p')
        expect(townMonumentJob([site], T0)).toBeNull()
    })
})
