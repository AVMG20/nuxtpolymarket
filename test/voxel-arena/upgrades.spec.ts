import { describe, it, expect } from 'vitest'
import { UPGRADES, dealDraft, DRAFT_SIZE } from '../../app/utils/voxel-arena/upgrades'
import { defaultStats, boonPrice } from '../../app/utils/voxel-arena/data'

function seeded(seed: number): () => number {
    let s = seed >>> 0
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0
        return s / 4294967296
    }
}

describe('voxel arena boon draft', () => {
    it('deals a full draft of unique boons', () => {
        for (let seed = 1; seed < 10; seed++) {
            const cards = dealDraft({ wave: 4, stacks: new Map(), ownedAbilities: [], rng: seeded(seed) })
            expect(cards.length).toBe(DRAFT_SIZE)
            const ids = new Set(cards.map(c => c.id))
            expect(ids.size).toBe(cards.length)
            const keys = new Set(cards.map(c => c.draftKey))
            expect(keys.size).toBe(cards.length)
            for (const c of cards) {
                expect(c.kind === 'stat' || c.kind === 'crazy').toBe(true)
                expect(c.cost).toBe(boonPrice(c.rarity, 4))
                expect(c.owned).toBe(0)
            }
        }
    })

    it('stops offering a card once it hits its stack cap', () => {
        const stacks = new Map<string, number>()
        for (const card of UPGRADES) if (card.maxStacks) stacks.set(card.id, card.maxStacks)
        for (let seed = 1; seed < 10; seed++) {
            const cards = dealDraft({ wave: 6, stacks, ownedAbilities: ['nova', 'sentry'], rng: seeded(seed) })
            for (const c of cards) expect(c.maxStacks).toBeUndefined()
        }
    })

    it('reports how many copies the player already holds', () => {
        const stacks = new Map<string, number>([['damage', 2]])
        let seen = false
        for (let seed = 1; seed < 200 && !seen; seed++) {
            const cards = dealDraft({ wave: 3, stacks, ownedAbilities: [], rng: seeded(seed) })
            const dmg = cards.find(c => c.id === 'damage')
            if (dmg) {
                expect(dmg.owned).toBe(2)
                seen = true
            }
        }
        expect(seen).toBe(true)
    })

    it('every upgrade mutates the stats it describes', () => {
        for (const card of UPGRADES) {
            const stats = defaultStats()
            const before = JSON.stringify(stats)
            card.apply(stats)
            expect(JSON.stringify(stats), card.id).not.toBe(before)
            expect(stats.maxHealth).toBeGreaterThan(0)
        }
    })

    it('has unique ids and never offers locked ability upgrades', () => {
        expect(new Set(UPGRADES.map(c => c.id)).size).toBe(UPGRADES.length)
        for (let seed = 1; seed < 20; seed++) {
            const cards = dealDraft({ wave: 3, stacks: new Map(), ownedAbilities: ['nova'], rng: seeded(seed) })
            for (const c of cards) if (c.requiresAbility) expect(c.requiresAbility).toBe('nova')
        }
        const none = dealDraft({ wave: 3, stacks: new Map(), ownedAbilities: [], rng: seeded(7) })
        expect(none.some(c => c.requiresAbility)).toBe(false)
    })
})
