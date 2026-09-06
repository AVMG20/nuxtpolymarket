import { afterAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { townBuildings } from '#server/database/schema'
import { foundTown, placeBuilding, settleTownForRead } from '#server/utils/town'
import { SKIP, cleanupUser, seedUser } from '../setup/db-helpers'

describe('building orientation validation', () => {
    it.each([-1, 4, 0.5, NaN, Infinity, '1', true])('rejects invalid rotation %s before touching town state', async (rotation) => {
        await expect(placeBuilding('unused', 'unused', 0, 0, 'house', rotation as number)).rejects.toMatchObject({ statusCode: 400 })
    })
})

describe.skipIf(SKIP)('saved building orientation', () => {
    const owner = `test-town-rotation-${crypto.randomUUID()}`
    afterAll(() => cleanupUser(owner))

    it('preserves all four orientations after settlement and defaults old callers to zero', async () => {
        await seedUser(owner, { balance: '1000000' })
        const { plotId } = await foundTown(owner)

        // A road along row 3, starting at the plot edge and continuing itself,
        // with one spur up to (4, 4) so a house can face east onto it.
        for (const tileX of [0, 1, 2, 3, 4]) await placeBuilding(owner, plotId, tileX, 3, 'road')
        await placeBuilding(owner, plotId, 4, 4, 'road')

        // Each house sits beside the road and faces it from a different side.
        const houses = [
            { tileX: 0, tileY: 2, rotation: undefined, expected: 0 }, // old caller, defaults to facing +y
            { tileX: 1, tileY: 2, rotation: 0, expected: 0 },
            { tileX: 2, tileY: 4, rotation: 2, expected: 2 },
            { tileX: 3, tileY: 4, rotation: 1, expected: 1 },
            { tileX: 5, tileY: 3, rotation: 3, expected: 3 }
        ]
        for (const house of houses) {
            if (house.rotation === undefined) await placeBuilding(owner, plotId, house.tileX, house.tileY, 'house')
            else await placeBuilding(owner, plotId, house.tileX, house.tileY, 'house', house.rotation)
        }

        const settled = await settleTownForRead(owner)
        const seen = settled.buildings.filter(b => b.type === 'house').sort((a, b) => a.tileX - b.tileX)
        expect(seen.map(b => b.rotation)).toEqual(houses.map(h => h.expected))

        const saved = await db.select().from(townBuildings).where(eq(townBuildings.userId, owner))
        expect(saved.filter(b => b.type === 'house').sort((a, b) => a.tileX - b.tileX).map(b => b.rotation))
            .toEqual(houses.map(h => h.expected))
        // And the sim hands the same rotations back in world coordinates.
        expect(settled.sim.filter(b => b.type === 'house').every(b => b.rotation !== undefined)).toBe(true)
    })
})
