import { describe, expect, it } from 'vitest'
import type { DfMapDef } from '#shared/utils/dead-front/map'
import type { DfWeaponId, Vec3 } from '#shared/utils/dead-front/types'
import { DfMatchSim } from '#server/utils/dead-front/sim'

// The wunderweapon's arc at point blank: the server must strike what the
// player is touching, and still never behind them or through a wall.

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

function armed(weapon: DfWeaponId) {
    const sim = new DfMatchSim([{ userId: 'u', name: 'u', attachments: {}, perkMods: {} }], { map: MAP, now: () => 100, startDelay: 1000 })
    sim.dev(0, { k: 'hold', on: true })
    sim.dev(0, { k: 'god', on: true })
    const p = sim.player(0)!
    const w = sim['makeWeapon'](p, weapon, 0)
    w.mag = 99
    p.weapons = [w]
    p.slot = 0
    p.pos = { x: 0, y: 0, z: 0 }
    return { sim, p }
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

    it('takes the client claim at point blank', () => {
        expect(zap({ x: 0, y: 0, z: -0.5 }, dirFromYawPitch(0, -0.3), true)).toBeGreaterThan(0)
    })

    it('still needs the zombie in front, and in the cone further out', () => {
        expect(zap({ x: 0, y: 0, z: 0.9 }, dirFromYawPitch(0, 0))).toBe(0) // behind
        expect(zap({ x: 0, y: 0, z: -10 }, dirFromYawPitch(0.08, 0))).toBeGreaterThan(0) // 4.6 degrees off at 10 m
        expect(zap({ x: 0, y: 0, z: -10 }, dirFromYawPitch(0.5, 0))).toBe(0) // 29 degrees off
        expect(zap({ x: 0, y: 0, z: -14 }, dirFromYawPitch(0, 0))).toBe(0) // behind the wall
    })
})
