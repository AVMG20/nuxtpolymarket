import { describe, expect, it } from 'vitest'
import { LEGACY_UPGRADE_IDS, LEGENDARY_CAP, UPGRADES, UPGRADE_BY_ID, elementStacks, resolveUpgradeId, rollOffers, tierWeights } from '../../app/utils/meadowbrawl/upgrades'

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

    it('rolls the tier first, so odds follow the weights and not the pool size', () => {
        const n = 3000
        const seen: Record<string, number> = { common: 0, rare: 0, epic: 0, legendary: 0 }
        for (let i = 0; i < n; i++) {
            for (const o of rollOffers(8, new Map(), seeded(i + 3))) seen[o.upgrade.rarity]!++
        }
        const total = n * 3
        const w = tierWeights(8, 0)
        const sum = w.common + w.rare + w.epic + w.legendary
        expect(seen.common! / total).toBeCloseTo(w.common / sum, 1)
        expect(seen.rare! / total).toBeCloseTo(w.rare / sum, 1)
        expect(seen.epic! / total).toBeCloseTo(w.epic / sum, 1)
        expect(seen.legendary! / total).toBeLessThan(0.04)
    })

    it('never deals a legendary before wave 6, and never a third one', () => {
        for (let i = 0; i < 300; i++) {
            for (const o of rollOffers(5, new Map(), seeded(i + 1))) expect(o.upgrade.rarity).not.toBe('legendary')
        }
        const stacks = new Map<string, number>([['avatar', 1], ['eclipse', 1]])
        expect(LEGENDARY_CAP).toBe(2)
        for (let i = 0; i < 300; i++) {
            for (const o of rollOffers(20, stacks, seeded(i + 1))) expect(o.upgrade.rarity).not.toBe('legendary')
        }
    })

    it('owes no run a legend: deep waves without one are still a roll', () => {
        let dealt = 0
        for (let i = 0; i < 400; i++) {
            if (rollOffers(15, new Map(), seeded(i + 1)).some(o => o.upgrade.rarity === 'legendary')) dealt++
        }
        expect(dealt).toBeGreaterThan(0)
        expect(dealt / 400).toBeLessThan(0.2)
    })

    it('only deals Mending to the wounded, and Fortune adds a fourth card', () => {
        for (let i = 0; i < 200; i++) {
            expect(rollOffers(4, new Map(), seeded(i), { hpFrac: 1 }).some(o => o.upgrade.id === 'mending')).toBe(false)
        }
        let dealt = 0
        for (let i = 0; i < 200; i++) {
            if (rollOffers(4, new Map(), seeded(i), { hpFrac: 0.3 }).some(o => o.upgrade.id === 'mending')) dealt++
        }
        expect(dealt).toBeGreaterThan(0)
        const four = rollOffers(4, new Map(), seeded(9), { count: 4 })
        expect(four).toHaveLength(4)
        expect(new Set(four.map(o => o.upgrade.id)).size).toBe(4)
    })

    it('maps merged boons from old checkpoints onto their successors', () => {
        for (const [old, next] of Object.entries(LEGACY_UPGRADE_IDS)) {
            expect(UPGRADE_BY_ID[old]).toBeUndefined()
            expect(resolveUpgradeId(old)).toBe(next)
            if (next) expect(UPGRADE_BY_ID[next]).toBeDefined()
        }
        expect(resolveUpgradeId('might')).toBe('might')
        expect(resolveUpgradeId('nonsense')).toBeNull()
    })

    it('keeps every boon one line long, and every school stacks', () => {
        for (const u of UPGRADES) {
            expect(u.description.length, u.id).toBeLessThanOrEqual(64)
            expect(['stat', 'effect', 'pact']).toContain(u.kind)
            if (u.kind === 'pact') expect(u.catch, u.id).toBeTruthy()
        }
        const stacks = new Map<string, number>([['burn', 3], ['explode', 1], ['freeze', 2], ['might', 4]])
        expect(elementStacks(stacks, 'fire')).toBe(4)
        expect(elementStacks(stacks, 'ice')).toBe(2)
        expect(elementStacks(stacks, 'shock')).toBe(0)
    })
})
