import { describe, expect, it } from 'vitest'
import { UPGRADES, rollOffers } from '../../app/utils/meadowbrawl/upgrades'

function seeded(seed: number) {
    let s = seed
    return () => {
        s = (s * 1664525 + 1013904223) % 4294967296
        return s / 4294967296
    }
}

describe('upgrade offers', () => {
    it('rolls three distinct offers', () => {
        for (let i = 0; i < 50; i++) {
            const offers = rollOffers(1 + (i % 20), new Map(), seeded(i + 1))
            expect(offers).toHaveLength(3)
            expect(new Set(offers.map(o => o.upgrade.id)).size).toBe(3)
        }
    })

    it('never offers a maxed upgrade', () => {
        const stacks = new Map<string, number>()
        for (const u of UPGRADES) stacks.set(u.id, u.maxStacks)
        stacks.set('might', 2)
        for (let i = 0; i < 100; i++) {
            const offers = rollOffers(6, stacks, seeded(i + 7))
            expect(offers).toHaveLength(1)
            expect(offers[0]!.upgrade.id).toBe('might')
            expect(offers[0]!.stack).toBe(3)
        }
    })

    it('never offers weapons — those are chosen on the start screen', () => {
        for (let i = 0; i < 300; i++) {
            for (const o of rollOffers(5, new Map(), seeded(i + 11))) {
                expect(o.weapon).toBeUndefined()
                expect(o.upgrade.rarity).not.toBe('weapon')
            }
        }
    })

    it('leans toward rare and epic boons in the first three waves', () => {
        let earlyStrong = 0
        let lateStrong = 0
        const n = 400
        for (let i = 0; i < n; i++) {
            for (const o of rollOffers(2, new Map(), seeded(i + 1))) if (o.upgrade.rarity === 'rare' || o.upgrade.rarity === 'epic') earlyStrong++
            for (const o of rollOffers(12, new Map(), seeded(i + 1))) if (o.upgrade.rarity === 'rare' || o.upgrade.rarity === 'epic') lateStrong++
        }
        expect(earlyStrong).toBeGreaterThan(lateStrong)
    })
})
