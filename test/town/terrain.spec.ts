import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { townPlots } from '#server/database/schema'
import { foundTown } from '#server/utils/town'
import {
    TOWN_PLOT_SIZE,
    TOWN_TERRAINS,
    TOWN_TERRAIN_BONUS,
    TOWN_TERRAIN_IDS,
    TOWN_TICK_MS,
    TOWN_TILES_PER_PLOT,
    deriveTown,
    getTownBuilding,
    getTownTerrain,
    settleTown,
    townPlacementIssue,
    townPlotIsFlat,
    townPlotTerrain,
    townTerrainAt,
    townTerrainMultiplier,
    type TownBuildingId,
    type TownSimBuilding,
    type TownTerrainId
} from '#shared/utils/gamelogic/town'
import { SKIP, cleanupUser, lockTownRealm, seedUser } from '../setup/db-helpers'

const T0 = 1_700_000_000_000

const CHAR: Record<TownTerrainId, string> = { plain: '.', water: 'W', rock: 'R', forest: 'F', fertile: 'G' }

/** A plot drawn as eight strings, one per row — readable enough to assert on. */
function draw(px: number, py: number): string[] {
    const tiles = townPlotTerrain(px, py)
    return Array.from({ length: TOWN_PLOT_SIZE }, (_, ty) =>
        Array.from({ length: TOWN_PLOT_SIZE }, (_, tx) => CHAR[tiles[ty * TOWN_PLOT_SIZE + tx]!]).join(''))
}

function countTerrain(px: number, py: number): Record<TownTerrainId, number> {
    const counts = Object.fromEntries(TOWN_TERRAIN_IDS.map(id => [id, 0])) as Record<TownTerrainId, number>
    for (const id of townPlotTerrain(px, py)) counts[id]++
    return counts
}

/** Every plot in a square of the realm, flat grassland included. */
function plotsAround(radius: number): { x: number, y: number }[] {
    const out: { x: number, y: number }[] = []
    for (let x = -radius; x <= radius; x++) for (let y = -radius; y <= radius; y++) out.push({ x, y })
    return out
}

/** The first world tile of the given terrain, searched outward from the origin. */
function findTile(terrain: TownTerrainId): { wx: number, wy: number } {
    for (const plot of plotsAround(6)) {
        for (let ty = 0; ty < TOWN_PLOT_SIZE; ty++) {
            for (let tx = 0; tx < TOWN_PLOT_SIZE; tx++) {
                const wx = plot.x * TOWN_PLOT_SIZE + tx
                const wy = plot.y * TOWN_PLOT_SIZE + ty
                if (townTerrainAt(wx, wy) === terrain) return { wx, wy }
            }
        }
    }
    throw new Error(`no ${terrain} tile anywhere near the origin`)
}

describe('terrain generation', () => {
    it('gives the same plot the same ground every time it is asked', () => {
        // Pinned by hand: terrain has to survive a reload, a second client and
        // a server restart, so a change to the generator is a change to the
        // world and should have to be made on purpose.
        expect(draw(0, 0)).toEqual([
            'WWFFFFWW',
            'GG...FFF',
            'GG......',
            '........',
            'R..G....',
            'R..GG...',
            'RR.G....',
            '.RRR....'
        ])
        expect(draw(-3, 5)).toEqual([
            '.....FFF',
            'R....G.F',
            '.......W',
            '..G.....',
            '........',
            'G..RF...',
            'GG.RRF..',
            'GGGG....'
        ])
    })

    it('agrees with itself tile by tile, whichever way it is asked', () => {
        for (const plot of plotsAround(3)) {
            const tiles = townPlotTerrain(plot.x, plot.y)
            expect(tiles).toHaveLength(TOWN_TILES_PER_PLOT)
            for (let ty = 0; ty < TOWN_PLOT_SIZE; ty++) {
                for (let tx = 0; tx < TOWN_PLOT_SIZE; tx++) {
                    expect(townTerrainAt(plot.x * TOWN_PLOT_SIZE + tx, plot.y * TOWN_PLOT_SIZE + ty))
                        .toBe(tiles[ty * TOWN_PLOT_SIZE + tx])
                }
            }
        }
    })

    it('leaves most of a plot ordinary ground', () => {
        const plots = plotsAround(12)
        const plain = plots.reduce((sum, p) => sum + countTerrain(p.x, p.y).plain, 0)
        const share = plain / (plots.length * TOWN_TILES_PER_PLOT)
        expect(share).toBeGreaterThan(0.6)
        expect(share).toBeLessThan(0.72)
    })

    it('gives every plot that is not flat grassland its promised share of each terrain', () => {
        for (const plot of plotsAround(12)) {
            if (townPlotIsFlat(plot.x, plot.y)) continue
            const counts = countTerrain(plot.x, plot.y)
            for (const def of TOWN_TERRAINS) {
                if (def.tilesPerPlot.max <= 0) continue
                expect(counts[def.id]).toBeGreaterThanOrEqual(def.tilesPerPlot.min)
                expect(counts[def.id]).toBeLessThanOrEqual(def.tilesPerPlot.max)
            }
        }
    })

    it('keeps flat grassland completely plain, and rare', () => {
        const plots = plotsAround(20)
        const flat = plots.filter(p => townPlotIsFlat(p.x, p.y))
        expect(flat.length).toBeGreaterThan(0)
        expect(flat.length / plots.length).toBeLessThan(0.12)
        for (const plot of flat) {
            expect(countTerrain(plot.x, plot.y).plain).toBe(TOWN_TILES_PER_PLOT)
        }
    })
})

describe('what terrain is worth', () => {
    it('pays a quarter more to the buildings that suit the ground, and nothing to the rest', () => {
        for (const def of TOWN_TERRAINS) {
            const tile = def.tilesPerPlot.max > 0 || def.id === 'plain' ? findTile(def.id) : null
            if (!tile) continue
            for (const building of ['farm', 'lumber', 'quarry', 'mine', 'bakery'] as TownBuildingId[]) {
                expect(townTerrainMultiplier(building, tile.wx, tile.wy))
                    .toBe(def.boosts.includes(building) ? 1 + TOWN_TERRAIN_BONUS : 1)
            }
        }
    })

    it('pays nothing to a building that is not standing anywhere in particular', () => {
        expect(townTerrainMultiplier('farm')).toBe(1)
        expect(townTerrainMultiplier('farm', 3)).toBe(1)
    })

    it('boosts exactly the raw industries the terrain is named for', () => {
        expect(getTownTerrain('fertile').boosts).toEqual(['farm'])
        expect(getTownTerrain('forest').boosts).toEqual(['lumber'])
        expect(getTownTerrain('rock').boosts).toEqual(['quarry', 'mine'])
        expect(getTownTerrain('plain').boosts).toEqual([])
        expect(getTownTerrain('water').boosts).toEqual([])
    })
})

describe('building on terrain', () => {
    const road = getTownBuilding('road')!
    const farm = getTownBuilding('farm')!

    it('refuses water to everything, roads included', () => {
        const water = findTile('water')
        expect(townPlacementIssue([], road, water.wx, water.wy, 0)).toMatch(/water/)
        expect(townPlacementIssue([], farm, water.wx, water.wy, 0)).toMatch(/water/)
    })

    it('lets the same building onto the tile next door when that one is dry', () => {
        const water = findTile('water')
        // Somewhere dry on the same plot, with a road at its front door.
        const dry = townPlotTerrain(Math.floor(water.wx / TOWN_PLOT_SIZE), Math.floor(water.wy / TOWN_PLOT_SIZE))
            .findIndex(t => t !== 'water')
        const px = Math.floor(water.wx / TOWN_PLOT_SIZE) * TOWN_PLOT_SIZE
        const py = Math.floor(water.wy / TOWN_PLOT_SIZE) * TOWN_PLOT_SIZE
        const wx = px + (dry % TOWN_PLOT_SIZE)
        const wy = py + Math.floor(dry / TOWN_PLOT_SIZE)

        expect(townTerrainAt(wx, wy)).not.toBe('water')
        const street: TownSimBuilding[] = [{
            id: 'road', type: 'road', level: 1, completesAt: T0 - 1, upgradingTo: null,
            createdAt: T0 - 1, wx, wy: wy + 1
        }]
        expect(townPlacementIssue(street, farm, wx, wy, 0)).toBeNull()
    })

    it('never walls a plot in — there is always room to build', () => {
        for (const plot of plotsAround(12)) {
            const dry = townPlotTerrain(plot.x, plot.y).filter(t => t !== 'water').length
            expect(dry).toBeGreaterThanOrEqual(TOWN_TILES_PER_PLOT - getTownTerrain('water').tilesPerPlot.max)
        }
    })
})

/**
 * One lumber camp at `level` with a street of houses to staff it. Wood is
 * nothing the townsfolk eat, so the settle's delta is the camp's own output
 * and nothing else.
 */
function campTown(wx: number, wy: number, level: number): TownSimBuilding[] {
    const base = { level: 1, completesAt: T0 - 60_000, upgradingTo: null, createdAt: T0 - 60_000 }
    const buildings: TownSimBuilding[] = [
        { ...base, id: 'camp', type: 'lumber', level, wx, wy, rotation: 2 }
    ]
    for (let i = 0; i < 6; i++) {
        buildings.push({ ...base, id: `road${i}`, type: 'road', wx: wx - 2 + i, wy: wy - 1 })
        if (i < 4) buildings.push({ ...base, id: `house${i}`, type: 'house', level: 2, wx: wx - 2 + i, wy: wy - 2, rotation: 0 })
    }
    return buildings
}

describe('terrain through a settle', () => {
    const TICKS = 6
    const LEVEL = 4

    function settleCamp(wx: number, wy: number) {
        return settleTown({
            happiness: 50,
            tickProgressMs: 0,
            lastSettledAt: T0,
            inventory: {},
            buildings: campTown(wx, wy, LEVEL)
        }, T0 + TICKS * TOWN_TICK_MS)
    }

    it('fells a quarter more timber in woodland than on plain grass', () => {
        const felled = settleCamp(findTile('forest').wx, findTile('forest').wy)
        const flat = settleCamp(findTile('plain').wx, findTile('plain').wy)

        // Identical layouts, so the two towns are equally happy and run for the
        // same number of ticks. Only the ground under the camp differs.
        expect(felled.ticks).toBe(flat.ticks)
        expect(flat.ticks).toBeGreaterThan(0)
        expect(flat.delta.wood).toBe(LEVEL * flat.ticks)
        expect(felled.delta.wood).toBe(Math.floor(LEVEL * (1 + TOWN_TERRAIN_BONUS)) * felled.ticks)
    })

    it('quotes the same rate through deriveTown as the settle actually pays', () => {
        const forest = findTile('forest')
        const derived = deriveTown(campTown(forest.wx, forest.wy, LEVEL), 50, T0)

        expect(derived.staffing.get('camp')).toBe(1)
        expect(derived.throughput.get('camp')).toBe(1 + TOWN_TERRAIN_BONUS)
    })
})

describe.skipIf(SKIP)('the plot a town is founded on (database)', () => {
    const owner = `test-town-terrain-${crypto.randomUUID()}`
    // One shared realm: hold it for this file so a sibling spec cannot plant
    // or delete plots midway through a test here (db-helpers, lockTownRealm).
    let releaseRealm: () => Promise<void>
    beforeAll(async () => { releaseRealm = await lockTownRealm() }, 120_000)

    afterAll(async () => {
        await db.delete(townPlots).where(eq(townPlots.userId, owner))
        await cleanupUser(owner)
        await releaseRealm()
    })

    it('always has something of every terrain on it, and room to build', async () => {
        await seedUser(owner)
        const { plotId } = await foundTown(owner)
        const plot = (await db.select().from(townPlots).where(eq(townPlots.id, plotId)))[0]!

        expect(townPlotIsFlat(plot.x, plot.y)).toBe(false)
        const counts = countTerrain(plot.x, plot.y)
        for (const def of TOWN_TERRAINS) {
            if (def.tilesPerPlot.max <= 0) continue
            expect(counts[def.id]).toBeGreaterThanOrEqual(def.tilesPerPlot.min)
        }
        expect(counts.water).toBeLessThanOrEqual(getTownTerrain('water').tilesPerPlot.max)
        expect(TOWN_TILES_PER_PLOT - counts.water).toBeGreaterThanOrEqual(60)
    })
})
