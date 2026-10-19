import { describe, expect, it } from 'vitest'
import {
    DF_WEAPONS, DF_WEAPON_IDS, DF_WEAPON_LEVEL_XP, DF_WEAPON_XP_PER_KILL,
    dfBoxPool, dfSanitizeAttachments, dfUnlockedAttachments, dfWeaponLevel, dfWeaponStats
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

    it('raises damage, magazine and reserve with each PaP tier', () => {
        for (const id of DF_WEAPON_IDS) {
            const a = dfWeaponStats(id, 1)
            const b = dfWeaponStats(id, 3)
            expect(b.damage).toBeGreaterThan(a.damage)
            if (id !== 'm1911') expect(a.reserve).toBeGreaterThanOrEqual(dfWeaponStats(id, 0).reserve)
            expect(b.magSize).toBeGreaterThanOrEqual(a.magSize)
        }
        expect(dfWeaponStats('wunder', 3).chains).toBeGreaterThan(dfWeaponStats('wunder', 1).chains)
        expect(dfWeaponStats('xray', 3).splashRadius).toBeGreaterThan(dfWeaponStats('xray', 0).splashRadius)
    })

    it('turns the PaP M1911 into a grenade launcher with a growing magazine', () => {
        expect(dfWeaponStats('m1911', 0).shot).toBe('hitscan')
        const t = [1, 2, 3].map(p => dfWeaponStats('m1911', p))
        for (const s of t) {
            expect(s.shot).toBe('grenade')
            expect(s.splashRadius).toBeGreaterThan(0)
            expect(s.projectileSpeed).toBeGreaterThan(0)
        }
        expect(t[1]!.magSize).toBeGreaterThan(t[0]!.magSize)
        expect(t[2]!.magSize).toBeGreaterThan(t[1]!.magSize)
    })

    it('applies attachment mods: multiplied, additive for pellets', () => {
        const base = dfWeaponStats('thompson', 0)
        expect(dfWeaponStats('thompson', 0, { magazine: 'thompson-drum' }).magSize).toBe(50)
        const scoped = dfWeaponStats('kar98k', 0, { optic: 'kar98k-scope' })
        expect(scoped.adsZoom).toBeGreaterThan(dfWeaponStats('kar98k', 0).adsZoom * 2)
        expect(scoped.adsTime).toBeGreaterThan(dfWeaponStats('kar98k', 0).adsTime)
        expect(dfWeaponStats('m1897', 0, { muzzle: 'm1897-choke' }).pellets).toBe(dfWeaponStats('m1897', 0).pellets - 1)
        // wrong slot / unknown ids are ignored
        expect(dfWeaponStats('thompson', 0, { optic: 'thompson-drum' })).toEqual(base)
        // stacks on top of PaP
        expect(dfWeaponStats('thompson', 2, { magazine: 'thompson-drum' }).magSize).toBeGreaterThan(dfWeaponStats('thompson', 2).magSize)
    })

    it('feels like round-based zombies', () => {
        expect(dfWeaponStats('kar98k', 0).damage * dfWeaponStats('kar98k', 0).headMult).toBeGreaterThanOrEqual(950)
        expect(dfWeaponStats('thompson', 0).rpm).toBeGreaterThan(dfWeaponStats('m1911', 0).rpm)
        expect(dfWeaponStats('m1897', 0).perRoundReload).toBeGreaterThan(0)
        expect(dfWeaponStats('lewis', 0).magSize).toBeGreaterThan(40)
    })
})

describe('weapon defs', () => {
    it('has the classic wall-buys and box pool', () => {
        const wall = DF_WEAPON_IDS.filter(id => DF_WEAPONS[id].wallCost !== undefined).sort()
        expect(wall).toEqual(['kar98k', 'm1897', 'mp18', 'thompson'])
        for (const id of wall) expect(DF_WEAPONS[id].ammoCost).toBeGreaterThan(0)
        expect(dfBoxPool().sort()).toEqual(DF_WEAPON_IDS.filter(id => id !== 'm1911' && id !== 'wunder').sort())
        expect(DF_WEAPON_IDS.filter(id => !DF_WEAPONS[id].startable).sort()).toEqual(['wunder', 'xray'])
    })

    it('gives regular weapons a choice in each of the four slots, unlocked at levels 2-5', () => {
        for (const id of DF_WEAPON_IDS) {
            const list = DF_WEAPONS[id].attachments
            if (id === 'xray' || id === 'wunder') {
                expect(list).toHaveLength(0)
                continue
            }
            expect(list.length).toBeGreaterThanOrEqual(4)
            expect(list.length).toBeLessThanOrEqual(7)
            expect(new Set(list.map(a => a.slot)).size).toBe(4)
            for (const a of list) {
                expect(a.level).toBeGreaterThanOrEqual(2)
                expect(a.level).toBeLessThanOrEqual(5)
                expect(Object.keys(a.mods).length).toBeGreaterThan(1)
            }
            expect(new Set(list.map(a => a.id)).size).toBe(list.length)
        }
    })
})

describe('levels and sanitising', () => {
    it('levels up along the curve', () => {
        expect(dfWeaponLevel(0)).toBe(1)
        expect(dfWeaponLevel(DF_WEAPON_LEVEL_XP[1]!)).toBe(2)
        expect(dfWeaponLevel(DF_WEAPON_LEVEL_XP[1]! - 1)).toBe(1)
        expect(dfWeaponLevel(1e9)).toBe(5)
        const killsToMax = DF_WEAPON_LEVEL_XP[4]! / DF_WEAPON_XP_PER_KILL
        expect(killsToMax).toBeGreaterThanOrEqual(250)
        expect(killsToMax).toBeLessThanOrEqual(500)
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

describe('Pack-a-Punch tiers', () => {
    /** Sustained damage per second: every pellet plus the splash of each shot. */
    const dps = (id: (typeof DF_WEAPON_IDS)[number], t: number) => {
        const s = dfWeaponStats(id, t)
        return (s.damage * s.pellets + s.splashDamage) * s.rpm / 60
    }
    const ammo = (id: (typeof DF_WEAPON_IDS)[number], t: number) => {
        const s = dfWeaponStats(id, t)
        return s.magSize + s.reserve
    }

    it('makes every tier strictly better: damage per second and total ammo', () => {
        for (const id of DF_WEAPON_IDS) {
            for (let t = 1; t <= 3; t++) {
                expect(dps(id, t), `${id} dps ${t - 1} -> ${t}`).toBeGreaterThan(dps(id, t - 1))
                if (id !== 'm1911' || t > 1) expect(ammo(id, t), `${id} ammo ${t - 1} -> ${t}`).toBeGreaterThan(ammo(id, t - 1))
            }
        }
    })

    it('makes tiers 2 and 3 big, noticeable steps', () => {
        for (const id of DF_WEAPON_IDS) {
            expect(dps(id, 2) / dps(id, 1), id).toBeGreaterThan(1.5)
            expect(dps(id, 3) / dps(id, 2), id).toBeGreaterThan(1.4)
            expect(ammo(id, 3) / ammo(id, 1), id).toBeGreaterThan(1.3)
        }
    })
})
