import { describe, expect, it } from 'vitest'
import { placeBuilding } from '#server/utils/town'

describe('building orientation validation', () => {
    it.each([-1, 4, 0.5, NaN, Infinity, '1', true])('rejects invalid rotation %s before touching town state', async (rotation) => {
        await expect(placeBuilding('unused', 'unused', 0, 0, 'house', rotation as number)).rejects.toMatchObject({ statusCode: 400 })
    })
})
