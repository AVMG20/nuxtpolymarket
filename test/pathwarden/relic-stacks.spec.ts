import { describe, expect, it } from 'vitest'
import { pathwardenRelicStackMultiplier } from '#shared/utils/gamelogic/pathwarden'

// Relic power is the rarity scale the relic pool is built on: Common 1,
// Uncommon 1.45, Rare 2.1, Epic 3.1, Mythic 4.6.
describe('pathwardenRelicStackMultiplier', () => {
    it('leaves a defense with no bound relic at its base damage', () => {
        expect(pathwardenRelicStackMultiplier(0)).toBe(1)
    })

    it('adds 50% base damage per Common-equivalent stack', () => {
        expect(pathwardenRelicStackMultiplier(1)).toBe(1.5)
        expect(pathwardenRelicStackMultiplier(2)).toBe(2)
    })

    it('fires three Common relics at 250% of base damage, as the field guide states', () => {
        expect(pathwardenRelicStackMultiplier(3)).toBe(2.5)
    })

    it('scales a single higher rarity by its power', () => {
        expect(pathwardenRelicStackMultiplier(4.6)).toBeCloseTo(3.3, 10)
    })

    it('never turns a negative power into a damage penalty', () => {
        expect(pathwardenRelicStackMultiplier(-5)).toBe(1)
    })
})
