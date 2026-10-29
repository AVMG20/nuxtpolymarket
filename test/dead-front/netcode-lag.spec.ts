import { describe, expect, it, vi } from 'vitest'
import { DF_PLAYER } from '#shared/utils/dead-front/constants'
import type { DfMapDef } from '#shared/utils/dead-front/map'
import type { DfWeaponId, Vec3 } from '#shared/utils/dead-front/types'
import { dfWeaponStats } from '#shared/utils/dead-front/weapons'
import { DfMatch } from '#server/utils/dead-front/match'
import { DfMatchSim } from '#server/utils/dead-front/sim'

// The production link: 40-90 ms round trip with jitter and regular 300 ms
// spikes (TCP: everything sent during a stall lands at once when it ends).
// The burst of stale reports a spike releases must not cost the player a
// snap-back, a refused shot or an unfair swipe.

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
