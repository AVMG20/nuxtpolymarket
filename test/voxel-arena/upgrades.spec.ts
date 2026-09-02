import { describe, it, expect } from 'vitest'
import { UPGRADES, dealDraft, applyCard, weaponCard, rarityWeights, DRAFT_SIZE } from '../../app/utils/voxel-arena/upgrades'
import { defaultStats, WEAPON_IDS } from '../../app/utils/voxel-arena/data'
import type { WeaponId } from '../../app/utils/voxel-arena/types'

function seeded(seed: number): () => number {
    let s = seed >>> 0
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0
        return s / 4294967296
    }
}

describe('voxel arena upgrade draft', () => {
    it('deals unique cards up to the draft size', () => {
        for (let seed = 1; seed < 40; seed++) {
            const cards = dealDraft({ wave: 4, stacks: new Map(), ownedWeapons: ['pulse'], rng: seeded(seed) })
            expect(cards.length).toBe(DRAFT_SIZE)
            const ids = new Set(cards.map(c => c.id))
            expect(ids.size).toBe(cards.length)
            const keys = new Set(cards.map(c => c.draftKey))
            expect(keys.size).toBe(cards.length)
        }
    })

    it('never offers a weapon the player already owns', () => {
        const owned: WeaponId[] = ['pulse', 'scatter', 'rail']
        for (let seed = 1; seed < 60; seed++) {
            const cards = dealDraft({ wave: 9, stacks: new Map(), ownedWeapons: owned, rng: seeded(seed) })
            for (const c of cards) {
                if (c.kind === 'weapon') expect(owned).not.toContain(c.weaponId)
            }
            expect(cards.filter(c => c.kind === 'weapon').length).toBeLessThanOrEqual(2)
        }
    })

    it('stops offering a card once it hits its stack cap', () => {
        const stacks = new Map<string, number>()
        for (const card of UPGRADES) if (card.maxStacks) stacks.set(card.id, card.maxStacks)
        for (let seed = 1; seed < 40; seed++) {
            const cards = dealDraft({ wave: 6, stacks, ownedWeapons: [...WEAPON_IDS], rng: seeded(seed) })
            for (const c of cards) expect(c.maxStacks).toBeUndefined()
        }
    })

    it('shifts rarity weight toward epics and legendaries on later waves', () => {
        const early = rarityWeights(1)
        const late = rarityWeights(20)
        expect(late.legendary / late.common).toBeGreaterThan(early.legendary / early.common)
        expect(late.epic / late.common).toBeGreaterThan(early.epic / early.common)
    })

    it('applies cards to stats and records the stack', () => {
        const stats = defaultStats()
        const stacks = new Map<string, number>()
        const damage = UPGRADES.find(c => c.id === 'damage')!
        applyCard(damage, stats, stacks)
        applyCard(damage, stats, stacks)
        expect(stats.damageMult).toBeCloseTo(1.18 * 1.18)
        expect(stacks.get('damage')).toBe(2)
    })

    it('every upgrade mutates the stats it describes without touching weapons', () => {
        for (const card of UPGRADES) {
            const stats = defaultStats()
            const before = JSON.stringify(stats)
            card.apply(stats)
            expect(JSON.stringify(stats), card.id).not.toBe(before)
            expect(stats.maxHealth).toBeGreaterThan(0)
        }
    })

    it('builds weapon cards that carry their weapon id', () => {
        const card = weaponCard('plasma')
        expect(card.kind).toBe('weapon')
        expect(card.weaponId).toBe('plasma')
        expect(card.id).toBe('weapon:plasma')
    })
})
