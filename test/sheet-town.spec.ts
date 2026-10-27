import { describe, expect, it } from 'vitest'
import type { TownState } from '../app/composables/useTown'
import { townRecommendations } from '../app/utils/sheet-town'
import { TOWN_BUILDINGS, getTownBuilding, townLevelCost } from '#shared/utils/gamelogic/town'

const catalog = TOWN_BUILDINGS.map(def => ({ id: def.id, name: def.name, kind: def.kind, tier: def.tier, maxLevel: undefined }))

function town(overrides: Partial<TownState>): TownState {
    return {
        initialized: true,
        serverNow: 0,
        catalog,
        resources: [],
        constants: { tickMs: 60_000, maxLevel: 20 },
        buildings: [],
        inventory: {},
        popCap: 10,
        workersDemanded: 4,
        happiness: 70,
        storageCap: 1000,
        netPerTick: {},
        needs: [],
        ...overrides
    } as unknown as TownState
}

const building = (id: string, type: string, level: number, extra = {}) => ({ id, type, level, upgradingTo: null, completesAt: 0, ...extra })

describe('townRecommendations', () => {
    it('recommends homes when jobs outnumber residents', () => {
        const state = town({
            popCap: 4,
            workersDemanded: 10,
            inventory: { ...townLevelCost(getTownBuilding('house')!, 2).resources },
            buildings: [building('h1', 'house', 1), building('f1', 'farm', 1)] as TownState['buildings']
        })
        const [first] = townRecommendations(state, 1e9)
        expect(first?.type).toBe('house')
        expect(first?.reason).toBe('residents')
        expect(first?.affordable).toBe(true)
    })

    it('offers one row per type at its lowest free level, skipping busy buildings', () => {
        const state = town({
            buildings: [
                building('h1', 'house', 3),
                building('h2', 'house', 1),
                building('h3', 'house', 1, { upgradingTo: 2 }),
                building('f1', 'farm', 2, { completesAt: Date.now() + 60_000 }),
                building('r1', 'road', 1)
            ] as TownState['buildings']
        })
        const picks = townRecommendations(state, 1e9)
        expect(picks.map(p => p.id)).toEqual(['h2'])
    })

    it('marks upgrades the player cannot pay for', () => {
        const state = town({ buildings: [building('h1', 'house', 1)] as TownState['buildings'] })
        expect(townRecommendations(state, 0)[0]?.affordable).toBe(false)
    })
})
