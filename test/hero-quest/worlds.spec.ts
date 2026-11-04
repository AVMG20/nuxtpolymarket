import { describe, expect, it } from 'vitest'
import { WORLDS, getWorld } from '#shared/utils/hero-quest/content/worlds'
import { WORLD_COUNT } from '#shared/utils/hero-quest/constants'

describe('hero-quest worlds', () => {
    it('has unique, stable string IDs', () => {
        expect(new Set(WORLDS.map(world => world.id)).size).toBe(WORLDS.length)
        for (const world of WORLDS) {
            expect(world.id, world.name).toMatch(/^world_[a-z0-9_]+$/)
        }
    })

    it('indexes 1..N in play order, so a reorder cannot silently move a save', () => {
        expect(WORLDS).toHaveLength(WORLD_COUNT)
        WORLDS.forEach((world, position) => {
            expect(world.index).toBe(position + 1)
        })
    })

    it('throws on an out-of-range index rather than returning a wrong world', () => {
        expect(() => getWorld(0)).toThrow()
        expect(() => getWorld(WORLD_COUNT + 1)).toThrow()
    })
})
