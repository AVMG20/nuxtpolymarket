import { describe, expect, it } from 'vitest'
import { DF_BASE_EFFECTS, DF_POINTS } from '#shared/utils/dead-front/constants'
import {
    DF_ENEMIES, dfBrutesInRound, dfRoundZombieCount, dfShamblerGait, dfSpawnInterval, dfSpecialChances,
    dfZombieBaseHealth, dfZombieHitTest
} from '#shared/utils/dead-front/enemies'
import type { DfEggState } from '#shared/utils/dead-front/protocol'
import { dfBoxPool, dfWeaponStats } from '#shared/utils/dead-front/weapons'
import {
    dfBoxChoices, dfBulletDamage, dfClaimPlausible, dfEggAdvance, dfEggTick, dfFalloff, dfKillPoints, dfRayAxisApproach,
    dfScalePoints, dfShotTolerance, dfVerifyZone
} from '#server/utils/dead-front/rules'

describe('rounds', () => {
    it('starts at 6 zombies solo and grows', () => {
        expect(dfRoundZombieCount(1, 1)).toBe(6)
        expect(dfRoundZombieCount(5, 1)).toBe(24)
        let prev = 0
        for (let r = 1; r <= 30; r++) {
            const n = dfRoundZombieCount(r, 1)
            expect(n).toBeGreaterThanOrEqual(prev)
            prev = n
        }
        expect(dfRoundZombieCount(10, 1)).toBeGreaterThan(24)
    })

    it('adds zombies per extra player', () => {
        for (const r of [1, 4, 8, 15]) {
            expect(dfRoundZombieCount(r, 2)).toBeGreaterThan(dfRoundZombieCount(r, 1))
            expect(dfRoundZombieCount(r, 4)).toBeGreaterThan(dfRoundZombieCount(r, 3))
        }
    })

    it('scales health linearly then by 10% per round', () => {
        expect(dfZombieBaseHealth(1)).toBe(150)
        expect(dfZombieBaseHealth(9)).toBe(950)
        expect(dfZombieBaseHealth(10)).toBe(1045)
        expect(dfZombieBaseHealth(20)).toBeGreaterThan(dfZombieBaseHealth(19))
    })

    it('speeds up spawns but never below the floor', () => {
        expect(dfSpawnInterval(10, 1)).toBeLessThan(dfSpawnInterval(1, 1))
        expect(dfSpawnInterval(60, 4)).toBeGreaterThanOrEqual(0.35)
    })

    it('phases enemy types in by round', () => {
        expect(dfSpecialChances(4)).toEqual({ ghoul: 0, bloater: 0 })
        expect(dfSpecialChances(5).ghoul).toBeGreaterThan(0)
        expect(dfSpecialChances(11).bloater).toBe(0)
        expect(dfSpecialChances(12).bloater).toBeGreaterThan(0)
        expect(dfBrutesInRound(7)).toBe(0)
        expect(dfBrutesInRound(8)).toBe(1)
        expect(dfBrutesInRound(20)).toBe(2)
    })

    it('walks early and runs later', () => {
        for (const roll of [0, 0.5, 0.99]) expect(dfShamblerGait(2, roll)).toBe('walk')
        expect(dfShamblerGait(7, 0.5)).toBe('run')
        expect(dfShamblerGait(12, 0.01)).toBe('sprint')
    })
})

describe('hit test', () => {
    const target = { type: 'shambler' as const, pos: { x: 0, y: 0, z: 5 }, yaw: 0, anim: 'walk' as const }
    const def = DF_ENEMIES.shambler

    it('hits the head, body and legs', () => {
        expect(dfZombieHitTest(target, { x: 0, y: def.headY, z: 0 }, { x: 0, y: 0, z: 1 }, 50)?.zone).toBe('head')
        expect(dfZombieHitTest(target, { x: 0, y: 1.2, z: 0 }, { x: 0, y: 0, z: 1 }, 50)?.zone).toBe('body')
        expect(dfZombieHitTest(target, { x: 0, y: 0.4, z: 0 }, { x: 0, y: 0, z: 1 }, 50)?.zone).toBe('limb')
    })

    it('misses beside the zombie and beyond max distance', () => {
        expect(dfZombieHitTest(target, { x: 2, y: 1.2, z: 0 }, { x: 0, y: 0, z: 1 }, 50)).toBeNull()
        expect(dfZombieHitTest(target, { x: 0, y: 1.2, z: 0 }, { x: 0, y: 0, z: 1 }, 2)).toBeNull()
    })
})

describe('shot validation', () => {
    const origin = { x: 0, y: 1.6, z: 0 }

    it('measures the miss distance to the body axis', () => {
        const hit = dfRayAxisApproach(origin, { x: 0, y: 0, z: 1 }, { x: 0.5, y: 0, z: 10 }, 1.8, 60)
        expect(hit.t).toBeCloseTo(10, 5)
        expect(hit.miss).toBeCloseTo(0.5, 5)
        const above = dfRayAxisApproach({ x: 0, y: 3, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 10 }, 1.8, 60)
        expect(above.miss).toBeCloseTo(1.2, 5)
    })

    it('accepts claims within the latency tolerance and rejects wild ones', () => {
        const z = { type: 'shambler' as const, pos: { x: 0.9, y: 0, z: 10 }, speed: 1 }
        expect(dfClaimPlausible(z, origin, { x: 0, y: 0, z: 1 }, 60)).not.toBeNull()
        expect(dfClaimPlausible({ ...z, pos: { x: 4, y: 0, z: 10 } }, origin, { x: 0, y: 0, z: 1 }, 60)).toBeNull()
        expect(dfClaimPlausible(z, origin, { x: 0, y: 0, z: -1 }, 60)).toBeNull()
        expect(dfClaimPlausible({ ...z, pos: { x: 0, y: 0, z: 80 } }, origin, { x: 0, y: 0, z: 1 }, 60)).toBeNull()
    })

    it('widens the tolerance for fast zombies', () => {
        expect(dfShotTolerance(5)).toBeGreaterThan(dfShotTolerance(1))
        const fast = { type: 'ghoul' as const, pos: { x: 2, y: 0, z: 10 }, speed: 5.6 }
        expect(dfClaimPlausible(fast, origin, { x: 0, y: 0, z: 1 }, 60)).not.toBeNull()
    })

    it('downgrades head claims that pass far from the head', () => {
        const z = { type: 'shambler' as const, pos: { x: 0, y: 0, z: 10 }, speed: 0 }
        expect(dfVerifyZone(z, { x: 0, y: DF_ENEMIES.shambler.headY, z: 0 }, { x: 0, y: 0, z: 1 }, 'head')).toBe('head')
        expect(dfVerifyZone(z, { x: 0, y: 0.6, z: 0 }, { x: 0, y: 0, z: 1 }, 'head')).toBe('body')
    })
})

describe('damage and points', () => {
    it('falls off with distance', () => {
        const stats = { range: 10, maxRange: 30, minDamageMult: 0.5 }
        expect(dfFalloff(stats, 5)).toBe(1)
        expect(dfFalloff(stats, 20)).toBeCloseTo(0.75)
        expect(dfFalloff(stats, 40)).toBe(0.5)
    })

    it('multiplies head damage and perk effects', () => {
        const stats = dfWeaponStats('m1911', 0)
        const body = dfBulletDamage(stats, DF_BASE_EFFECTS, 'body', 1, false)
        const head = dfBulletDamage(stats, { ...DF_BASE_EFFECTS, headshotMult: 1.5 }, 'head', 1, false)
        expect(body).toBeCloseTo(stats.damage)
        expect(head).toBeCloseTo(stats.damage * stats.headMult * 1.5)
        expect(dfBulletDamage(stats, { ...DF_BASE_EFFECTS, lastStandDamageMult: 2 }, 'body', 1, true)).toBeCloseTo(stats.damage * 2)
        expect(dfBulletDamage(stats, { ...DF_BASE_EFFECTS, doubleTapBullets: 1 }, 'body', 1, false)).toBeCloseTo(stats.damage * 1.3)
    })

    it('pays classic kill totals', () => {
        expect(dfKillPoints('body', false)).toBe(DF_POINTS.killBody)
        expect(dfKillPoints('limb', false)).toBe(DF_POINTS.killBody)
        expect(dfKillPoints('head', false)).toBe(DF_POINTS.killHead)
        expect(dfKillPoints('head', true)).toBe(DF_POINTS.killMelee)
        expect(dfScalePoints(10, 1, true)).toBe(20)
        expect(dfScalePoints(60, 1.25, false)).toBe(75)
    })
})

describe('mystery box', () => {
    it('never offers a held weapon or the wunderweapon', () => {
        const pool = dfBoxPool()
        const held = pool.slice(0, 2)
        const choices = dfBoxChoices(pool, held)
        for (const h of held) expect(choices).not.toContain(h)
        expect(choices).not.toContain('wunder')
        expect(dfBoxChoices([...pool, 'wunder'], [])).not.toContain('wunder')
    })
})

describe('easter egg', () => {
    const fuses = ['f1', 'f2', 'f3']
    const fresh = (): DfEggState => ({ step: 'power', fusesFound: [], charge: 0, chargeNeeded: 3, rodsOn: [], rodTimer: 0 })

    it('walks power, fuses, install, charge, claim', () => {
        const egg = fresh()
        expect(dfEggAdvance(egg, { kind: 'fuse', id: 'f1' }, fuses).progressed).toBe(false)
        expect(dfEggAdvance(egg, { kind: 'power' }, fuses)).toEqual({ progressed: true, stepChanged: true })
        expect(egg.step).toBe('fuses')
        expect(dfEggAdvance(egg, { kind: 'install' }, fuses).progressed).toBe(false)
        dfEggAdvance(egg, { kind: 'fuse', id: 'f1' }, fuses)
        expect(dfEggAdvance(egg, { kind: 'fuse', id: 'f1' }, fuses).progressed).toBe(false)
        expect(dfEggAdvance(egg, { kind: 'fuse', id: 'nope' }, fuses).progressed).toBe(false)
        dfEggAdvance(egg, { kind: 'fuse', id: 'f2' }, fuses)
        expect(egg.step).toBe('fuses')
        expect(dfEggAdvance(egg, { kind: 'fuse', id: 'f3' }, fuses).stepChanged).toBe(true)
        expect(egg.step).toBe('install')
        dfEggAdvance(egg, { kind: 'install' }, fuses)
        expect(egg.step).toBe('charge')
        for (let i = 0; i < 2; i++) dfEggAdvance(egg, { kind: 'soul', needed: 3 }, fuses)
        expect(egg.step).toBe('charge')
        dfEggAdvance(egg, { kind: 'soul', needed: 3 }, fuses)
        expect(egg.step).toBe('claim')
        expect(dfEggAdvance(egg, { kind: 'claim', pid: 1 }, fuses).stepChanged).toBe(true)
        expect(egg.claimedBy).toBe(1)
        expect(dfEggAdvance(egg, { kind: 'claim', pid: 2 }, fuses).progressed).toBe(false)
        expect(egg.step).toBe('done')
    })

    it('grounds the Arc with the lightning rods before the claim', () => {
        const rods = ['rod-0', 'rod-1', 'rod-2']
        const egg = fresh()
        egg.step = 'charge'
        for (let i = 0; i < 3; i++) dfEggAdvance(egg, { kind: 'soul', needed: 3 }, fuses, rods)
        expect(egg.step).toBe('rods')
        // nothing before the step, the clock starts on the first rod, repeats don't count
        expect(dfEggAdvance(egg, { kind: 'claim', pid: 1 }, fuses, rods).progressed).toBe(false)
        expect(dfEggAdvance(egg, { kind: 'rod', id: 'rod-1', time: 45 }, fuses, rods)).toEqual({ progressed: true, stepChanged: false })
        expect(egg.rodTimer).toBe(45)
        expect(dfEggAdvance(egg, { kind: 'rod', id: 'rod-1', time: 45 }, fuses, rods).progressed).toBe(false)
        expect(dfEggAdvance(egg, { kind: 'rod', id: 'nope', time: 45 }, fuses, rods).progressed).toBe(false)
        expect(dfEggTick(egg, 10, fuses, rods)).toEqual([])
        dfEggAdvance(egg, { kind: 'rod', id: 'rod-0', time: 45 }, fuses, rods)
        // the second rod doesn't restart the clock
        expect(egg.rodTimer).toBeCloseTo(35)
        expect(dfEggAdvance(egg, { kind: 'rod', id: 'rod-2', time: 45 }, fuses, rods).stepChanged).toBe(true)
        expect(egg.step).toBe('claim')
        expect(egg.rodTimer).toBe(0)
        expect(dfEggTick(egg, 60, fuses, rods)).toEqual([])
        expect(egg.step).toBe('claim')
    })

    it('resets every rod when the clock runs out, and the squad can retry', () => {
        const rods = ['rod-0', 'rod-1', 'rod-2']
        const egg = fresh()
        egg.step = 'rods'
        expect(dfEggTick(egg, 100, fuses, rods)).toEqual([])
        dfEggAdvance(egg, { kind: 'rod', id: 'rod-0', time: 45 }, fuses, rods)
        dfEggAdvance(egg, { kind: 'rod', id: 'rod-2', time: 45 }, fuses, rods)
        expect(dfEggTick(egg, 44.9, fuses, rods)).toEqual([])
        expect(dfEggTick(egg, 0.2, fuses, rods)).toEqual(['rod-0', 'rod-2'])
        expect(egg.step).toBe('rods')
        expect(egg.rodsOn).toEqual([])
        expect(egg.rodTimer).toBe(0)
        for (const id of rods) dfEggAdvance(egg, { kind: 'rod', id, time: 45 }, fuses, rods)
        expect(egg.step).toBe('claim')
    })

    it('goes straight to the claim on a map without lightning rods', () => {
        const egg = fresh()
        egg.step = 'charge'
        for (let i = 0; i < 3; i++) dfEggAdvance(egg, { kind: 'soul', needed: 3 }, fuses)
        expect(egg.step).toBe('claim')
    })

    it('skips the fuse hunt on a map without fuses', () => {
        const egg = fresh()
        dfEggAdvance(egg, { kind: 'power' }, [])
        expect(egg.step).toBe('install')
    })
})
