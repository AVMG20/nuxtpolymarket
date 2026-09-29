import { describe, expect, it } from 'vitest'
import {
    deriveTown,
    getTownBuilding,
    townBuildersBusy,
    townBuildingsFronting,
    townDistricts,
    townFrontTiles,
    townGroupMoveIssue,
    townLevelBuildMs,
    townLevelCost,
    townMonumentBonus,
    townMonumentJob,
    townPlacementIssue,
    townPlotIsFlat,
    townReachableTier,
    townSpiralCoords,
    townRoadAccess,
    townTierRequirement,
    TOWN_MAX_BUILD_MS,
    TOWN_NO_BONUS,
    type TownBuildingId,
    type TownSimBuilding
} from '#shared/utils/gamelogic/town'
import {
    TOWN_MONUMENTS,
    TOWN_MONUMENT_STAGES,
    getTownMonument,
    townBonusLines,
    townMonumentEffect,
    townMonumentStageCost,
    townMonumentStageMs
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

describe('monument rules', () => {
    it('gives a little more than the research board did at the top', () => {
        const full = Object.fromEntries(TOWN_MONUMENTS.map(m => [m.id, townMonumentEffect(m, TOWN_MONUMENT_STAGES)]))
        // Workshop output is split the way research split it: mostly the tower,
        // a little from the arch and the lighthouse. Research gave 45% in all.
        expect(full.eiffel!.output! + full.arc!.output! + full.lighthouse!.output!).toBeCloseTo(0.5)
        expect(full.arc!.supplyTiles).toBe(9)
        expect(full.pyramid!.buildTime).toBeCloseTo(0.38)
        expect(full.colosseum!.happiness).toBe(18)
        expect(full.colosseum!.popPerHouseLevel).toBe(1)
        expect(full.lighthouse!.storage).toBeCloseTo(1.9)
        for (const m of TOWN_MONUMENTS) {
            expect(m.stages).toHaveLength(TOWN_MONUMENT_STAGES)
            expect(townMonumentEffect(m, 0)).toEqual({})
        }
    })

    it('gives, stage for stage, exactly what the research branch it replaced gave', () => {
        // The retired board, project by project. A mayor credited stage N of a
        // monument for N finished projects must not lose a single point.
        const research: Record<string, Partial<Record<keyof typeof TOWN_NO_BONUS, number>>[]> = {
            yield: [0.04, 0.05, 0.05, 0.06, 0.06, 0.08].map(output => ({ output })),
            logistics: [{ supplyTiles: 1 }, { supplyTiles: 1 }, { supplyTiles: 1, output: 0.03 }, { supplyTiles: 1 }, { supplyTiles: 1, output: 0.03 }, { supplyTiles: 2 }],
            construction: [0.04, 0.05, 0.05, 0.06, 0.06, 0.08].map(buildTime => ({ buildTime })),
            civics: [{ happiness: 2 }, { happiness: 3 }, { popPerHouseLevel: 1 }, { happiness: 3 }, { happiness: 4 }, { happiness: 4 }],
            trade: [{ storage: 0.15 }, { storage: 0.2 }, { storage: 0.25, output: 0.02 }, { storage: 0.3 }, { storage: 0.35, output: 0.03 }, { storage: 0.45 }]
        }
        for (const m of TOWN_MONUMENTS) {
            const steps = research[m.branch]!
            for (let n = 1; n <= steps.length; n++) {
                const had: Record<string, number> = {}
                for (const step of steps.slice(0, n)) for (const [k, v] of Object.entries(step)) had[k] = (had[k] ?? 0) + v
                const gets = townMonumentEffect(m, n)
                for (const [k, v] of Object.entries(had)) expect(gets[k as keyof typeof gets]).toBeCloseTo(v)
            }
        }
    })

    it('costs more coins and longer clocks at every stage', () => {
        for (const m of TOWN_MONUMENTS) {
            for (let stage = 2; stage <= TOWN_MONUMENT_STAGES; stage++) {
                expect(townMonumentStageCost(m, stage).coins).toBeGreaterThan(townMonumentStageCost(m, stage - 1).coins)
                expect(townMonumentStageMs(stage)).toBeGreaterThanOrEqual(townMonumentStageMs(stage - 1))
            }
            expect(townLevelCost(getTownBuilding(m.id)!, 3)).toEqual(townMonumentStageCost(m, 3))
        }
    })

    it('keeps the late stages at the three-day wall, not their tier\'s', () => {
        const pyramid = getTownBuilding('pyramid')!
        expect(townLevelBuildMs(pyramid, TOWN_MONUMENT_STAGES)).toBe(TOWN_MAX_BUILD_MS)
        expect(townLevelBuildMs(pyramid, 1)).toBe(townMonumentStageMs(1))
    })

    it('says a bonus in words', () => {
        expect(townBonusLines({ output: 0.15, buildTime: 0.08, supplyTiles: 1 })).toEqual(['+15% workshop output', '−8% build time', '+1 full-rate supply tiles'])
        expect(townBonusLines(TOWN_NO_BONUS)).toEqual([])
    })
})

describe('monument footprints', () => {
    const pyramid = getTownBuilding('pyramid')!
    const ox = PX * 8
    const oy = PY * 8

    it('fronts onto the whole row of tiles along its front edge', () => {
        expect(townFrontTiles(0, 0, 0, 3)).toEqual([{ wx: 0, wy: 3 }, { wx: 1, wy: 3 }, { wx: 2, wy: 3 }])
        expect(townFrontTiles(0, 0, 1, 2)).toEqual([{ wx: 2, wy: 0 }, { wx: 2, wy: 1 }])
        expect(townFrontTiles(0, 0, 2, 2)).toEqual([{ wx: 0, wy: -1 }, { wx: 1, wy: -1 }])
        expect(townFrontTiles(0, 0, 3, 1)).toEqual([{ wx: -1, wy: 0 }])
    })

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

    it('joins the road network along its front', () => {
        const standing = at('p', 'pyramid', ox + 2, oy + 1, { rotation: 2 })
        const districts = townDistricts([standing, road(ox + 4, oy), road(ox + 5, oy)])
        expect(districts.get('p')).toBe(districts.get(`road-${ox + 4}-${oy}`))
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
        expect(townMonumentBonus([eiffel({ level: 3 }), road(ox, oy)], T0).output).toBeCloseTo(0.14)
        expect(townMonumentBonus([eiffel({ level: 3 })], T0).output).toBe(0)
        // A stage going up gives nothing until it is done.
        expect(townMonumentBonus([eiffel({ level: 3, upgradingTo: 4, completesAt: T0 + 1 }), road(ox, oy)], T0).output).toBeCloseTo(0.14)
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

    it('knows every monument by id', () => {
        for (const m of TOWN_MONUMENTS) expect(getTownMonument(m.id)).toBe(m)
        expect(getTownMonument('house')).toBeUndefined()
    })
})
