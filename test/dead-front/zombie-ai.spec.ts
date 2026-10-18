import { describe, expect, it } from 'vitest'
import { DF_PLAYER } from '#shared/utils/dead-front/constants'
import { DF_BLOATER, DF_BRUTE_CHARGE, DF_ENEMIES, DF_GHOUL_LUNGE } from '#shared/utils/dead-front/enemies'
import type { DfMapDef } from '#shared/utils/dead-front/map'
import type { DfEvent } from '#shared/utils/dead-front/protocol'
import type { Vec3 } from '#shared/utils/dead-front/types'
import { DfMatchSim } from '#server/utils/dead-front/sim'
import type { SimZombie } from '#server/utils/dead-front/sim-types'

// Zombie behaviour on a flat test field: fair swipes, the special attacks'
// tells and dodges, flanking, and stuck recovery that nobody sees.

const spot = (id: string, x: number, z: number) => ({ id, pos: { x, y: 0, z }, yaw: 0, zone: 'a' })

const MAP: DfMapDef = {
    id: 'ai-test',
    name: 'AI Test',
    bounds: { min: { x: -60, y: -1, z: -60 }, max: { x: 60, y: 12, z: 60 } },
    startZone: 'a',
    playerSpawns: [{ x: 0, y: 0, z: 0 }, { x: 1.5, y: 0, z: 0 }],
    solids: [
        { min: { x: -60, y: -1, z: -60 }, max: { x: 60, y: 0, z: 60 }, mat: 'mud' },
        // a wall to hide behind, far to the west
        { min: { x: -42, y: 0, z: -6 }, max: { x: -40, y: 4, z: 6 }, mat: 'stone' }
    ],
    zones: [{ id: 'a', name: 'A' }],
    doors: [],
    barricades: [],
    wallBuys: [],
    perks: [],
    boxSpots: [spot('box-0', 30, 30)],
    pap: spot('pap', -30, 30),
    power: spot('power', 30, -30),
    egg: { fuses: [], generator: spot('gen', -30, -30), pedestal: spot('ped', 0, -30), chargeRadius: 6 },
    riserSpawns: [spot('riser', 50, 50)],
    nav: { nodes: [{ id: 0, pos: { x: 0, y: 0, z: 0 }, zone: 'a' }], links: [] },
    lights: []
}

function makeSim(players = 1) {
    let sim: DfMatchSim | null = null
    sim = new DfMatchSim(Array.from({ length: players }, (_, i) => ({ userId: `u${i}`, name: `u${i}`, startWeapon: 'm1911' as const, attachments: {}, perkMods: {} })), {
        map: MAP,
        now: () => sim?.time ?? 0,
        startDelay: 1000
    })
    sim.dev(0, { k: 'hold', on: true })
    return sim
}

/** Steps the sim, holding players where `place` puts them each tick; returns the damage events. */
function run(sim: DfMatchSim, seconds: number, place?: (t: number) => void): Extract<DfEvent, { k: 'zhit' }>[] {
    const hits: Extract<DfEvent, { k: 'zhit' }>[] = []
    for (let t = 0; t < seconds; t += 0.05) {
        place?.(t)
        for (const p of sim.players) p.health = p.effects.maxHealth
        sim.step(0.05)
        for (const e of sim.snapshot().events) if (e.k === 'zhit') hits.push(e)
    }
    return hits
}

function put(sim: DfMatchSim, pid: number, pos: Vec3): void {
    sim.player(pid)!.pos = { ...pos }
}

describe('zombie swipes', () => {
    it('land on a player who stands still', () => {
        const sim = makeSim()
        put(sim, 0, { x: 0, y: 0, z: 0 })
        sim.debugSpawn('shambler', { x: 0, y: 0, z: 1.2 })
        expect(run(sim, 1.2, () => put(sim, 0, { x: 0, y: 0, z: 0 })).length).toBeGreaterThan(0)
    })

    it('whiff when the player backs off during the windup', () => {
        const sim = makeSim()
        put(sim, 0, { x: 0, y: 0, z: 0 })
        const z = sim.debugSpawn('shambler', { x: 0, y: 0, z: 1.2 })
        let swingAt = -1
        let t = 0
        // one swing: it resolves after the windup, long before the shambler could close in again
        const hits = run(sim, DF_ENEMIES.shambler.windup + 0.4, (dt) => {
            t = dt
            if (swingAt < 0 && z.state === 'attack') swingAt = t
            // back-pedal at walking pace, reacting 0.15 s after the swing starts
            const back = swingAt >= 0 ? Math.max(0, Math.min(t - swingAt - 0.15, DF_ENEMIES.shambler.windup)) * DF_PLAYER.walkSpeed * 0.85 : 0
            put(sim, 0, { x: 0, y: 0, z: -back })
        })
        expect(swingAt).toBeGreaterThanOrEqual(0)
        expect(hits.length).toBe(0)
    })
})

describe('ghoul leap', () => {
    function setup() {
        const sim = makeSim()
        put(sim, 0, { x: 0, y: 0, z: 0 })
        const g = sim.debugSpawn('ghoul', { x: 0, y: 0, z: 4.5 })
        g.gait = 'sprint'
        g.speed = DF_ENEMIES.ghoul.speeds.sprint
        g.lungeReadyAt = 0
        return { sim, g }
    }

    it('crouches with a readable tell, then leaps and connects', () => {
        const { sim, g } = setup()
        sim.step(0.05)
        expect(g.state).toBe('lunge')
        expect(sim.snapshot().zombies.find(z => z.id === g.id)?.tell).toBe('lunge')
        const hits = run(sim, DF_GHOUL_LUNGE.windup + 0.8, () => put(sim, 0, { x: 0, y: 0, z: 0 }))
        expect(hits.length).toBe(1)
        expect(hits[0]!.dmg).toBe(DF_ENEMIES.ghoul.damage)
    })

    it('flies past a player who side-steps during the crouch', () => {
        const { sim, g } = setup()
        sim.step(0.05)
        expect(g.state).toBe('lunge')
        let t0 = -1
        const hits = run(sim, DF_GHOUL_LUNGE.windup + 0.7, (t) => {
            if (t0 < 0) t0 = t
            // a quick strafe once the crouch is half done
            const k = Math.max(0, t - t0 - DF_GHOUL_LUNGE.windup * 0.5)
            put(sim, 0, { x: Math.min(2.2, k * DF_PLAYER.walkSpeed), y: 0, z: 0 })
        })
        expect(hits.length).toBe(0)
    })
})

describe('brute charge', () => {
    function setup() {
        const sim = makeSim()
        put(sim, 0, { x: 0, y: 0, z: 0 })
        const b = sim.debugSpawn('brute', { x: 0, y: 0, z: 10 })
        b.chargeReadyAt = 0
        return { sim, b }
    }

    it('roars first, then runs the line and hits hard', () => {
        const { sim, b } = setup()
        sim.step(0.05)
        expect(b.state).toBe('charge')
        expect(sim.snapshot().zombies.find(z => z.id === b.id)?.tell).toBe('charge')
        const hits = run(sim, DF_BRUTE_CHARGE.windup + DF_BRUTE_CHARGE.maxTime, () => put(sim, 0, { x: 0, y: 0, z: 0 }))
        expect(hits.length).toBe(1)
        expect(hits[0]!.dmg).toBe(DF_BRUTE_CHARGE.damage)
    })

    it('thunders past a player who steps out of the line, then stands winded', () => {
        const { sim, b } = setup()
        sim.step(0.05)
        let dodged = false
        let winded = false
        const hits = run(sim, DF_BRUTE_CHARGE.windup + DF_BRUTE_CHARGE.maxTime + 0.3, () => {
            // once the charge is under way, step 2 m to the side
            if (b.dash) dodged = true
            put(sim, 0, { x: dodged ? 2.2 : 0, y: 0, z: 0 })
            if (b.state === 'stagger') winded = true
        })
        expect(dodged).toBe(true)
        expect(hits.length).toBe(0)
        expect(winded).toBe(true)
    })
})

describe('bloater spit', () => {
    it('lobs at where you stood: moving away after the throw dodges it', () => {
        const sim = makeSim()
        put(sim, 0, { x: 0, y: 0, z: 0 })
        const z = sim.debugSpawn('bloater', { x: 0, y: 0, z: 10 })
        z.spitReadyAt = 0
        let released = false
        const hits = run(sim, DF_BLOATER.spitWindup + 2, () => {
            if (sim.projectiles.some(p => p.kind === 'spit')) released = true
            put(sim, 0, { x: released ? 3.5 : 0, y: 0, z: 0 })
        })
        expect(released).toBe(true)
        expect(hits.length).toBe(0)
    })

    it('hits a player who stays put', () => {
        const sim = makeSim()
        put(sim, 0, { x: 0, y: 0, z: 0 })
        const z = sim.debugSpawn('bloater', { x: 0, y: 0, z: 10 })
        z.spitReadyAt = 0
        const hits = run(sim, DF_BLOATER.spitWindup + 2, () => put(sim, 0, { x: 0, y: 0, z: 0 }))
        expect(hits.length).toBeGreaterThan(0)
    })
})

describe('hunting', () => {
    it('flankers swing wide of the straight line and still arrive', () => {
        const sim = makeSim()
        put(sim, 0, { x: 0, y: 0, z: 0 })
        const z = sim.debugSpawn('shambler', { x: 0, y: 0, z: 12 })
        z.flank = 1.1
        let maxSide = 0
        let arrived = false
        for (let t = 0; t < 20 && !arrived; t += 0.05) {
            put(sim, 0, { x: 0, y: 0, z: 0 })
            sim.step(0.05)
            maxSide = Math.max(maxSide, Math.abs(z.pos.x))
            if (Math.hypot(z.pos.x, z.pos.z) < DF_ENEMIES.shambler.attackRange + DF_PLAYER.radius + 0.1) arrived = true
        }
        expect(maxSide).toBeGreaterThan(1.2)
        expect(arrived).toBe(true)
    })

    it('a crowd fans out around the player instead of stacking', () => {
        const sim = makeSim()
        put(sim, 0, { x: 0, y: 0, z: 0 })
        const zs: SimZombie[] = []
        for (let i = 0; i < 8; i++) {
            const z = sim.debugSpawn('shambler', { x: (i % 4) * 0.4 - 0.6, y: 0, z: 12 + Math.floor(i / 4) * 0.5 })
            z.flank = i % 3 === 0 ? 0 : (i % 2 ? 1 : -1) * 0.9
            z.attackReadyAt = 1e9 // just gather, no swings
            zs.push(z)
        }
        run(sim, 12, () => put(sim, 0, { x: 0, y: 0, z: 0 }))
        // angular coverage around the player and no overlapping bodies
        const sectors = new Set(zs.map(z => Math.floor(((Math.atan2(z.pos.x, z.pos.z) + Math.PI) / (Math.PI * 2)) * 8) % 8))
        expect(sectors.size).toBeGreaterThanOrEqual(3)
        for (let i = 0; i < zs.length; i++) {
            for (let j = i + 1; j < zs.length; j++) {
                expect(Math.hypot(zs[i]!.pos.x - zs[j]!.pos.x, zs[i]!.pos.z - zs[j]!.pos.z)).toBeGreaterThan(0.45)
            }
        }
    })

    it('keeps its target when two players are about as close', () => {
        const sim = makeSim(2)
        put(sim, 0, { x: -3, y: 0, z: 0 })
        put(sim, 1, { x: 3, y: 0, z: 0 })
        const z = sim.debugSpawn('shambler', { x: 0.2, y: 0, z: 10 })
        z.speed = 0.01
        const seen = new Set<number>()
        for (let t = 0; t < 4; t += 0.05) {
            put(sim, 0, { x: -3, y: 0, z: Math.sin(t * 3) * 0.4 })
            put(sim, 1, { x: 3, y: 0, z: Math.cos(t * 3) * 0.4 })
            sim.step(0.05)
            if (z.target >= 0) seen.add(z.target)
        }
        expect(seen.size).toBe(1)
    })
})

describe('stuck recovery', () => {
    function stuck(sim: DfMatchSim, at: Vec3): SimZombie {
        const z = sim.debugSpawn('shambler', at)
        z.stuckTime = 8
        z.unreachableTime = 0
        z.stuckCheckAt = 0
        z.stuckRef = { ...at }
        return z
    }

    it('recycles a hopelessly stuck zombie nobody can see', () => {
        const sim = makeSim()
        put(sim, 0, { x: -30, y: 0, z: 0 })
        const z = stuck(sim, { x: -45, y: 0, z: 0 }) // behind the wall
        sim['checkStuck'](z, sim.players)
        expect(sim.zombies.includes(z)).toBe(false)
    })

    it('keeps one in plain view a while longer', () => {
        const sim = makeSim()
        put(sim, 0, { x: -30, y: 0, z: 0 })
        const z = stuck(sim, { x: -25, y: 0, z: 0 })
        sim['checkStuck'](z, sim.players)
        expect(sim.zombies.includes(z)).toBe(true)
    })
})
