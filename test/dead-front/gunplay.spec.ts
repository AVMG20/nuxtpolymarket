import { describe, expect, it } from 'vitest'
import { DF_PLAYER } from '#shared/utils/dead-front/constants'
import type { DfMapDef } from '#shared/utils/dead-front/map'
import { dfCollisionFromSolids } from '#shared/utils/dead-front/physics'
import type { DfShotHit } from '#shared/utils/dead-front/protocol'
import { dfWeaponStats } from '#shared/utils/dead-front/weapons'
import type { DfWeaponId } from '#shared/utils/dead-front/types'
import { DfMatchSim } from '#server/utils/dead-front/sim'
import * as THREE from 'three'
import { dfAimDir, dfShotInterval } from '../../app/utils/dead-front/engine/gun'
import { DF_SLIDE, DF_STEP, DfPlayerController } from '../../app/utils/dead-front/engine/player'
import type { DfMoveIntent, DfMoveSpeeds } from '../../app/utils/dead-front/engine/player'

// The client's shots and movement against the server's validation of them:
// whatever a legit client does must be accepted, under latency jitter and
// frame hitches, and a client firing too fast must still be refused.

describe('aim', () => {
    it('the shot ray is the camera\'s forward axis, whatever the yaw, pitch and roll', () => {
        const cam = new THREE.PerspectiveCamera()
        cam.rotation.order = 'YXZ'
        const fwd = new THREE.Vector3()
        const out = { x: 0, y: 0, z: 0 }
        for (const [yaw, pitch, roll] of [[0, 0, 0], [1.2, 0.4, 0.1], [-2.8, -1.1, -0.2], [3.1, 1.4, 0.3]] as const) {
            cam.rotation.set(pitch, yaw, roll, 'YXZ')
            cam.updateMatrixWorld()
            cam.getWorldDirection(fwd)
            dfAimDir(yaw, pitch, out)
            expect(Math.acos(Math.min(1, fwd.x * out.x + fwd.y * out.y + fwd.z * out.z))).toBeLessThan(1e-6)
        }
    })
})

describe('slide', () => {
    const world = dfCollisionFromSolids([{ min: { x: -10, y: -1, z: -20 }, max: { x: 10, y: 0, z: 10 }, mat: 'mud' }])
    const speeds: DfMoveSpeeds = { walk: DF_PLAYER.walkSpeed, sprint: DF_PLAYER.sprintSpeed, crouch: DF_PLAYER.crouchSpeed, ads: DF_PLAYER.adsSpeed, sprintDuration: 4 }
    const intent = (o: Partial<DfMoveIntent> = {}): DfMoveIntent => ({ fwd: 1, right: 0, sprint: false, crouch: false, jump: false, ads: 0, ...o })

    /** Sprints along the flat (toward -x) for `seconds`, then presses crouch. */
    function sprintThenCrouch(seconds = 0.6) {
        const pc = new DfPlayerController()
        pc.teleport({ x: 9, y: 0, z: 5 })
        pc.yaw = Math.PI / 2
        let t = 0
        for (; t < seconds; t += DF_STEP) pc.step(DF_STEP, t, intent({ sprint: true }), world, speeds)
        expect(pc.sprinting).toBe(true)
        pc.toggleCrouch()
        return { pc, t }
    }

    it('crouching out of a sprint launches a slide that coasts to a crouch', () => {
        const { pc, t: t0 } = sprintThenCrouch()
        let t = t0
        pc.step(DF_STEP, t, intent({ sprint: false }), world, speeds)
        expect(pc.sliding).toBe(true)
        expect(pc.crouched).toBe(true)
        expect(pc.sprinting).toBe(false)
        expect(pc.speed).toBeGreaterThan(DF_PLAYER.sprintSpeed * 1.1)
        let top = 0
        let slid = 0
        const x0 = pc.pos.x
        for (let i = 0; i < 90 && pc.sliding; i++) {
            t += DF_STEP
            pc.step(DF_STEP, t, intent({ sprint: false }), world, speeds)
            top = Math.max(top, pc.speed)
            slid += DF_STEP
        }
        expect(pc.sliding).toBe(false)
        // short, punchy and inside the server's movement budget (sprint x 1.5 + 1)
        expect(slid).toBeLessThanOrEqual(DF_SLIDE.time + DF_STEP)
        expect(top).toBeLessThanOrEqual(DF_SLIDE.maxSpeed + 1e-6)
        expect(top).toBeLessThan(DF_PLAYER.sprintSpeed * 1.5 + 1)
        expect(x0 - pc.pos.x).toBeGreaterThan(3)
        // it ends in a crouch
        expect(pc.crouched).toBe(true)
    })
})

// ---------------------------------------------------------------- server validation

const SPOT = (id: string, x: number, z: number) => ({ id, pos: { x, y: 0, z }, yaw: 0, zone: 'a' })
const FLAT: DfMapDef = {
    id: 'flat', name: 'Flat',
    bounds: { min: { x: -60, y: -1, z: -60 }, max: { x: 60, y: 12, z: 60 } },
    startZone: 'a',
    playerSpawns: [{ x: 0, y: 0, z: 0 }],
    solids: [{ min: { x: -60, y: -1, z: -60 }, max: { x: 60, y: 0, z: 60 }, mat: 'mud' }],
    zones: [{ id: 'a', name: 'A' }],
    doors: [], barricades: [], wallBuys: [], perks: [],
    boxSpots: [SPOT('box', 30, 30)], pap: SPOT('pap', -30, 30), power: SPOT('power', 30, -30),
    egg: { fuses: [], generator: SPOT('gen', -30, -30), pedestal: SPOT('ped', 0, -30), chargeRadius: 6 },
    riserSpawns: [SPOT('r', 50, 50)],
    nav: { nodes: [{ id: 0, pos: { x: 0, y: 0, z: 0 }, zone: 'a' }], links: [] },
    lights: []
}

function serverSim(weapon: DfWeaponId, pap = 0) {
    let clock = 100
    const sim = new DfMatchSim([{ userId: 'u', name: 'u', startWeapon: weapon, attachments: {}, perkMods: {} }], { map: FLAT, now: () => clock, startDelay: 1000 })
    sim.dev(0, { k: 'hold', on: true })
    const p = sim.player(0)!
    if (pap) p.weapons = [{ ...p.weapons[0]!, pap, stats: dfWeaponStats(weapon, pap), mag: 999, reserve: 999 }]
    else p.weapons[0]!.mag = 999
    return { sim, p, set: (t: number) => { clock = t } }
}

describe('server shot validation', () => {
    it('accepts a perked fast gun at full cadence when packets arrive with 0-150 ms jitter', () => {
        const { sim, p, set } = serverSim('c96', 3)
        p.perks = ['twinfire']
        p.effects = { ...p.effects, fireRateMult: 1.33 * 1.15 }
        const interval = dfShotInterval(p.weapons[0]!.stats.rpm, p.effects.fireRateMult)
        // the client fires on cadence (with one two-shot catch-up after a hitch); the network jitters arrival
        const sent: number[] = []
        for (let t = 0; t < 4; t += interval) sent.push(t)
        sent.push(2 + interval * 0.01)
        sent.sort((a, b) => a - b)
        let seed = 3
        const jitter = () => {
            seed = (seed * 16807) % 2147483647
            return (seed / 2147483647) * 0.15
        }
        const arrivals = sent.map(t => t + jitter())
        // TCP keeps order: a late packet holds back the ones behind it
        for (let i = 1; i < arrivals.length; i++) arrivals[i] = Math.max(arrivals[i]!, arrivals[i - 1]!)
        let accepted = 0
        for (const at of arrivals) {
            set(100 + at)
            if (sim.fire(0, { origin: { x: 0, y: 1.62, z: 0 }, dirs: [{ x: 0, y: 0, z: -1 }], hits: [] })) accepted++
        }
        expect(accepted).toBe(arrivals.length)
    })

    it('still refuses a client firing at twice the rate', () => {
        const { sim, set } = serverSim('mp18')
        const interval = dfShotInterval(dfWeaponStats('mp18', 0).rpm, 1)
        let accepted = 0
        let sent = 0
        for (let t = 0; t < 3; t += interval / 2) {
            set(100 + t)
            sent++
            if (sim.fire(0, { origin: { x: 0, y: 1.62, z: 0 }, dirs: [{ x: 0, y: 0, z: -1 }], hits: [] })) accepted++
        }
        expect(accepted).toBeLessThan(sent * 0.7)
    })

    it('accepts hits on a sprinting zombie seen a quarter second in the past', () => {
        const { sim, set } = serverSim('kar98k')
        set(100)
        const z = sim.debugSpawn('ghoul', { x: 0, y: 0, z: -12 }, 1e6)
        // where the client drew it (0.25 s ago at 5.4 m/s, moving +x)
        const seen = { x: -1.35, y: 0, z: -12 }
        z.curSpeed = 5.4
        const eye = { x: 0, y: 1.62, z: 0 }
        const aim = { x: seen.x, y: seen.y + 1.1, z: seen.z }
        const d = Math.hypot(aim.x - eye.x, aim.y - eye.y, aim.z - eye.z)
        const dir = { x: (aim.x - eye.x) / d, y: (aim.y - eye.y) / d, z: (aim.z - eye.z) / d }
        const hits: DfShotHit[] = [{ z: z.id, zone: 'body', dist: d }]
        const hp = z.hp
        sim.fire(0, { origin: eye, dirs: [dir], hits })
        expect(z.hp).toBeLessThan(hp)
    })

    it('a knife cancels a reload on the server too, so the next shot counts', () => {
        const { sim, p, set } = serverSim('thompson')
        set(100)
        p.weapons[0]!.mag = 10
        sim.reload(0)
        expect(p.reload).not.toBeNull()
        sim.melee(0, {})
        expect(p.reload).toBeNull()
        set(100.2)
        expect(sim.fire(0, { origin: { x: 0, y: 1.62, z: 0 }, dirs: [{ x: 0, y: 0, z: -1 }], hits: [] })).toBe(true)
    })

    it('a shot right after the client finished raising a swapped weapon is accepted', () => {
        const { sim, p, set } = serverSim('m1911')
        p.weapons.push({ id: 'mp18', pap: 0, mag: 20, reserve: 100, attachments: {}, stats: dfWeaponStats('mp18', 0) })
        set(100)
        sim.swap(0, 1)
        // the client's quickest raise (an SMG with the fastest swap perks) is ~0.25 s
        for (let i = 0; i < 6; i++) sim.step(0.05)
        set(100.3)
        expect(sim.fire(0, { origin: { x: 0, y: 1.62, z: 0 }, dirs: [{ x: 0, y: 0, z: -1 }], hits: [] })).toBe(true)
    })
})
