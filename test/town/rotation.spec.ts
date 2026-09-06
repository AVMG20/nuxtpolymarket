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
        for (const rotation of [0, 1, 2, 3]) {
            await placeBuilding(owner, plotId, rotation, 0, 'house', rotation)
        }
        await placeBuilding(owner, plotId, 4, 0, 'house')
        const settled = await settleTownForRead(owner)
        expect(settled.buildings.sort((a, b) => a.tileX - b.tileX).map(b => b.rotation)).toEqual([0, 1, 2, 3, 0])
        const saved = await db.select().from(townBuildings).where(eq(townBuildings.userId, owner))
        expect(saved.sort((a, b) => a.tileX - b.tileX).map(b => b.rotation)).toEqual([0, 1, 2, 3, 0])
    })
})
