/**
 * Engraving follows the foilMask, not the effect preset (see app/utils/tcg/etch.ts).
 * The values here are the sidecar's real vocabulary, taken from the live
 * checklists: 813 cards across 38 sets carry an etched mask, and they do not
 * share a foilEffect.
 */
import { describe, expect, it } from 'vitest'
import { isEtchedMask, etchFor } from '../../app/utils/tcg/etch'

describe('isEtchedMask', () => {
    it('reads the engraved masks', () => {
        expect(isEtchedMask('Etched')).toBe(true)
        // The gold rainbow secrets' own mask value.
        expect(isEtchedMask('ColdFoilEtched')).toBe(true)
        expect(isEtchedMask('etched')).toBe(true)
    })

    it('leaves flat masks flat', () => {
        for (const mask of ['Holo', 'Reverse', 'ReverseLaminatePokeBall', 'Stamped', 'None', '', null, undefined]) {
            expect(isEtchedMask(mask), String(mask)).toBe(false)
        }
    })
})

describe('etchFor', () => {
    // Black Bolt's Black White Rares are foilEffect Rainbow + foilMask Etched.
    // The 'rainbow' preset carries no etch flag — it is shared with 2472 flat
    // BW-era reverse holos — so the mask is the only thing that knows.
    it('asks for the engraving when the mask is etched', () => {
        expect(etchFor('Etched')).toBe(true)
    })

    // Never false: foil.js reads `etch === undefined` as 'defer to the preset',
    // and an explicit false would strip the engraving off the effects that do
    // know better than their masks — BREAK cards etch under a 'Holo' mask.
    it('defers to the effect preset otherwise', () => {
        expect(etchFor('Holo')).toBeUndefined()
        expect(etchFor(null)).toBeUndefined()
        expect(etchFor(undefined)).toBeUndefined()
    })
})
