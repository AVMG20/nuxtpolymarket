import { describe, expect, it } from 'vitest'
import { DF_ARC_POINT_BLANK, dfArcAim, dfArcBody } from '#shared/utils/dead-front/combat'
import type { DfMapDef } from '#shared/utils/dead-front/map'
import type { DfEvent } from '#shared/utils/dead-front/protocol'
import type { DfWeaponId, Vec3 } from '#shared/utils/dead-front/types'
import { DfMatchSim } from '#server/utils/dead-front/sim'
import { dfBlastSource } from '../../app/utils/dead-front/weapons/projectiles'

// The wunderweapon's arc at point blank, and the X-Ray blast colour carried on
// the server's explode event.

const spot = (id: string, x: number, z: number) => ({ id, pos: { x, y: 0, z }, yaw: 0, zone: 'a' })

const MAP: DfMapDef = {
    id: 'flat', name: 'Flat', bounds: { min: { x: -40, y: -1, z: -40 }, max: { x: 40, y: 12, z: 40 } }, startZone: 'a',
    playerSpawns: [{ x: 0, y: 0, z: 0 }],
    solids: [
        { min: { x: -40, y: -1, z: -40 }, max: { x: 40, y: 0, z: 40 }, mat: 'mud' },
        { min: { x: -5, y: 0, z: -12 }, max: { x: 5, y: 4, z: -11 }, mat: 'stone' }
    ],
    zones: [{ id: 'a', name: 'A' }], doors: [], barricades: [], wallBuys: [], perks: [],
    boxSpots: [spot('box', 30, 30)], pap: spot('pap', -30, 30), power: spot('power', 30, -30),
    egg: { fuses: [], generator: spot('gen', -30, -30), pedestal: spot('ped', 0, -30), chargeRadius: 6 },
    riserSpawns: [spot('r', 35, 35)],
    nav: { nodes: [{ id: 0, pos: { x: 0, y: 0, z: 0 }, zone: 'a' }], links: [] },
    lights: []
} as unknown as DfMapDef

const EYE = 1.62

function armed(weapon: DfWeaponId, pap = 0) {
    let clock = 100
    const sim = new DfMatchSim([{ userId: 'u', name: 'u', attachments: {}, perkMods: {} }], { map: MAP, now: () => clock, startDelay: 1000 })
    sim.dev(0, { k: 'hold', on: true })
    sim.dev(0, { k: 'god', on: true })
    const p = sim.player(0)!
    const w = sim['makeWeapon'](p, weapon, pap)
    w.mag = 99
    p.weapons = [w]
    p.slot = 0
    p.pos = { x: 0, y: 0, z: 0 }
    return { sim, p, tick: (s: number) => { clock += s } }
}

function dirFromYawPitch(yaw: number, pitch: number): Vec3 {
    // yaw 0 looks down -z
    return { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) }
}

/** Fires the wunderweapon from the eye along `dir` (no claims unless given) and returns the zombie's damage taken. */
function zap(at: Vec3, dir: Vec3, claim = false): number {
    const { sim } = armed('wunder')
    const z = sim.debugSpawn('shambler', at, 1e6)
    const before = z.hp
    const origin = { x: 0, y: EYE, z: 0 }
    sim.fire(0, { origin, dirs: [dir], hits: claim ? [{ z: z.id, zone: 'body', dist: 0.3 }] : [] })
    return before - z.hp
}

describe('wunderweapon arc at close range', () => {
    it('strikes a zombie touching the player, looking straight ahead (its chest is below the eye line)', () => {
        expect(zap({ x: 0, y: 0, z: -0.55 }, dirFromYawPitch(0, 0))).toBeGreaterThan(0)
    })

    it('strikes a zombie the eye is inside of, or already past', () => {
        expect(zap({ x: 0, y: 0, z: -0.1 }, dirFromYawPitch(0, 0))).toBeGreaterThan(0)
        expect(zap({ x: 0, y: 0, z: 0.15 }, dirFromYawPitch(0, 0))).toBeGreaterThan(0)
    })

    it('strikes a zombie within reach that is off to the side or below the crosshair', () => {
        expect(zap({ x: -0.6, y: 0, z: -0.6 }, dirFromYawPitch(0, 0))).toBeGreaterThan(0) // 45 degrees off, 0.85 m
        expect(zap({ x: 0, y: 0, z: -1.2 }, dirFromYawPitch(0, 0.6))).toBeGreaterThan(0) // aiming up over its head
        expect(zap({ x: 0, y: 0, z: -1.4 }, dirFromYawPitch(0, -0.9))).toBeGreaterThan(0) // aiming at its feet
    })

    it('takes the client claim at point blank', () => {
        expect(zap({ x: 0, y: 0, z: -0.5 }, dirFromYawPitch(0, -0.3), true)).toBeGreaterThan(0)
    })

    it('still needs the zombie in front, and in the cone further out', () => {
        expect(zap({ x: 0, y: 0, z: 0.9 }, dirFromYawPitch(0, 0))).toBe(0) // behind
        expect(zap({ x: 0, y: 0, z: -10 }, dirFromYawPitch(0.08, 0))).toBeGreaterThan(0) // 4.6 degrees off at 10 m
        expect(zap({ x: 0, y: 0, z: -10 }, dirFromYawPitch(0.5, 0))).toBe(0) // 29 degrees off
        expect(zap({ x: 0, y: 0, z: -14 }, dirFromYawPitch(0, 0))).toBe(0) // behind the wall
    })

    it('dfArcAim: every point-blank body in front is taken, nearest first', () => {
        const eye = { x: 0, y: EYE, z: 0 }
        const fwd = dirFromYawPitch(0, 0)
        for (let d = 0; d <= DF_ARC_POINT_BLANK + 0.3; d += 0.05) {
            for (const yaw of [-0.9, -0.4, 0, 0.4, 0.9]) {
                const pos = { x: Math.sin(yaw) * -d, y: 0, z: -Math.cos(yaw) * d }
                expect(dfArcAim(dfArcBody('shambler', pos), eye, fwd, 40), `d ${d.toFixed(2)} yaw ${yaw}`).not.toBeNull()
            }
        }
        const near = dfArcAim(dfArcBody('shambler', { x: 0, y: 0, z: -0.6 }), eye, fwd, 40)!
        const far = dfArcAim(dfArcBody('shambler', { x: 0, y: 0, z: -3 }), eye, fwd, 40)!
        expect(near.score).toBeLessThan(far.score)
        // a crawler at your feet
        expect(dfArcAim(dfArcBody('shambler', { x: 0, y: 0, z: -1 }, true), eye, dirFromYawPitch(0, -1), 40)).not.toBeNull()
    })
})

describe('X-Ray blast colour', () => {
    function boltBlast(pap: number, from: Vec3, dir: Vec3, zombieAt?: Vec3): Extract<DfEvent, { k: 'explode' }> | undefined {
        const { sim, tick } = armed('xray', pap)
        if (zombieAt) sim.debugSpawn('shambler', zombieAt, 1e6)
        sim.snapshot()
        sim.fire(0, { origin: from, dirs: [dir], hits: [] })
        const events: DfEvent[] = []
        for (let i = 0; i < 60; i++) {
            tick(0.05)
            sim.step(0.05)
            events.push(...sim.snapshot().events)
        }
        return events.find((e): e is Extract<DfEvent, { k: 'explode' }> => e.k === 'explode' && e.kind === 'xray')
    }

    it('the explode event carries the bolt\'s Pack-a-Punch tier', () => {
        for (const pap of [0, 1, 2, 3]) {
            // into the ground in front, a wall, and a zombie point blank (a bolt never seen in a snapshot)
            expect(boltBlast(pap, { x: 0, y: EYE, z: 0 }, dirFromYawPitch(0, -0.5))?.tier).toBe(pap)
            expect(boltBlast(pap, { x: 0, y: EYE, z: 0 }, dirFromYawPitch(0, 0))?.tier).toBe(pap)
            expect(boltBlast(pap, { x: 0, y: EYE, z: 0 }, dirFromYawPitch(0, 0), { x: 0, y: 0, z: -0.6 })?.tier).toBe(pap)
        }
    })

    it('the client takes the server tier over the nearest-projectile guess', () => {
        const pos = { x: 0, y: 0, z: 0 }
        // no bolt seen at all (point blank): the event's tier, not green
        expect(dfBlastSource(pos, 'xray-bolt', [], 2).tier).toBe(2)
        // a tier-0 bolt of someone else nearby doesn't recolour a tier-2 blast
        const other = { pos: { x: 1, y: 0, z: 0 }, tier: 0, kind: 'xray-bolt' as const }
        const r = dfBlastSource(pos, 'xray-bolt', [other], 2)
        expect(r.tier).toBe(2)
        expect(r.src).toBe(other)
        // an old server without the field: the nearest bolt's tier
        expect(dfBlastSource(pos, 'xray-bolt', [other, { pos: { x: 0.2, y: 0, z: 0 }, tier: 3, kind: 'xray-bolt' as const }]).tier).toBe(3)
        expect(dfBlastSource(pos, 'xray-bolt', [{ pos: { x: 9, y: 0, z: 0 }, tier: 3, kind: 'xray-bolt' as const }]).tier).toBe(0)
    })
})
