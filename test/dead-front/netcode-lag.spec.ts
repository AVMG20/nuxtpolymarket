import { describe, expect, it, vi } from 'vitest'
import { DF_INTERP_DELAY_MS, DF_PLAYER } from '#shared/utils/dead-front/constants'
import type { DfMapDef } from '#shared/utils/dead-front/map'
import type { DfPlayerSnap, DfSnapshot, DfZombieSnap } from '#shared/utils/dead-front/protocol'
import type { DfWeaponId, Vec3 } from '#shared/utils/dead-front/types'
import { dfWeaponStats } from '#shared/utils/dead-front/weapons'
import { DfMatch } from '#server/utils/dead-front/match'
import { DfMatchSim } from '#server/utils/dead-front/sim'
import {
    DF_MAX_ZOMBIE_EXTRAPOLATE, DfSnapBuffer, DfZombieSmoother, dfEaseDelay, dfInterpPlayer, dfInterpZombies, dfNewInterpPlayer, dfNewSample,
    dfPredictionSettled
} from '../../app/utils/dead-front/engine/interp'
import { dfSmoothRtt } from '../../app/utils/dead-front/net'

// The production link: 40-90 ms round trip with jitter and regular 300 ms
// spikes (TCP: everything sent during a stall lands at once when it ends).
// Client side, zombies and remote players must neither snap nor freeze;
// server side, the burst of stale reports a spike releases must not cost the
// player a snap-back, a refused shot or an unfair swipe.

function rng(seed: number) {
    let r = seed
    return () => {
        r = (r * 16807) % 2147483647
        return r / 2147483647
    }
}

/** One-way delivery times (ms) for messages sent every `intervalMs`: base + jitter, held back by stalls. */
function deliveries(n: number, intervalMs: number, rand: () => number, link: { base: number, jitter: number, spike: number, every: number }, startMs = 1000) {
    const out: number[] = []
    let last = 0
    let spikeAt = startMs + 1500 + rand() * link.every
    for (let i = 0; i < n; i++) {
        const sent = startMs + i * intervalMs
        while (sent > spikeAt + link.spike) spikeAt += link.every * (0.7 + rand() * 0.6)
        let at = sent + link.base + rand() * link.jitter
        if (link.spike > 0 && sent >= spikeAt) at = Math.max(at, spikeAt + link.spike + link.base)
        last = Math.max(last, at)
        out.push(last)
    }
    return out
}

describe('client interpolation through lag spikes', () => {
    /**
     * A ghoul circling at 6 m/s (the hardest case for dead-reckoning) and a
     * teammate on the same path, 20 Hz snapshots over the link, drawn at
     * 144 Hz through the engine's pipeline.
     */
    function run(seed: number, link: { base: number, jitter: number, spike: number, every: number }) {
        const rand = rng(seed)
        const speed = 6
        const radius = 5
        const truth = (t: number) => ({ x: Math.cos((t * speed) / radius) * radius, z: Math.sin((t * speed) / radius) * radius })
        const vel = (t: number) => ({ x: -Math.sin((t * speed) / radius) * speed, y: 0, z: Math.cos((t * speed) / radius) * speed })
        const n = 600
        const times = deliveries(n, 50, rand, link)
        const arrivals = times.map((at, i) => {
            const t = i * 0.05
            const p = truth(t)
            const z: DfZombieSnap = { id: 1, type: 'ghoul', pos: { x: p.x, y: 0, z: p.z }, yaw: 0, hp: 1, anim: 'run', vel: vel(t) }
            const pl = { pid: 1, pos: { x: p.x, y: 0, z: p.z }, yaw: 0, pitch: 0, flags: 0 } as unknown as DfPlayerSnap
            return { at, s: { time: t, zombies: [z], players: [pl], projectiles: [] } as unknown as DfSnapshot }
        })
        const b = new DfSnapBuffer()
        const sm = new DfZombieSmoother()
        const pool: DfZombieSnap[] = []
        const out: DfZombieSnap[] = []
        const ip = dfNewInterpPlayer()
        const ps = dfNewSample()
        let zd = DF_INTERP_DELAY_MS * 0.6
        let pd: number = DF_INTERP_DELAY_MS
        const m = {
            z: { prev: null as Vec3 | null, prevV: null as Vec3 | null, dv: 0, err: 0, freeze: 0 },
            p: { prev: null as Vec3 | null, prevV: null as Vec3 | null, dv: 0, err: 0, freeze: 0 }
        }
        let minRate = Infinity
        let maxRate = 0
        let maxZd = 0
        let prevT: number | null = null
        const dt = 1 / 144
        for (let now = 1000; now < 1000 + n * 50 - 500; now += dt * 1000) {
            while (arrivals.length && arrivals[0]!.at <= now) b.push(arrivals.shift()!.s, now)
            if (!b.latest) continue
            zd = dfEaseDelay(zd, b.zombieDelay(50), dt)
            pd = dfEaseDelay(pd, b.targetDelay(DF_INTERP_DELAY_MS, 50), dt)
            const pt = b.renderTime(now, pd)
            const zt = b.renderTime(now, zd)
            dfInterpPlayer(b.at(pt, ps)!, 1, ip)
            dfInterpZombies(b.at(zt, undefined, DF_MAX_ZOMBIE_EXTRAPOLATE)!, pool, out)
            sm.apply(out, dt)
            const warm = now > 6000
            if (warm) {
                if (prevT !== null) {
                    const r = (zt - prevT) * 1000 / (dt * 1000)
                    minRate = Math.min(minRate, r)
                    maxRate = Math.max(maxRate, r)
                }
                maxZd = Math.max(maxZd, zd)
            }
            prevT = warm ? zt : null
            for (const [k, pos] of [['z', out[0]!.pos], ['p', ip.pos]] as const) {
                const s = m[k]
                if (warm && s.prev) {
                    const v = { x: (pos.x - s.prev.x) / dt, y: 0, z: (pos.z - s.prev.z) / dt }
                    if (Math.hypot(v.x, v.z) < speed * 0.25) s.freeze++
                    if (s.prevV) s.dv = Math.max(s.dv, Math.hypot(v.x - s.prevV.x, v.z - s.prevV.z))
                    s.prevV = v
                    const real = truth((now - 1000) / 1000)
                    s.err = Math.max(s.err, Math.hypot(pos.x - real.x, pos.z - real.z))
                }
                s.prev = { x: pos.x, y: 0, z: pos.z }
            }
        }
        return { ...m, minRate, maxRate, maxZd, jitter: b.jitter }
    }

    const links = [
        { base: 40, jitter: 30, spike: 300, every: 3000 },
        { base: 45, jitter: 25, spike: 300, every: 1500 },
        { base: 20, jitter: 20, spike: 300, every: 4000 }
    ]

    it('zombies never freeze or snap and stay close to the server through 300 ms spikes', () => {
        for (const link of links) {
            for (const seed of [7, 99, 4242]) {
                const r = run(seed, link)
                const tag = `${JSON.stringify(link)} seed ${seed}`
                // they dead-reckon through the spike: never stopped on screen
                expect(r.z.freeze, tag).toBe(0)
                // the correction after a spike slides in: no frame jumps (a snap of 10 cm in one frame is 14 m/s)
                expect(r.z.dv, tag).toBeLessThan(6)
                // spikes don't push zombies back in time: about a tick plus jitter behind
                expect(r.maxZd, tag).toBeLessThan(140)
                expect(r.z.err, tag).toBeLessThan(1.2)
                // a spike's stale burst doesn't inflate the jitter estimate
                expect(r.jitter, tag).toBeLessThan(40)
            }
        }
    })

    it('the render clock never runs backwards or visibly slow / fast after a spike', () => {
        for (const link of links) {
            for (const seed of [7, 99]) {
                const r = run(seed, link)
                expect(r.minRate, JSON.stringify(link)).toBeGreaterThan(0.85)
                expect(r.maxRate, JSON.stringify(link)).toBeLessThan(1.15)
            }
        }
    })

    it('remote players ride the spikes out without snapping', () => {
        for (const link of links) {
            for (const seed of [7, 99, 4242]) {
                const r = run(seed, link)
                const tag = `${JSON.stringify(link)} seed ${seed}`
                expect(r.p.freeze, tag).toBe(0)
                expect(r.p.dv, tag).toBeLessThan(7)
            }
        }
    })

    it('a lone spike widens the players\' delay, then it settles back', () => {
        const b = new DfSnapBuffer()
        let now = 1000
        for (let i = 0; i < 400; i++) {
            const t = i * 0.05
            now = 1000 + i * 50 + 40
            // one 300 ms stall at 5 s
            const at = i >= 100 && i < 106 ? 1000 + 106 * 50 + 40 : now
            b.push({ time: t, zombies: [], players: [], projectiles: [] } as unknown as DfSnapshot, at)
            if (i === 110) expect(b.targetDelay(100, 50)).toBeGreaterThan(300)
        }
        expect(b.zombieDelay(50)).toBeLessThan(80)
        // 15 s later it is coming back down
        expect(b.targetDelay(100, 50)).toBeLessThan(250)
    })
})

describe('client predictions on a slow line', () => {
    /**
     * A predicted kill (or points, or a buy) against the full message path:
     * inputs at 20 Hz and the shot go up, the server handles them as they land
     * and snapshots (with `ack`) come back, both directions spiking. Counts the
     * rollbacks: a snapshot that still shows the zombie alive while the rule
     * says the server has answered. The server takes every shot here.
     */
    function rollbacks(seed: number, spike: number, settled: (ackNeeded: number, ack: number, age: number) => boolean): number {
        const rand = rng(seed)
        const link = { base: 40, jitter: 30, spike, every: 1500 }
        const n = 400
        const up = deliveries(n, 50, rand, link, 1000)
        const down = deliveries(n, 50, rand, link, 1000)
        let count = 0
        for (let shotAt = 2000; shotAt < 1000 + n * 50 - 2000; shotAt += 37) {
            // the shot goes out right after the input sent before it (same ordered socket)
            const prevInput = Math.floor((shotAt - 1000) / 50)
            const ackNeeded = prevInput + 2
            const shotArrives = Math.max(up[prevInput]!, shotAt + link.base)
            for (let tick = 0; tick < n; tick++) {
                const built = 1000 + tick * 50
                const arrives = down[tick]!
                if (arrives < shotAt) continue
                if (arrives > shotAt + 2500) break
                let ack = 0
                for (let i = 0; i < n && up[i]! <= built; i++) ack = i + 1
                const alive = shotArrives > built
                if (alive && settled(ackNeeded, ack, (arrives - shotAt) / 1000)) {
                    count++
                    break
                }
            }
        }
        return count
    }

    it('never rolls back a prediction whose answer is merely late (spikes both ways)', () => {
        let before = 0
        for (const seed of [3, 17, 2024]) {
            for (const spike of [300, 700]) {
                expect(rollbacks(seed, spike, (need, ack, age) => dfPredictionSettled(need, ack, age, 80)), `seed ${seed} spike ${spike}`).toBe(0)
            }
            // the old rule (a timeout of 0.6 s + 2 round trips) rolled some back once spikes ran long
            before += rollbacks(seed, 700, (_need, _ack, age) => age > 0.6 + 0.08 * 2)
        }
        expect(before).toBeGreaterThan(0)
    })

    it('settles on the ack, and only times out when nothing gets through', () => {
        expect(dfPredictionSettled(10, 9, 2.5, 80)).toBe(false)
        expect(dfPredictionSettled(10, 10, 0.1, 80)).toBe(true)
        expect(dfPredictionSettled(10, 3, 3.5, 80)).toBe(true)
    })

    it('a ping caught in a spike doesn\'t move the smoothed round trip', () => {
        const samples: number[] = []
        let rtt = 0
        for (const v of [80, 85, 78, 82, 380, 81, 79, 84, 390, 80]) {
            rtt = dfSmoothRtt(rtt, samples, v)
            expect(rtt).toBeLessThan(100)
        }
        // a lasting change shows within a few pings
        for (let i = 0; i < 8; i++) rtt = dfSmoothRtt(rtt, samples, 160)
        expect(rtt).toBeGreaterThan(140)
    })
})

// ---------------------------------------------------------------- server

const spot = (id: string, x: number, z: number) => ({ id, pos: { x, y: 0, z }, yaw: 0, zone: 'a' })
const MAP = {
    id: 'flat', name: 'Flat', bounds: { min: { x: -60, y: -1, z: -60 }, max: { x: 60, y: 12, z: 60 } }, startZone: 'a',
    playerSpawns: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }],
    solids: [{ min: { x: -60, y: -1, z: -60 }, max: { x: 60, y: 0, z: 60 }, mat: 'mud' }],
    zones: [{ id: 'a', name: 'A' }], doors: [], barricades: [], wallBuys: [], perks: [],
    boxSpots: [spot('box', 50, 50)], pap: spot('pap', -50, 50), power: spot('power', 50, -50),
    egg: { fuses: [], generator: spot('gen', -50, -50), pedestal: spot('ped', 0, -50), chargeRadius: 6 },
    riserSpawns: [spot('r', 55, 55)],
    nav: { nodes: [{ id: 0, pos: { x: 0, y: 0, z: 0 }, zone: 'a' }], links: [] },
    lights: []
} as unknown as DfMapDef

function coop(weapon: DfWeaponId = 'm1911') {
    let clock = 100
    const sim = new DfMatchSim([0, 1].map(i => ({ userId: `u${i}`, name: `u${i}`, startWeapon: weapon, attachments: {}, perkMods: {} })), { map: MAP, now: () => clock, startDelay: 1000 })
    sim.dev(0, { k: 'hold', on: true })
    const seqs = [0, 0]
    return {
        sim,
        get clock() {
            return clock
        },
        /** Advances the server clock (and the simulation, in 50 ms steps). */
        run(ms: number, step = true) {
            for (let t = 0; t < ms - 1e-6; t += 50) {
                clock += 0.05
                if (step) sim.step(0.05)
            }
        },
        input(pid: number, pos: Vec3, rtt = 80) {
            sim.input(pid, { seq: ++seqs[pid]!, pos, yaw: 0, pitch: 0, flags: 0, rtt })
        }
    }
}

describe('server under a lag spike', () => {
    it('acks a remounted game view from its own first input, not the old one', () => {
        const sim = new DfMatchSim([{ userId: 'u', name: 'u', attachments: {}, perkMods: {} }], { startDelay: 1000 })
        for (let seq = 1; seq <= 500; seq++) sim.input(0, { seq, pos: sim.player(0)!.pos, yaw: 0, pitch: 0, flags: 0 })
        expect(sim.ack(0)).toBe(500)
        sim.setConnected(0, false)
        sim.setConnected(0, true)
        // the new engine counts from 1: until then nothing it predicts is acked
        expect(sim.ack(0)).toBe(0)
        sim.input(0, { seq: 1, pos: sim.player(0)!.pos, yaw: 0, pitch: 0, flags: 0 })
        expect(sim.ack(0)).toBe(1)
    })

    it('takes the burst of movement reports a spike releases without a snap-back', () => {
        for (const stall of [300, 700]) {
            const c = coop()
            const p = c.sim.player(0)!
            const v = DF_PLAYER.sprintSpeed
            let x = 0
            for (let i = 0; i < 20; i++) {
                c.run(50, false)
                x += v * 0.05
                c.input(0, { x, y: 0, z: 0 })
            }
            const tp = p.tp
            // the stall: nothing arrives, then every report sent meanwhile lands at once
            c.run(stall, false)
            const queued: number[] = []
            for (let t = 0; t < stall; t += 50) queued.push(x += v * 0.05)
            for (const qx of queued) c.input(0, { x: qx, y: 0, z: 0 })
            expect(p.tp, `${stall} ms`).toBe(tp)
            // the server never falls far enough behind for the client to ease back (1.5 m)
            expect(x - p.pos.x, `${stall} ms`).toBeLessThan(1.5)
            for (let i = 0; i < 10; i++) {
                c.run(50, false)
                x += v * 0.05
                c.input(0, { x, y: 0, z: 0 })
            }
            expect(Math.abs(x - p.pos.x), `${stall} ms`).toBeLessThan(0.05)
        }
    })

    it('a zombie swipe waits for reports fresher than the spike: a step back made during it dodges', () => {
        const swing = (stepBack: boolean) => {
            const c = coop()
            c.sim['devHold'] = false
            const p = c.sim.player(0)!
            c.sim.player(1)!.pos = { x: 40, y: 0, z: 40 }
            c.input(0, { x: 0, y: 0, z: 0 })
            c.input(1, { x: 40, y: 0, z: 40 })
            const z = c.sim.debugSpawn('shambler', { x: 0, y: 0, z: 1 }, 1e6)
            z.state = 'hunt'
            z.inside = true
            const hp = p.health
            // the windup runs while reports flow; just before the arm comes down player 0's line
            // stalls for 300 ms, and on their screen they step back 2 m as it starts
            c.sim['beginAttack'](z, p, 'hunt')
            for (let t = 0; t < 400; t += 50) {
                c.run(50)
                c.input(0, { x: 0, y: 0, z: 0 })
                c.input(1, { x: 40, y: 0, z: 40 })
            }
            const at = stepBack ? { x: 0, y: 0, z: -2 } : { x: 0, y: 0, z: 0 }
            for (let t = 0; t < 300; t += 50) {
                c.run(50)
                c.input(1, { x: 40, y: 0, z: 40 })
            }
            // the stall ends: the queued reports land at once
            for (let i = 0; i < 6; i++) c.input(0, at)
            for (let t = 0; t < 600; t += 50) {
                c.run(50)
                c.input(0, at)
                c.input(1, { x: 40, y: 0, z: 40 })
            }
            return hp - p.health
        }
        expect(swing(false)).toBeGreaterThan(0)
        expect(swing(true)).toBe(0)
    })

    it('takes every shot of a full-auto burst that lands at once after a spike', () => {
        const c = coop('mp18')
        const p = c.sim.player(0)!
        const w = p.weapons[0]!
        w.mag = w.stats.magSize
        w.reserve = 500
        const z = c.sim.debugSpawn('brute', { x: 0, y: 0, z: -8 }, 1e9)
        const origin = { x: 0, y: DF_PLAYER.eyeHeight, z: 0 }
        const dir = { x: 0, y: -0.05, z: -1 }
        const interval = 60 / dfWeaponStats('mp18', 0).rpm
        const fire = () => c.sim.fire(0, { origin, dirs: [dir], hits: [{ z: z.id, zone: 'body', dist: 8 }], mag: w.mag - 1 })
        let accepted = 0
        let sent = 0
        // a second of steady fire
        for (let t = 0; t < 1; t += interval) {
            c.run(interval * 1000, false)
            if (fire()) accepted++
            sent++
        }
        // 300 ms stall, then the queued shots all at once
        c.run(300, false)
        for (let t = 0; t < 0.3; t += interval) {
            if (fire()) accepted++
            sent++
        }
        expect(accepted).toBe(sent)
    })

    it('a claim aimed where a sprinting ghoul was 400 ms ago still counts', () => {
        const c = coop()
        const z = c.sim.debugSpawn('ghoul', { x: 0, y: 0, z: -10 }, 1e6)
        z.curSpeed = 6
        // the client saw it 2.4 m back along its run
        const seen = { x: 2.4, y: 1.1, z: -10 }
        const origin = { x: 0, y: DF_PLAYER.eyeHeight, z: 0 }
        const d = { x: seen.x - origin.x, y: seen.y - origin.y, z: seen.z - origin.z }
        const l = Math.hypot(d.x, d.y, d.z)
        const hp = z.hp
        c.sim.fire(0, { origin, dirs: [{ x: d.x / l, y: d.y / l, z: d.z / l }], hits: [{ z: z.id, zone: 'body', dist: l }] })
        expect(z.hp).toBeLessThan(hp)
    })
})

describe('server tick loop', () => {
    it('keeps an exact sim clock through a 300 ms host stall without bursting snapshots', async () => {
        vi.useFakeTimers()
        try {
            const frames: string[] = []
            const profile = {
                unlockedWeapons: ['m1911'], weaponXp: {}, loadout: { startWeapon: 'm1911', attachments: {} }, researchPerk: null,
                perkXp: {}, perkMods: {}, gamesPlayed: 0, bestRound: 0, totalKills: 0, eggsCompleted: 0
            } as const
            // co-op, so the solo stall hold doesn't freeze the world over the stall
            const match = await DfMatch.create([{ userId: 'a', name: 'A' }, { userId: 'b', name: 'B' }], {
                send: (_u, f) => frames.push(f),
                onPlayerGone: () => {},
                onFinished: () => {},
                loadProfile: async () => structuredClone(profile) as never,
                applyResult: async () => ({ perk: null, perkXpGained: 0, perkLevelBefore: 0, perkLevelAfter: 0, weaponXpGained: {}, weaponLevelsUp: {}, newWeapons: [] })
            })
            match.handle('a', { t: 'in', seq: 1, pos: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, flags: 0 })
            let seq = 1
            const keepAlive = setInterval(() => match.handle('a', { t: 'in', seq: ++seq, pos: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, flags: 0 }), 50)
            vi.advanceTimersByTime(1000)
            const t0 = match.sim.time
            const n0 = frames.length
            // the host stalls 300 ms (a GC pause): no callback runs meanwhile
            vi.setSystemTime(Date.now() + 300)
            vi.advanceTimersByTime(2000)
            clearInterval(keepAlive)
            // 2.3 s of wall time is 2.3 s of simulation: no time lost to the stall
            expect(match.sim.time - t0).toBeCloseTo(2.3, 1)
            // one snapshot per callback per player, never a burst
            expect(frames.length - n0).toBeLessThanOrEqual(2 * 41)
            await match.finish()
        } finally {
            vi.useRealTimers()
        }
    })
})
