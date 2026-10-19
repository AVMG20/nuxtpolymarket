import { describe, expect, it } from 'vitest'
import { dfKillClaimHonoured } from '#shared/utils/dead-front/combat'
import type { DfMapDef } from '#shared/utils/dead-front/map'
import { dfCollisionFromSolids, dfRampHeight } from '#shared/utils/dead-front/physics'
import type { DfSnapshot, DfZombieSnap } from '#shared/utils/dead-front/protocol'
import { DfMatchSim, dfZombieViewY } from '#server/utils/dead-front/sim'
import { DfSnapBuffer, DfZombieSmoother, dfCriticalSpring, dfInterpZombies } from '../../app/utils/dead-front/engine/interp'

// Zombie motion on clients (dead-reckoning, smoothing, stair heights) and the
// rules the client's kill prediction leans on.

const zsnap = (id: number, x: number, y: number, z: number, vel = { x: 0, y: 0, z: 0 }): DfZombieSnap => ({ id, type: 'shambler', pos: { x, y, z }, yaw: 0, hp: 1, anim: 'walk', vel })

function snap(time: number, zombies: DfZombieSnap[]): DfSnapshot {
    return { time, zombies, players: [], projectiles: [] } as unknown as DfSnapshot
}

describe('zombie dead-reckoning', () => {
    it('extrapolates along the reported velocity past the newest snapshot', () => {
        const b = new DfSnapBuffer()
        b.push(snap(1, [zsnap(1, 0, 0, 0, { x: 2, y: 0, z: 0 })]), 1000)
        b.push(snap(1.05, [zsnap(1, 0.1, 0, 0, { x: 2, y: 0, z: 0 })]), 1050)
        const s = b.at(1.15)!
        const out = dfInterpZombies(s, [], [])
        expect(out[0]!.pos.x).toBeCloseTo(0.3, 2)
    })

    it('renders zombies on a shorter delay than players', () => {
        const b = new DfSnapBuffer()
        for (let i = 0; i < 60; i++) b.push(snap(i * 0.05, []), 1000 + i * 50 + 30 + (i % 2) * 10)
        expect(b.zombieDelay(50)).toBeLessThan(b.targetDelay(100, 50))
        expect(b.zombieDelay(50)).toBeGreaterThanOrEqual(55)
    })
})

describe('zombie motion under lag and jitter', () => {
    /**
     * A ghoul circling at 6 m/s, 20 Hz snapshots arriving 50-100 ms late with
     * jitter, rendered at 144 Hz through the engine's pipeline (zombie delay,
     * dead-reckoning, smoothing). Returns the worst frame-to-frame velocity
     * change and how far the drawn zombie trails the server's.
     */
    function run(seed: number) {
        let rnd = seed
        const rand = () => {
            rnd = (rnd * 16807) % 2147483647
            return rnd / 2147483647
        }
        const speed = 6
        const radius = 5
        const truth = (t: number) => ({ x: Math.cos((t * speed) / radius) * radius, z: Math.sin((t * speed) / radius) * radius })
        const vel = (t: number) => ({ x: -Math.sin((t * speed) / radius) * speed, y: 0, z: Math.cos((t * speed) / radius) * speed })
        const arrivals: { at: number, s: DfSnapshot }[] = []
        let last = 0
        for (let i = 0; i < 200; i++) {
            const t = i * 0.05
            const p = truth(t)
            last = Math.max(last, 1000 + t * 1000 + 50 + rand() * 50)
            arrivals.push({ at: last, s: snap(t, [zsnap(1, p.x, 0, p.z, vel(t))]) })
        }
        const b = new DfSnapBuffer()
        const sm = new DfZombieSmoother()
        const pool: DfZombieSnap[] = []
        const out: DfZombieSnap[] = []
        let delay = 100
        let prev: { x: number, z: number } | null = null
        let prevV: { x: number, z: number } | null = null
        let maxDv = 0
        let maxErr = 0
        const dt = 1 / 144
        for (let now = 1000; now < 10500; now += dt * 1000) {
            while (arrivals.length && arrivals[0]!.at <= now) b.push(arrivals.shift()!.s, now)
            if (!b.latest) continue
            const target = b.zombieDelay(50)
            delay += (target - delay) * Math.min(1, dt * (target > delay ? 2 : 0.3))
            const t = b.renderTime(now, delay)
            const sample = b.at(t)
            if (!sample) continue
            dfInterpZombies(sample, pool, out)
            sm.apply(out, dt)
            const z = out[0]!
            if (now > 3000) {
                if (prev) {
                    const v = { x: (z.pos.x - prev.x) / dt, z: (z.pos.z - prev.z) / dt }
                    if (prevV) maxDv = Math.max(maxDv, Math.hypot(v.x - prevV.x, v.z - prevV.z))
                    prevV = v
                }
                const real = truth((now - 1000) / 1000)
                maxErr = Math.max(maxErr, Math.hypot(z.pos.x - real.x, z.pos.z - real.z))
            }
            prev = { x: z.pos.x, z: z.pos.z }
        }
        return { maxDv, maxErr, delay }
    }

    it('stays smooth (no visible snaps) and close to the server under 50-100 ms of jitter', () => {
        for (const seed of [7, 99, 12345]) {
            const r = run(seed)
            // velocity never jumps by more than a fraction of its speed between two frames
            expect(r.maxDv).toBeLessThan(3)
            // drawn about one tick plus the jitter margin behind the server: well under a metre
            expect(r.maxErr).toBeLessThan(1.2)
            expect(r.delay).toBeLessThan(200)
        }
    })
})

describe('DfZombieSmoother', () => {
    it('follows a zombie walking at constant speed without lag', () => {
        const sm = new DfZombieSmoother()
        const list = [zsnap(1, 0, 0, 0, { x: 3, y: 0, z: 0 })]
        const dt = 1 / 144
        for (let f = 1; f <= 144; f++) {
            const z = zsnap(1, 3 * f * dt, 0, 0, { x: 3, y: 0, z: 0 })
            list[0] = z
            sm.apply(list, dt)
            expect(Math.abs(z.pos.x - 3 * f * dt)).toBeLessThan(1e-6)
        }
    })

    it('slides a corrected extrapolation in instead of snapping', () => {
        const sm = new DfZombieSmoother()
        const dt = 1 / 60
        sm.apply([zsnap(1, 0, 0, 0)], dt)
        // the server's next snapshot puts it 30 cm off
        const z = zsnap(1, 0.3, 0, 0)
        sm.apply([z], dt)
        expect(z.pos.x).toBeGreaterThan(0)
        expect(z.pos.x).toBeLessThan(0.1)
        let x = z.pos.x
        for (let f = 0; f < 30; f++) {
            const n = zsnap(1, 0.3, 0, 0)
            sm.apply([n], dt)
            expect(n.pos.x).toBeGreaterThanOrEqual(x - 1e-9)
            x = n.pos.x
        }
        expect(x).toBeCloseTo(0.3, 2)
    })

    it('eases a stair step in height (no hop, no overshoot) and snaps a teleport', () => {
        const sm = new DfZombieSmoother()
        const dt = 1 / 144
        sm.apply([zsnap(1, 0, 0, 0)], dt)
        let y = 0
        let maxStep = 0
        for (let f = 0; f < 144; f++) {
            const z = zsnap(1, 0, 0.5, 0)
            sm.apply([z], dt)
            maxStep = Math.max(maxStep, z.pos.y - y)
            expect(z.pos.y).toBeLessThanOrEqual(0.5 + 1e-9)
            y = z.pos.y
        }
        expect(maxStep).toBeLessThan(0.05)
        expect(y).toBeCloseTo(0.5, 3)
        const far = zsnap(1, 20, 4, 0)
        sm.apply([far], dt)
        expect(far.pos).toEqual({ x: 20, y: 4, z: 0 })
    })

    it('the critical spring is stable at any frame time', () => {
        const out = { e: 0, v: 0 }
        for (const dt of [1 / 240, 1 / 60, 0.1, 0.5]) {
            dfCriticalSpring(1, 0, 18, dt, out)
            expect(out.e).toBeGreaterThanOrEqual(0)
            expect(out.e).toBeLessThanOrEqual(1)
        }
    })
})

describe('stair heights', () => {
    // 0.5 m steps with 1 m treads rising toward +x
    const solids: DfMapDef['solids'] = [{ min: { x: -10, y: -1, z: -5 }, max: { x: 20, y: 0, z: 5 }, mat: 'mud' }]
    for (let i = 0; i < 4; i++) solids.push({ min: { x: 2 + i, y: 0, z: -2 }, max: { x: 3 + i, y: (i + 1) * 0.5, z: 2 }, mat: 'wood' })
    solids.push({ min: { x: 6, y: 0, z: -2 }, max: { x: 12, y: 2, z: 2 }, mat: 'wood' })
    const world = dfCollisionFromSolids(solids)

    it('the ramp rises steadily over the steps and ignores tall walls', () => {
        let prev = dfRampHeight(world, 0, 0, 0)
        let maxJump = 0
        for (let x = 0; x <= 7; x += 0.02) {
            const floor = Math.max(0, Math.min(2, (Math.floor(x - 2) + 1) * 0.5))
            const h = dfRampHeight(world, x, 0, x < 2 ? 0 : floor)
            expect(h).toBeGreaterThanOrEqual(prev - 1e-9)
            maxJump = Math.max(maxJump, h - prev)
            prev = h
        }
        expect(maxJump).toBeLessThan(0.1)
        expect(prev).toBeCloseTo(2, 5)
        // standing beside a 2 m wall it stays on the floor
        expect(dfRampHeight(world, 5.5, 2.4, 0)).toBe(0)
    })

    it('the server shows a stepping zombie climbing, not hopping', () => {
        let y = 0
        const ys: number[] = []
        // physics lifts it 0.5 m in one tick; the shown height ramps
        for (let t = 0; t < 20; t++) {
            y = dfZombieViewY(y, 0.5, 1.2, 0.05, false)
            ys.push(y)
        }
        expect(ys[0]!).toBeLessThan(0.25)
        expect(ys[ys.length - 1]!).toBe(0.5)
        expect(dfZombieViewY(0, 3, 1, 0.05, false)).toBe(3)
        expect(dfZombieViewY(0, 0.5, 1, 0.05, true)).toBe(0.5)
    })

    it('a hunting zombie walks up the stairs with a smooth shown height', () => {
        // nav nodes up the middle of the flight, one per tread
        const NAV = [0, 1, 2.5, 3.5, 4.5, 5.5, 7, 8, 9].map((x, id) => ({ id, pos: { x, y: x < 2 ? 0 : x >= 6 ? 2 : (Math.floor(x - 2) + 1) * 0.5, z: 0 }, zone: 'a' }))
        const map: DfMapDef = {
            id: 'stairs', name: 'Stairs', bounds: { min: { x: -10, y: -1, z: -5 }, max: { x: 20, y: 10, z: 5 } }, startZone: 'a',
            playerSpawns: [{ x: 9, y: 2, z: 0 }], solids, zones: [{ id: 'a', name: 'A' }], doors: [], barricades: [], wallBuys: [], perks: [],
            boxSpots: [], pap: { id: 'pap', pos: { x: -8, y: 0, z: 4 }, yaw: 0, zone: 'a' }, power: { id: 'power', pos: { x: -8, y: 0, z: -4 }, yaw: 0, zone: 'a' },
            egg: { fuses: [], generator: { id: 'g', pos: { x: -9, y: 0, z: 0 }, yaw: 0, zone: 'a' }, pedestal: { id: 'p', pos: { x: -9, y: 0, z: 2 }, yaw: 0, zone: 'a' }, chargeRadius: 1 },
            riserSpawns: [], nav: { nodes: NAV, links: NAV.slice(1).map((n, i) => ({ a: i, b: n.id })) }, lights: []
        } as unknown as DfMapDef
        const sim = new DfMatchSim([{ userId: 'u', name: 'u', startWeapon: 'm1911', attachments: {}, perkMods: {} }], { map, now: () => 0, startDelay: 1000 })
        sim['devHold'] = true
        sim['devGod'].add(0)
        const z = sim.debugSpawn('shambler', { x: 0, y: 0, z: 0 })
        let prev = sim.snapshot().zombies[0]!.pos.y
        let maxStep = 0
        let top = 0
        for (let i = 0; i < 20 * 12; i++) {
            sim.step(0.05)
            const s = sim.snapshot().zombies.find(q => q.id === z.id)
            if (!s) break
            maxStep = Math.max(maxStep, Math.abs(s.pos.y - prev))
            prev = s.pos.y
            top = Math.max(top, s.pos.y)
        }
        // no tick shows a whole 0.5 m step at once (the physics alone would)
        expect(maxStep).toBeLessThan(0.2)
        expect(top).toBeGreaterThan(1.9)
    })
})

describe('kill claims', () => {
    it('honours a sliver, refuses a healthy zombie', () => {
        expect(dfKillClaimHonoured(0, 50, 1000)).toBe(true)
        expect(dfKillClaimHonoured(30, 50, 1000)).toBe(true)
        expect(dfKillClaimHonoured(70, 50, 1000)).toBe(true) // 7% of max
        expect(dfKillClaimHonoured(400, 50, 1000)).toBe(false)
    })
})
