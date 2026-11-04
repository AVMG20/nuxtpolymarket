import { describe, expect, it } from 'vitest'
import { DF_FLAME_POINT_INTERVAL, dfFlameHitPays } from '#shared/utils/dead-front/combat'
import type { DfMapDef } from '#shared/utils/dead-front/map'
import { DfMatchSim } from '#server/utils/dead-front/sim'

// The flamethrower hits every zombie in its jet ~30 times a second: it pays its
// +10 per zombie once per DF_FLAME_POINT_INTERVAL, not per hit.

const spot = (id: string, x: number, z: number) => ({ id, pos: { x, y: 0, z }, yaw: 0, zone: 'a' })

const MAP: DfMapDef = {
    id: 'flat', name: 'Flat', bounds: { min: { x: -40, y: -1, z: -40 }, max: { x: 40, y: 12, z: 40 } }, startZone: 'a',
    playerSpawns: [{ x: 0, y: 0, z: 0 }],
    solids: [{ min: { x: -40, y: -1, z: -40 }, max: { x: 40, y: 0, z: 40 }, mat: 'mud' }],
    zones: [{ id: 'a', name: 'A' }], doors: [], barricades: [], wallBuys: [], perks: [],
    boxSpots: [spot('box', 30, 30)], pap: spot('pap', -30, 30), power: spot('power', 30, -30),
    egg: { fuses: [], generator: spot('gen', -30, -30), pedestal: spot('ped', 0, -30), chargeRadius: 6 },
    riserSpawns: [spot('r', 35, 35)],
    nav: { nodes: [{ id: 0, pos: { x: 0, y: 0, z: 0 }, zone: 'a' }], links: [] },
    lights: []
} as unknown as DfMapDef

describe('flamethrower hit points', () => {
    it('pays a zombie once per interval', () => {
        const paid = new Map<number, number>()
        expect(dfFlameHitPays(paid, 1, 10)).toBe(true)
        expect(dfFlameHitPays(paid, 1, 10.1)).toBe(false)
        expect(dfFlameHitPays(paid, 2, 10.1)).toBe(true)
        expect(dfFlameHitPays(paid, 1, 10 + DF_FLAME_POINT_INTERVAL)).toBe(true)
    })

    it('keeps its record small', () => {
        const paid = new Map<number, number>()
        for (let i = 0; i < 500; i++) dfFlameHitPays(paid, i, i * 0.1)
        expect(paid.size).toBeLessThan(70)
    })

    it('pays a burning zombie one +10 for a burst of hits on the server', () => {
        const sim = new DfMatchSim([{ userId: 'u', name: 'u', attachments: {}, perkMods: {} }], { map: MAP, now: () => 100, startDelay: 1000 })
        sim.dev(0, { k: 'hold', on: true })
        sim.dev(0, { k: 'god', on: true })
        const p = sim.player(0)!
        const w = sim['makeWeapon'](p, 'flammen', 0)
        w.mag = 50
        p.weapons = [w]
        p.slot = 0
        p.pos = { x: 0, y: 0, z: 0 }
        const z = sim.debugSpawn('shambler', { x: 0, y: 0, z: -2 }, 1e6)
        const before = p.points
        const dir = { x: 0, y: -0.3, z: -1 }
        for (let i = 0; i < 6; i++) sim.fire(0, { origin: { x: 0, y: 1.62, z: 0 }, dirs: [dir], hits: [{ z: z.id, zone: 'body', dist: 2 }] })
        // every hit lands (the fire-rate bucket lets a couple through at once) but only one pays
        expect(1e6 - z.hp).toBeGreaterThan(34)
        expect(p.points - before).toBe(10)
    })
})
