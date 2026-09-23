import { describe, expect, it } from 'vitest'
import { rankTownUpgrades, type TownAdvisorState } from '#shared/utils/gamelogic/town-advisor'

const calm: TownAdvisorState = {
    jobs: 20,
    residents: 40,
    happiness: 80,
    storageCap: 1000,
    netPerHour: { wheat: 50, wood: 40, planks: 10 },
    stock: { wheat: 100, wood: 100, planks: 50 }
}

const open = [
    { type: 'farm', level: 2, affordable: true },
    { type: 'sawmill', level: 1, affordable: true },
    { type: 'park', level: 1, affordable: true },
    { type: 'warehouse', level: 1, affordable: true },
    { type: 'house', level: 3, affordable: true }
]

const types = (state: TownAdvisorState, candidates = open) => rankTownUpgrades(state, candidates).map(r => r.type)

describe('town advisor', () => {
    it('puts houses first when jobs outnumber residents', () => {
        const [top] = rankTownUpgrades({ ...calm, jobs: 45 }, open)
        expect(top).toMatchObject({ type: 'house', reason: 'residents' })
    })

    it('puts houses first when residents are about to run short', () => {
        const [top] = rankTownUpgrades({ ...calm, jobs: 38 }, open)
        expect(top).toMatchObject({ type: 'house', reason: 'residents' })
    })

    it('does not push houses with plenty of spare residents', () => {
        expect(types(calm)[0]).not.toBe('house')
    })

    it('fixes a good the town is running out of', () => {
        const [top] = rankTownUpgrades({ ...calm, netPerHour: { ...calm.netPerHour, planks: -30 } }, open)
        expect(top).toMatchObject({ type: 'sawmill', reason: 'short', resource: 'planks' })
    })

    it('ranks an empty good above one running low', () => {
        const state = { ...calm, netPerHour: { ...calm.netPerHour, wheat: -10, planks: -10 }, stock: { ...calm.stock, wheat: 5000, planks: 2 } }
        expect(types(state).slice(0, 2)).toEqual(['sawmill', 'farm'])
    })

    it('holds back a consumer of a good that is running down', () => {
        const state = { ...calm, netPerHour: { ...calm.netPerHour, wood: -5 }, stock: { ...calm.stock, wood: 1000 } }
        const ranked = types(state)
        expect(ranked.indexOf('sawmill')).toBeGreaterThan(ranked.indexOf('farm'))
    })

    it('suggests civic buildings when the town is unhappy', () => {
        const [top] = rankTownUpgrades({ ...calm, happiness: 20 }, open)
        expect(top).toMatchObject({ type: 'park', reason: 'happiness' })
    })

    it('suggests storage when goods pile up at the cap', () => {
        const [top] = rankTownUpgrades({ ...calm, stock: { ...calm.stock, wheat: 990 } }, open)
        expect(top).toMatchObject({ type: 'warehouse', reason: 'storage' })
    })

    it('prefers what the player can afford at equal need', () => {
        const [top] = rankTownUpgrades(calm, [
            { type: 'farm', level: 1, affordable: false },
            { type: 'lumber', level: 1, affordable: true }
        ])
        expect(top!.type).toBe('lumber')
    })

    it('keeps the candidate fields, skips roads and unknown types, caps the count', () => {
        const ranked = rankTownUpgrades(calm, [
            { type: 'road', level: 1, affordable: true },
            { type: 'nope', level: 1, affordable: true },
            { type: 'farm', level: 1, affordable: true, id: 'b1' }
        ])
        expect(ranked).toHaveLength(1)
        expect(ranked[0]).toMatchObject({ id: 'b1', type: 'farm' })
        expect(rankTownUpgrades(calm, open, 2)).toHaveLength(2)
    })
})
