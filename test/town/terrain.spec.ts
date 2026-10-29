import { describe, expect, it } from 'vitest'
import {
    TOWN_PLOT_SIZE,
    TOWN_TERRAIN_BONUS,
    TOWN_TICK_MS,
    TOWN_TILES_PER_PLOT,
    deriveTown,
    getTownBuilding,
    settleTown,
    townPlacementIssue,
    townPlotTerrain,
    townTerrainAt,
    type TownSimBuilding,
    type TownTerrainId
} from '#shared/utils/gamelogic/town'

const T0 = 1_700_000_000_000

const CHAR: Record<TownTerrainId, string> = { plain: '.', water: 'W', rock: 'R', forest: 'F', fertile: 'G' }

/** A plot drawn as eight strings, one per row — readable enough to assert on. */
function draw(px: number, py: number): string[] {
    const tiles = townPlotTerrain(px, py)
    return Array.from({ length: TOWN_PLOT_SIZE }, (_, ty) =>
        Array.from({ length: TOWN_PLOT_SIZE }, (_, tx) => CHAR[tiles[ty * TOWN_PLOT_SIZE + tx]!]).join(''))
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
})

describe('building on terrain', () => {
    const road = getTownBuilding('road')!
    const farm = getTownBuilding('farm')!

    it('refuses water to everything, roads included', () => {
        const water = findTile('water')
        expect(townPlacementIssue([], road, water.wx, water.wy, 0)).toMatch(/water/)
        expect(townPlacementIssue([], farm, water.wx, water.wy, 0)).toMatch(/water/)
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
