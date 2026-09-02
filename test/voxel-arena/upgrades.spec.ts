import { describe, it, expect } from 'vitest'
import { UPGRADES, dealDraft, applyCard, weaponCard, abilityCard, rarityWeights, DRAFT_SIZE } from '../../app/utils/voxel-arena/upgrades'
import { defaultStats, WEAPON_IDS, ABILITY_IDS, cardCost, rerollCost, shardValue, ENEMIES } from '../../app/utils/voxel-arena/data'
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
            const cards = dealDraft({ wave: 4, stacks: new Map(), ownedWeapons: ['pistol'], ownedAbilities: [], ownedMelee: 'sword', rng: seeded(seed) })
            expect(cards.length).toBe(DRAFT_SIZE)
            const ids = new Set(cards.map(c => c.id))
            expect(ids.size).toBe(cards.length)
            const keys = new Set(cards.map(c => c.draftKey))
            expect(keys.size).toBe(cards.length)
        }
    })

    it('never offers a weapon the player already owns', () => {
        const owned: WeaponId[] = ['pistol', 'shotgun', 'sniper']
        for (let seed = 1; seed < 60; seed++) {
            const cards = dealDraft({ wave: 9, stacks: new Map(), ownedWeapons: owned, ownedAbilities: ['nova'], ownedMelee: 'sword', rng: seeded(seed) })
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
            const cards = dealDraft({ wave: 6, stacks, ownedWeapons: [...WEAPON_IDS], ownedAbilities: [...ABILITY_IDS], ownedMelee: 'sword', rng: seeded(seed) })
            for (const c of cards) if (c.kind !== 'melee') expect(c.maxStacks).toBeUndefined()
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

    it('prices cards by rarity and wave, and never offers owned abilities or locked ability upgrades', () => {
        expect(cardCost('common', 'stat', 1)).toBe(30)
        expect(cardCost('legendary', 'crazy', 1)).toBe(120)
        expect(cardCost('common', 'stat', 6)).toBeGreaterThan(cardCost('common', 'stat', 1))
        expect(rerollCost(1)).toBe(25)
        expect(rerollCost(1)).toBeLessThan(cardCost('rare', 'stat', 1))
        for (let seed = 1; seed < 60; seed++) {
            const cards = dealDraft({ wave: 3, stacks: new Map(), ownedWeapons: ['pistol'], ownedAbilities: ['nova'], ownedMelee: 'sword', rng: seeded(seed) })
            for (const c of cards) {
                expect(c.cost).toBeGreaterThan(0)
                if (c.kind === 'ability') expect(c.abilityId).not.toBe('nova')
                if (c.requiresAbility) expect(c.requiresAbility).toBe('nova')
            }
        }
        const none = dealDraft({ wave: 3, stacks: new Map(), ownedWeapons: ['pistol'], ownedAbilities: [], ownedMelee: 'sword', rng: seeded(7) })
        expect(none.some(c => c.requiresAbility)).toBe(false)
        expect(abilityCard('blink').abilityId).toBe('blink')
    })

    it('values kills in shards by score, boosted for elites', () => {
        expect(shardValue(ENEMIES.grunt, null)).toBe(5)
        expect(shardValue(ENEMIES.grunt, 'swift')).toBeGreaterThan(5)
        expect(shardValue(ENEMIES.brute, 'gilded')).toBe(80)
    })

    it('never offers the blade already in hand', () => {
        for (let seed = 1; seed < 80; seed++) {
            const cards = dealDraft({ wave: 5, stacks: new Map(), ownedWeapons: ['pistol'], ownedAbilities: [], ownedMelee: 'axe', rng: seeded(seed) })
            for (const c of cards) if (c.kind === 'melee') expect(c.meleeId).not.toBe('axe')
            expect(cards.filter(c => c.kind === 'melee').length).toBeLessThanOrEqual(1)
        }
    })

    it('builds weapon cards that carry their weapon id', () => {
        const card = weaponCard('raygun')
        expect(card.kind).toBe('weapon')
        expect(card.weaponId).toBe('raygun')
        expect(card.id).toBe('weapon:raygun')
    })
})
