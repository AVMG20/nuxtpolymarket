import { describe, expect, it } from 'vitest'
import { DF_PLAYER } from '#shared/utils/dead-front/constants'
import type { DfMapDef } from '#shared/utils/dead-front/map'
import { dfCollisionFromSolids } from '#shared/utils/dead-front/physics'
import type { DfShotHit } from '#shared/utils/dead-front/protocol'
import { dfWeaponStats } from '#shared/utils/dead-front/weapons'
import type { DfWeaponId } from '#shared/utils/dead-front/types'
import { DfMatchSim } from '#server/utils/dead-front/sim'
import * as THREE from 'three'
import { DF_RECOIL, DF_RELOAD_SEATED, DfGunState, DfRecoil, dfAimDir, dfConeDir, dfShotInterval, dfSpread, dfSprintOutTime } from '../../app/utils/dead-front/engine/gun'
import { DF_STEP, DfPlayerController } from '../../app/utils/dead-front/engine/player'
import type { DfMoveIntent, DfMoveSpeeds } from '../../app/utils/dead-front/engine/player'

// Gun feel on the client (fire timing, the sprint-out, recoil) and the
// server's validation of those same shots: whatever a legit client fires
// must be accepted, under latency jitter and frame hitches.

function gun(id: DfWeaponId, pap = 0, mag?: number): DfGunState {
    const g = new DfGunState()
    const s = dfWeaponStats(id, pap)
    g.setWeapon({ id, pap, mag: mag ?? s.magSize, reserve: s.reserve, attachments: {} }, s, 0, 0)
    return g
}

describe('fire timing', () => {
    it('automatic fire keeps its cadence through a frame hitch', () => {
        const g = gun('thompson', 0, 200)
        const interval = dfShotInterval(700, 1)
        let shots = 0
        let t = 0
        while (t < 2) {
            // 60 fps with a 150 ms hitch at 1 s
            t += t > 1 && t < 1.02 ? 0.15 : 1 / 60
            let n = 0
            while (n < 2 && g.canFire(t, true)) {
                g.fired(t, 1)
                shots++
                n++
            }
        }
        expect(shots).toBeGreaterThanOrEqual(Math.floor(2 / interval) - 1)
        expect(shots).toBeLessThanOrEqual(Math.ceil(2 / interval) + 1)
    })

    it('a fresh pull of an automatic weapon fires once, not a catch-up burst', () => {
        const g = gun('mp18')
        expect(g.canFire(0, true)).toBe(true)
        g.fired(0, 1)
        // trigger released for a while, then pulled again late in a long frame
        g.canFire(0.5, false)
        expect(g.canFire(2, true)).toBe(true)
        g.fired(2, 1)
        expect(g.canFire(2, true)).toBe(false)
    })

    it('semi-automatic clicks are buffered, never eaten, at any click rate the gun can match', () => {
        const g = gun('m1911', 0, 100)
        const interval = dfShotInterval(dfWeaponStats('m1911', 0).rpm, 1)
        let shots = 0
        let t = 0
        let nextClick = 0
        const clickEvery = interval * 1.05
        let clicks = 0
        while (t < 3) {
            t += 1 / 60
            if (t >= nextClick) {
                g.press(t)
                clicks++
                nextClick += clickEvery
            }
            if (g.canFire(t, true)) {
                g.fired(t, 1)
                shots++
            }
        }
        expect(shots).toBeGreaterThanOrEqual(clicks - 1)
    })

    it('a press made while sprinting fires once the weapon is up, after the sprint-out', () => {
        const g = gun('m1911')
        g.setSprinting(true, 0)
        g.press(0)
        expect(g.canFire(0, true)).toBe(false)
        g.setSprinting(false, 0.05)
        const out = dfSprintOutTime('pistol', 1)
        expect(g.canFire(0.05 + out - 0.01, true)).toBe(false)
        expect(g.canFire(0.05 + out + 0.005, true)).toBe(true)
    })

    it('heavier weapons take longer to come out of a sprint; aim perks shorten it', () => {
        expect(dfSprintOutTime('lmg', 1)).toBeGreaterThan(dfSprintOutTime('smg', 1))
        expect(dfSprintOutTime('smg', 1)).toBeGreaterThan(dfSprintOutTime('pistol', 1))
        expect(dfSprintOutTime('rifle', 1.35)).toBeLessThan(dfSprintOutTime('rifle', 1))
    })

    it('a press during the swap fires when the new weapon is raised', () => {
        const g = gun('m1911')
        const s = dfWeaponStats('mp18', 0)
        g.press(0)
        g.setWeapon({ id: 'c96', pap: 0, mag: 10, reserve: 50, attachments: {} }, dfWeaponStats('c96', 0), 0, 0.45)
        expect(g.canFire(0.3, true)).toBe(false)
        expect(g.canFire(0.46, true)).toBe(true)
        expect(s.fireMode).toBe('auto')
    })

    it('shell-by-shell reloads can be cut short by firing, magazine reloads cannot', () => {
        const pump = gun('m1897', 0, 2)
        pump.startReload(0, 1)
        pump.update(1, 1 / 60, 1) // a shell went in
        expect(pump.mag).toBe(3)
        pump.press(1.01)
        expect(pump.canFire(1.01, true)).toBe(true)
        pump.fired(1.01, 1)
        expect(pump.reloading).toBe(false)

        const smg = gun('thompson', 0, 5)
        smg.startReload(0, 1)
        expect(smg.canFire(0.5, true)).toBe(false)
    })

    it('a reload cancelled early is dropped; once the magazine is seated it counts', () => {
        const early = gun('thompson', 0, 5)
        const t = early.startReload(0, 1)
        expect(early.cancelReload(t * 0.5)).toBe(false)
        expect(early.mag).toBe(5)
        expect(early.reloading).toBe(false)

        const late = gun('thompson', 0, 5)
        const reserve = late.reserve
        const t2 = late.startReload(0, 1)
        expect(late.cancelReload(t2 * (DF_RELOAD_SEATED + 0.02))).toBe(true)
        const size = dfWeaponStats('thompson', 0).magSize
        expect(late.mag).toBe(size)
        expect(late.reserve).toBe(reserve - (size - 5))
        // a cancel without a clock (the last stand, the Pack-a-Punch) never adds ammo
        const plain = gun('thompson', 0, 5)
        plain.startReload(0, 1)
        expect(plain.cancelReload()).toBe(false)
        expect(plain.mag).toBe(5)
    })
})

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

    it('a rested shot down the sights lands on the centre (within 0.1 degrees) for every weapon', () => {
        for (const id of ['m1911', 'c96', 'm1897', 'kar98k', 'thompson', 'mp18', 'ppsh', 'bar', 'lewis', 'xray'] as const) {
            const s = dfWeaponStats(id, 0)
            const spread = dfSpread({ hipSpread: s.hipSpread, adsSpread: s.adsSpread, adsBlend: 1, spreadMult: 1, move: 0, airborne: false, crouched: false, bloom: 0 })
            const d = dfAimDir(0.3, -0.05, { x: 0, y: 0, z: 0 })
            for (const [u, v] of [[0.999, 0.25], [0.5, 0.75], [0.999, 0.999]]) {
                const o = dfConeDir(d, spread, u!, v!, { x: 0, y: 0, z: 0 })
                if (id === 'm1897') continue // a shotgun pattern is a pattern
                expect((Math.acos(Math.min(1, d.x * o.x + d.y * o.y + d.z * o.z)) * 180) / Math.PI, id).toBeLessThan(0.1)
            }
        }
    })

    it('hip fire and firing on the move still spread', () => {
        const s = dfWeaponStats('mp18', 0)
        const base = { hipSpread: s.hipSpread, adsSpread: s.adsSpread, spreadMult: 1, airborne: false, crouched: false }
        const rested = dfSpread({ ...base, adsBlend: 1, move: 0, bloom: 0 })
        expect(dfSpread({ ...base, adsBlend: 1, move: 0.6, bloom: 0 })).toBeGreaterThan(rested * 5)
        expect(dfSpread({ ...base, adsBlend: 1, move: 0, bloom: 0.5 })).toBeGreaterThan(rested * 5)
        expect(dfSpread({ ...base, adsBlend: 0, move: 0, bloom: 0 })).toBeGreaterThan(s.hipSpread * 0.9)
    })
})

describe('recoil', () => {
    it('climbs through a burst, settles under the class cap and recovers to zero without overshoot', () => {
        const r = new DfRecoil()
        const amount = dfWeaponStats('thompson', 0).recoil
        let t = 0
        for (let i = 0; i < 30; i++) {
            r.kick(t, 'smg', true, amount, 0.5)
            for (let k = 0; k < 5; k++) {
                t += 1 / 60
                r.update(1 / 60, t)
            }
        }
        expect(r.pitch).toBeGreaterThan(amount * 3)
        expect(r.pitch).toBeLessThanOrEqual(DF_RECOIL.smg.cap * 1.2)
        let min = Infinity
        for (let k = 0; k < 120; k++) {
            t += 1 / 60
            r.update(1 / 60, t)
            min = Math.min(min, r.pitch)
        }
        expect(min).toBeGreaterThanOrEqual(0)
        expect(r.pitch).toBeLessThan(0.002)
    })

    it('lands a kick quickly, so the next shot already aims higher', () => {
        const r = new DfRecoil()
        r.kick(0, 'rifle', false, 0.06, 0.5)
        for (let k = 0; k < 6; k++) r.update(1 / 60, (k + 1) / 60)
        expect(r.pitch).toBeGreaterThan(0.06 * 0.8)
    })

    it('follows the same pattern for the same burst', () => {
        const a = new DfRecoil()
        const b = new DfRecoil()
        const path = (r: DfRecoil) => {
            const out: number[] = []
            for (let i = 0; i < 10; i++) {
                r.kick(i * 0.1, 'lmg', true, 0.03, 0.5)
                r.update(0.1, i * 0.1 + 0.05)
                out.push(Math.round(r.yaw * 1e5))
            }
            return out
        }
        expect(path(a)).toEqual(path(b))
    })

    it('credits pulling down against the climb', () => {
        const r = new DfRecoil()
        r.kick(0, 'pistol', false, 0.05, 0.5)
        for (let k = 0; k < 10; k++) r.update(1 / 60, (k + 1) / 60)
        const before = r.pitch
        const back = r.compensate(0.02)
        expect(back).toBeCloseTo(0.02)
        expect(r.pitch).toBeCloseTo(before - 0.02)
        expect(r.compensate(1)).toBeCloseTo(before - 0.02)
        expect(r.pitch).toBe(0)
        expect(r.compensate(0.01)).toBe(0)
    })
})

describe('movement', () => {
    // a straight flight of 0.5 m steps with 1 m treads, rising toward -z
    const solids: DfMapDef['solids'] = [{ min: { x: -10, y: -1, z: -20 }, max: { x: 10, y: 0, z: 10 }, mat: 'mud' }]
    for (let i = 0; i < 6; i++) solids.push({ min: { x: -2, y: 0, z: -2 - (i + 1) }, max: { x: 2, y: (i + 1) * 0.5, z: -2 - i }, mat: 'wood' })
    solids.push({ min: { x: -2, y: 0, z: -15 }, max: { x: 2, y: 3, z: -8 }, mat: 'wood' })
    const world = dfCollisionFromSolids(solids)
    const speeds: DfMoveSpeeds = { walk: DF_PLAYER.walkSpeed, sprint: DF_PLAYER.sprintSpeed, crouch: DF_PLAYER.crouchSpeed, ads: DF_PLAYER.adsSpeed, sprintDuration: 4 }
    const intent = (o: Partial<DfMoveIntent> = {}): DfMoveIntent => ({ fwd: 1, right: 0, sprint: false, crouch: false, jump: false, ads: 0, ...o })

    /** Walks the stairs with physics at 60 Hz and the camera rendered at `hz`, like the engine's loop. */
    function walkStairs(hz: number, from: { x: number, y: number, z: number }, fwd: number, seconds: number) {
        const pc = new DfPlayerController()
        pc.teleport(from)
        let acc = 0
        let t = 0
        const dt = 1 / hz
        const eyes: number[] = []
        for (let f = 0; f < seconds * hz; f++) {
            acc += dt
            t += dt
            while (acc >= DF_STEP) {
                pc.step(DF_STEP, t, intent({ fwd }), world, speeds)
                acc -= DF_STEP
            }
            const a = acc / DF_STEP
            const ry = pc.prev.y + (pc.pos.y - pc.prev.y) * a
            const rx = pc.prev.x + (pc.pos.x - pc.prev.x) * a
            const rz = pc.prev.z + (pc.pos.z - pc.prev.z) * a
            eyes.push(pc.viewFloor(world, rx, ry, rz, dt) + pc.eyeHeight())
        }
        return { pc, eyes }
    }

    function stats(eyes: number[], dt: number) {
        let maxRise = 0
        let maxDrop = 0
        let maxAccel = 0
        for (let i = 1; i < eyes.length; i++) {
            const d = eyes[i]! - eyes[i - 1]!
            maxRise = Math.max(maxRise, d)
            maxDrop = Math.max(maxDrop, -d)
            if (i > 1) maxAccel = Math.max(maxAccel, Math.abs(d - (eyes[i - 1]! - eyes[i - 2]!)) / (dt * dt))
        }
        return { maxRise, maxDrop, maxAccel }
    }

    for (const hz of [60, 144]) {
        it(`climbs stairs with a smooth, never-dipping eye at ${hz} Hz`, () => {
            const { pc, eyes } = walkStairs(hz, { x: 0, y: 0, z: 0 }, 1, 3)
            expect(pc.pos.y).toBeCloseTo(3, 1)
            const st = stats(eyes, 1 / hz)
            expect(st.maxDrop).toBeLessThan(1e-3)
            // no step pops: the eye moves at most about walking pace per frame (a raw step is 50 cm)
            expect(st.maxRise).toBeLessThan((DF_PLAYER.walkSpeed * 1.2) / hz + 0.01)
            // ends level with the top
            expect(eyes[eyes.length - 1]!).toBeCloseTo(3 + DF_PLAYER.eyeHeight, 1)
        })

        it(`walks down stairs without pops at ${hz} Hz`, () => {
            // start on the landing at the top facing down (+z is backwards: walk with fwd -1)
            const { pc, eyes } = walkStairs(hz, { x: 0, y: 3, z: -8.5 }, -1, 3.5)
            expect(pc.pos.y).toBeCloseTo(0, 1)
            const st = stats(eyes, 1 / hz)
            expect(st.maxRise).toBeLessThan(1e-3)
            expect(st.maxDrop).toBeLessThan((DF_PLAYER.walkSpeed * 1.2) / hz + 0.01)
        })
    }

    it('walks off quickly but builds into a sprint', () => {
        const pc = new DfPlayerController()
        pc.teleport({ x: 0, y: 0, z: 5 })
        pc.yaw = Math.PI / 2 // face -x, along the flat
        let walkAt = -1
        for (let i = 0; i < 60; i++) {
            pc.step(DF_STEP, i * DF_STEP, intent(), world, speeds)
            if (walkAt < 0 && pc.speed >= DF_PLAYER.walkSpeed * 0.95) walkAt = i
        }
        expect(walkAt).toBeLessThan(8)
        let sprintAt = -1
        for (let i = 0; i < 60; i++) {
            pc.step(DF_STEP, (60 + i) * DF_STEP, intent({ sprint: true }), world, speeds)
            if (sprintAt < 0 && pc.speed >= DF_PLAYER.sprintSpeed * 0.95) sprintAt = i
        }
        expect(sprintAt).toBeGreaterThan(4)
        expect(sprintAt).toBeLessThan(15)
    })

    it('eases the head bob in and out and steps on its rhythm', () => {
        const pc = new DfPlayerController()
        pc.teleport({ x: 0, y: 0, z: 5 })
        pc.yaw = Math.PI / 2
        let first = -1
        let peak = 0
        let prev = 0
        let steps = 0
        for (let i = 0; i < 120; i++) {
            const moving = i < 90
            pc.step(DF_STEP, i * DF_STEP, intent({ fwd: moving ? 1 : 0 }), world, speeds)
            const b = pc.headBob(DF_STEP, DF_PLAYER.walkSpeed, 0)
            if (first < 0) first = Math.abs(b.y)
            peak = Math.max(peak, Math.abs(b.y))
            prev = b.y
            if (b.step) steps++
        }
        // starts from nothing, stays gentle (under 2 cm)
        expect(first).toBeLessThan(0.002)
        expect(peak).toBeLessThan(0.02)
        // ~1.5 s of walking at 4.4 m/s over a 1.7 m stride: two steps a stride
        expect(steps).toBeGreaterThanOrEqual(6)
        expect(steps).toBeLessThanOrEqual(9)
        expect(Math.abs(prev)).toBeLessThan(0.004)
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
