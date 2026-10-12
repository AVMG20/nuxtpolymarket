import { describe, it, expect } from 'vitest'
import { ABILITIES, ABILITY_IDS, ABILITY_SLOTS, ECONOMY, defaultStats, planWave, waveEvent, boonPrice, waveIncome } from '../../app/utils/voxel-arena/data'
import { UPGRADES, UPGRADE_BY_ID, dealDraft, applyCard } from '../../app/utils/voxel-arena/upgrades'
import type { AbilityId } from '../../app/utils/voxel-arena/types'

function seeded(seed: number): () => number {
    let s = seed >>> 0
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0
        return s / 4294967296
    }
}

const NEW_ABILITIES: AbilityId[] = ['gravity', 'decoy', 'overcharge']

describe('voxel arena abilities', () => {
    it('defines every ability with a cost the energy bar can pay', () => {
        for (const id of ABILITY_IDS) {
            const def = ABILITIES[id]
            expect(def.id).toBe(id)
            expect(def.energy).toBeGreaterThanOrEqual(20)
            expect(def.energy).toBeLessThanOrEqual(defaultStats().energyMax)
            expect(def.icon.startsWith('i-lucide-')).toBe(true)
            expect(def.color).toMatch(/^#[0-9a-f]{6}$/i)
            expect(def.description.length).toBeGreaterThan(20)
        }
        expect(new Set(ABILITY_IDS.map(id => ABILITIES[id].name)).size).toBe(ABILITY_IDS.length)
        expect(new Set(ABILITY_IDS.map(id => ABILITIES[id].color)).size).toBe(ABILITY_IDS.length)
    })

    it('adds the singularity, decoy and overcharge abilities', () => {
        for (const id of NEW_ABILITIES) expect(ABILITY_IDS).toContain(id)
        expect(ABILITY_SLOTS).toBe(2)
    })

    it('prices an ability below a few waves of income', () => {
        expect(ECONOMY.abilityPrice).toBeLessThanOrEqual(waveIncome(1))
    })

    it('starts every new ability stat at zero', () => {
        const stats = defaultStats()
        for (const key of ['well', 'decoy', 'overcharge', 'cascade', 'castRush', 'critChain'] as const) expect(stats[key], key).toBe(0)
    })
})

describe('voxel arena ability boons', () => {
    const gated: [string, AbilityId][] = [['wellcore', 'gravity'], ['decoycore', 'decoy'], ['teslacoil', 'overcharge']]

    it('gates each ability upgrade behind its ability', () => {
        for (const [id, ability] of gated) {
            expect(UPGRADE_BY_ID.get(id)?.requiresAbility, id).toBe(ability)
            let seen = false
            for (let seed = 1; seed < 400; seed++) {
                const without = dealDraft({ wave: 6, stacks: new Map(), ownedAbilities: ['nova'], rng: seeded(seed) })
                expect(without.some(c => c.id === id), `${id} without ${ability}`).toBe(false)
                const withIt = dealDraft({ wave: 6, stacks: new Map(), ownedAbilities: [ability], rng: seeded(seed) })
                if (withIt.some(c => c.id === id)) seen = true
            }
            expect(seen, `${id} is offered once ${ability} is owned`).toBe(true)
        }
    })

    it('stacks the ability upgrades into their stats', () => {
        const stats = defaultStats()
        const stacks = new Map<string, number>()
        applyCard(UPGRADE_BY_ID.get('wellcore')!, stats, stacks)
        applyCard(UPGRADE_BY_ID.get('decoycore')!, stats, stacks)
        applyCard(UPGRADE_BY_ID.get('teslacoil')!, stats, stacks)
        applyCard(UPGRADE_BY_ID.get('teslacoil')!, stats, stacks)
        expect(stats.well).toBe(1)
        expect(stats.decoy).toBe(1)
        expect(stats.overcharge).toBe(2)
        expect(stacks.get('teslacoil')).toBe(2)
    })

    it('gives the synergy boons their own stat', () => {
        const checks: [string, keyof ReturnType<typeof defaultStats>][] = [['cascade', 'cascade'], ['castrush', 'castRush'], ['critchain', 'critChain']]
        for (const [id, key] of checks) {
            const card = UPGRADE_BY_ID.get(id)
            expect(card, id).toBeDefined()
            expect(card!.requiresAbility).toBeUndefined()
            const stats = defaultStats()
            card!.apply(stats)
            expect(stats[key], id).toBe(1)
        }
    })

    it('caps and prices the new boons like the rest of the pool', () => {
        for (const id of ['wellcore', 'decoycore', 'teslacoil', 'cascade', 'castrush', 'critchain']) {
            const card = UPGRADE_BY_ID.get(id)!
            expect(card.maxStacks, id).toBeGreaterThanOrEqual(1)
            expect(card.maxStacks!, id).toBeLessThanOrEqual(3)
            expect(card.description.length, id).toBeGreaterThan(20)
            expect(boonPrice(card.rarity, 5), id).toBeLessThanOrEqual(waveIncome(5))
        }
        expect(UPGRADES.filter(c => c.requiresAbility).length).toBeGreaterThanOrEqual(5)
    })
})

describe('voxel arena ion surge event', () => {
    it('shows up in the event rotation without displacing the others', () => {
        const seen = new Set<string>()
        for (let wave = 3; wave <= 40; wave++) seen.add(waveEvent(wave))
        for (const event of ['none', 'meteors', 'frenzy', 'blackout', 'bounty', 'surge']) expect(seen.has(event), event).toBe(true)
    })

    it('never lands on a boss wave and is carried by the wave plan', () => {
        for (let wave = 1; wave <= 40; wave++) {
            const plan = planWave(wave, seeded(wave))
            expect(plan.event).toBe(waveEvent(wave))
            if (plan.boss) expect(plan.event).toBe('none')
        }
        expect(waveEvent(7)).toBe('surge')
    })
})
