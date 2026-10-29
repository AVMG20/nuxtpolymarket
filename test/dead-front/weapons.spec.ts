import { describe, expect, it } from 'vitest'
import {
    DF_WEAPONS, DF_WEAPON_IDS, DF_WEAPON_LEVEL_XP, dfSanitizeAttachments, dfUnlockedAttachments, dfWeaponLevel, dfWeaponStats
} from '#shared/utils/dead-front/weapons'

describe('dfWeaponStats', () => {
    it('resolves every weapon at every tier', () => {
        for (const id of DF_WEAPON_IDS) {
            for (let t = 0; t <= 3; t++) {
                const s = dfWeaponStats(id, t)
                expect(s.damage).toBeGreaterThan(0)
                expect(s.magSize).toBeGreaterThanOrEqual(1)
                expect(s.name).toBe(t === 0 ? DF_WEAPONS[id].name : DF_WEAPONS[id].papNames[t - 1])
            }
        }
    })

    it('applies attachment mods and ignores ones in the wrong slot', () => {
        const base = dfWeaponStats('thompson', 0)
        expect(dfWeaponStats('thompson', 0, { magazine: 'thompson-drum' }).magSize).toBeGreaterThan(base.magSize)
        expect(dfWeaponStats('m1897', 0, { muzzle: 'm1897-choke' }).pellets).toBe(dfWeaponStats('m1897', 0).pellets - 1)
        // wrong slot / unknown ids are ignored
        expect(dfWeaponStats('thompson', 0, { optic: 'thompson-drum' })).toEqual(base)
        // stacks on top of PaP
        expect(dfWeaponStats('thompson', 2, { magazine: 'thompson-drum' }).magSize).toBeGreaterThan(dfWeaponStats('thompson', 2).magSize)
    })
})

describe('levels and sanitising', () => {
    it('levels up along the curve', () => {
        expect(dfWeaponLevel(0)).toBe(1)
        expect(dfWeaponLevel(DF_WEAPON_LEVEL_XP[1]!)).toBe(2)
        expect(dfWeaponLevel(DF_WEAPON_LEVEL_XP[1]! - 1)).toBe(1)
        expect(dfWeaponLevel(1e9)).toBe(5)
    })

    it('drops locked, unknown and mismatched attachments', () => {
        expect(dfUnlockedAttachments('thompson', 1)).toHaveLength(0)
        expect(dfSanitizeAttachments('thompson', 5, { magazine: 'thompson-drum', optic: 'thompson-reddot' })).toEqual({ magazine: 'thompson-drum', optic: 'thompson-reddot' })
        expect(dfSanitizeAttachments('thompson', 3, { magazine: 'thompson-drum' })).toEqual({})
        expect(dfSanitizeAttachments('thompson', 5, { optic: 'thompson-drum' })).toEqual({})
        expect(dfSanitizeAttachments('thompson', 5, { optic: 'nope' })).toEqual({})
        expect(dfSanitizeAttachments('thompson', 5, { optic: 'thompson-lyman' })).toEqual({})
        expect(dfSanitizeAttachments('xray', 5, { optic: 'thompson-reddot' })).toEqual({})
    })
})
