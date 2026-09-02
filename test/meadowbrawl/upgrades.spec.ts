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
            const offers = rollOffers(1 + (i % 20), new Map(), 'sword', seeded(i + 1))
            expect(offers).toHaveLength(3)
            expect(new Set(offers.map(o => o.upgrade.id)).size).toBe(3)
        }
    })

    it('never offers the equipped weapon or a maxed upgrade', () => {
        const stacks = new Map<string, number>()
        for (const u of UPGRADES) stacks.set(u.id, u.maxStacks)
        stacks.set('might', 2)
        for (let i = 0; i < 100; i++) {
            const offers = rollOffers(6, stacks, 'greataxe', seeded(i + 7))
            for (const o of offers) {
                expect(o.weapon).not.toBe('greataxe')
                if (!o.weapon) {
                    expect(o.upgrade.id).toBe('might')
                    expect(o.stack).toBe(3)
                }
            }
        }
    })

    it('marks weapon swaps as their own rarity', () => {
        let sawWeapon = false
        for (let i = 0; i < 300 && !sawWeapon; i++) {
            for (const o of rollOffers(5, new Map(), 'spear', seeded(i + 11))) {
                if (o.weapon) {
                    sawWeapon = true
                    expect(o.upgrade.rarity).toBe('weapon')
                    expect(o.upgrade.id).toBe(`weapon:${o.weapon}`)
                }
            }
        }
        expect(sawWeapon).toBe(true)
    })

    it('leans toward rare and epic boons in the first three waves', () => {
        let earlyStrong = 0
        let lateStrong = 0
        const n = 400
        for (let i = 0; i < n; i++) {
            for (const o of rollOffers(2, new Map(), 'sword', seeded(i + 1))) if (o.upgrade.rarity === 'rare' || o.upgrade.rarity === 'epic') earlyStrong++
            for (const o of rollOffers(12, new Map(), 'sword', seeded(i + 1))) if (o.upgrade.rarity === 'rare' || o.upgrade.rarity === 'epic') lateStrong++
        }
        expect(earlyStrong).toBeGreaterThan(lateStrong)
    })
})
