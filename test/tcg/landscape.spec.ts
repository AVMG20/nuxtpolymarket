/**
 * Sideways faces: LEGEND halves and BREAK evolutions are shown turned, and
 * nothing else is. Pure — no database.
 */
import { describe, expect, it } from 'vitest'
import { isLandscapeBundle } from '#shared/utils/tcg/landscape'

describe('isLandscapeBundle', () => {
    it('knows the LEGEND and BREAK faces', () => {
        expect(isLandscapeBundle('me5-5c_en_016')).toBe(true) // Darkrai & Cresselia LEGEND, top
        expect(isLandscapeBundle('me5-5c_en_017')).toBe(true) // and bottom
        expect(isLandscapeBundle('me5-5c_en_022')).toBe(true) // Greninja BREAK
        expect(isLandscapeBundle('xy8_en_012')).toBe(true) // Chesnaught BREAK
    })

    it('leaves upright cards and missing bundles alone', () => {
        expect(isLandscapeBundle('me5-5c_en_002')).toBe(false) // Charizard
        expect(isLandscapeBundle('xy8_en_011')).toBe(false)
        expect(isLandscapeBundle(null)).toBe(false)
        expect(isLandscapeBundle(undefined)).toBe(false)
        expect(isLandscapeBundle('')).toBe(false)
    })
})
