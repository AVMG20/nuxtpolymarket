import { describe, expect, it } from 'vitest'
import { DF_BASE_EFFECTS } from '#shared/utils/dead-front/constants'
import { DF_PERKS, DF_PERK_IDS, dfComputeEffects } from '#shared/utils/dead-front/perks'
import type { DfPlayerEffects } from '#shared/utils/dead-front/types'

describe('dead front perks', () => {
    it('has six perks with exactly six modifiers on levels 1..6', () => {
        expect(DF_PERK_IDS).toHaveLength(6)
        const ids = new Set<string>()
        for (const id of DF_PERK_IDS) {
            const def = DF_PERKS[id]
            expect(def.modifiers.map(m => m.level)).toEqual([1, 2, 3, 4, 5, 6])
            expect(def.cost).toBeGreaterThanOrEqual(1500)
            expect(def.cost).toBeLessThanOrEqual(3000)
            for (const m of def.modifiers) {
                expect(ids.has(m.id)).toBe(false)
                ids.add(m.id)
                for (const k of Object.keys(m.effects)) expect(k in DF_BASE_EFFECTS).toBe(true)
            }
        }
    })

    it('returns the base effects with no perks', () => {
        expect(dfComputeEffects([], {}, false)).toEqual(DF_BASE_EFFECTS)
    })

    it('applies base effects and multiplies Mult fields', () => {
        const e = dfComputeEffects(['quickhand', 'ironhide'], {}, false)
        expect(e.maxHealth).toBe(250)
        expect(e.reloadMult).toBe(2)
        const both = dfComputeEffects(['quickhand'], { quickhand: ['quickhand-speedloader'] }, false)
        expect(both.reloadMult).toBeCloseTo(2.5)
    })

    it('applies only selected modifiers of owned perks', () => {
        const e = dfComputeEffects(['ironhide'], { ironhide: ['ironhide-deathwish'], quickhand: ['quickhand-shock'] }, false)
        expect(e.deathWish).toBe(true)
        expect(e.killHeal).toBe(0)
        expect(e.reloadShock).toBe(0)
    })

    it('caps modifiers at two and ignores unknown ids', () => {
        const e: DfPlayerEffects = dfComputeEffects(['ironhide'], { ironhide: ['nope', 'ironhide-bloodletter', 'ironhide-sandbag', 'ironhide-deathwish'] }, false)
        expect(e.killHeal).toBe(8)
        expect(e.explosiveResistMult).toBe(0.5)
        expect(e.deathWish).toBe(false)
    })

    it('grants a self-revive for Second Wind only in solo', () => {
        expect(dfComputeEffects(['secondwind'], {}, true).selfRevives).toBe(1)
        expect(dfComputeEffects(['secondwind'], {}, false).selfRevives).toBe(0)
        expect(dfComputeEffects(['secondwind'], {}, false).reviveMult).toBe(2)
    })
})
