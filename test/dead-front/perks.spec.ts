import { describe, expect, it } from 'vitest'
import { DF_BASE_EFFECTS } from '#shared/utils/dead-front/constants'
import { dfComputeEffects } from '#shared/utils/dead-front/perks'
import type { DfPlayerEffects } from '#shared/utils/dead-front/types'

describe('dead front perks', () => {
    it('returns the base effects with no perks', () => {
        expect(dfComputeEffects([], {}, false)).toEqual(DF_BASE_EFFECTS)
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
