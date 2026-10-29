import { describe, expect, it } from 'vitest'
import { DF_WEAPON_IDS, dfBoxPool, dfBoxWeight, dfWeaponStats } from '#shared/utils/dead-front/weapons'
import type { DfWeaponId } from '#shared/utils/dead-front/types'
import { dfBoxRoll } from '#server/utils/dead-front/rules'

describe('weapon niches and the box', () => {
    const stat = (id: DfWeaponId) => dfWeaponStats(id, 0)
    const dps = (id: DfWeaponId) => stat(id).damage * stat(id).pellets * stat(id).rpm / 60
    const bullets = (id: DfWeaponId, hp: number) => Math.ceil(hp / (stat(id).damage * stat(id).pellets))

    it('gives every gun a job', () => {
        const hitscan = DF_WEAPON_IDS.filter(id => stat(id).shot === 'hitscan')
        // the Kar98k hits hardest per shot and goes through a line
        expect(hitscan.every(id => id === 'kar98k' || stat(id).damage * stat(id).headMult < stat('kar98k').damage * stat('kar98k').headMult)).toBe(true)
        expect(stat('kar98k').penetration).toBeGreaterThanOrEqual(2)
        // the trench gun owns point-blank among repeaters: the biggest single trigger pull
        // (the coach gun hits harder still, but only twice before it breaks open)
        expect(hitscan.every(id => id === 'm1897' || id === 'sawnoff' || bullets(id, 330) > bullets('m1897', 330))).toBe(true)
        expect(stat('sawnoff').magSize).toBeLessThan(stat('m1897').magSize)
        // the Thompson out-damages the cheaper MP18, which is steadier
        expect(dps('thompson')).toBeGreaterThan(dps('mp18'))
        expect(stat('mp18').recoil).toBeLessThan(stat('thompson').recoil)
        // the Lewis carries the most damage per magazine, the BAR reaches furthest of the autos
        const magDamage = (id: DfWeaponId) => stat(id).magSize * stat(id).damage * stat(id).pellets
        expect(hitscan.every(id => id === 'lewis' || magDamage(id) < magDamage('lewis'))).toBe(true)
        // the PPSh has the biggest drum and the fastest cycle, but lighter rounds and no more sustained damage than the Thompson
        expect(hitscan.every(id => id === 'ppsh' || (stat(id).magSize < stat('ppsh').magSize && stat(id).rpm < stat('ppsh').rpm))).toBe(true)
        expect(stat('ppsh').damage).toBeLessThan(stat('thompson').damage)
        expect(dps('ppsh')).toBeLessThanOrEqual(dps('thompson'))
        expect(dps('ppsh')).toBeGreaterThan(dps('mp18'))
        expect(stat('bar').range).toBeGreaterThan(stat('thompson').range)
        // the X-Ray splashes; the pistols kill a round-1 zombie with one headshot
        expect(stat('xray').splashRadius).toBeGreaterThan(0)
        expect(stat('m1911').damage * stat('m1911').headMult).toBeGreaterThanOrEqual(150)
        // a round-1 zombie takes a handful of SMG rounds, not a magazine
        expect(bullets('mp18', 150)).toBeLessThanOrEqual(3)
    })

    it('keeps the X-Ray rare but real, and never rolls the wonder weapon', () => {
        const pool = dfBoxPool()
        expect(pool).not.toContain('wunder')
        for (const id of pool) expect(dfBoxWeight(id)).toBeGreaterThan(0)
        let xray = 0
        const n = 20000
        for (let i = 0; i < n; i++) if (dfBoxRoll(pool, (i + 0.5) / n) === 'xray') xray++
        expect(xray / n).toBeGreaterThan(0.04)
        expect(xray / n).toBeLessThan(0.09)
        expect(dfBoxRoll(['c96'], 0.99)).toBe('c96')
    })
})
