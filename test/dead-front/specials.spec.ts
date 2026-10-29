import { describe, expect, it } from 'vitest'
import { DF_POINTS } from '#shared/utils/dead-front/constants'
import { DF_ENEMIES, dfCrawlGeometry, dfRoundZombieCount, dfZombieHitTest } from '#shared/utils/dead-front/enemies'
import { DF_MAP, dfInteractables } from '#shared/utils/dead-front/map'
import type { DfMapDef } from '#shared/utils/dead-front/map'
import { dfMapTraps } from '#shared/utils/dead-front/map-traps'
import { dfBodyFits, dfBuildCollision } from '#shared/utils/dead-front/physics'
import type { DfEvent } from '#shared/utils/dead-front/protocol'
import {
    DF_STREAK, DF_TRAP, dfGasRoundCount, dfGasSchedule, dfInTrap, dfNewStreak, dfStreakKill, dfTrapBlocked, dfTrapPlayerDamage, dfTrapStart, dfTrapTick
} from '#shared/utils/dead-front/specials'
import type { DfTrapRun } from '#shared/utils/dead-front/specials'
import { DfMatchSim } from '#server/utils/dead-front/sim'
import type { DfPlayerSetup } from '#server/utils/dead-front/sim-types'

const setup = (userId: string): DfPlayerSetup => ({ userId, name: userId, startWeapon: 'm1911', attachments: {}, perkMods: {} })

/** Sainte-Croix with its traps (built straight from map-traps.ts). */
const TRAP_MAP: DfMapDef = { ...DF_MAP, traps: dfMapTraps() }

function makeSim(players = 1) {
    let clock = 1000
    const sim = new DfMatchSim(Array.from({ length: players }, (_, i) => setup(`u${i}`)), { map: TRAP_MAP, now: () => clock, startDelay: 1000 })
    return { sim, advance: (s: number) => { clock += s } }
}

function run(sim: DfMatchSim, seconds: number, dt = 0.05): DfEvent[] {
    const out: DfEvent[] = []
    for (let t = 0; t < seconds; t += dt) {
        sim.step(dt)
        out.push(...sim.snapshot().events)
    }
    return out
}

describe('gas rounds: schedule', () => {
    it('marks the due round and catches up after a jump', () => {
        const zero = () => 0
        expect(dfGasSchedule(4, 5, zero)).toEqual({ gas: false, next: 5 })
        expect(dfGasSchedule(5, 5, zero)).toEqual({ gas: true, next: 9 })
        // jumped from round 3 to 12: the schedule rolls forward past the skipped rounds
        expect(dfGasSchedule(12, 5, zero)).toEqual({ gas: false, next: 13 })
        expect(dfGasSchedule(13, 13, zero)).toEqual({ gas: true, next: 17 })
    })
})

describe('gas rounds: the match', () => {
    it('sends masked sprinting ghouls out of the risers and drops a Max Ammo on the last kill', () => {
        const { sim } = makeSim()
        sim.dev(0, { k: 'god', on: true })
        sim.dev(0, { k: 'special', what: 'gas' })
        sim.dev(0, { k: 'round', round: 3 })
        expect(sim.specials.gas).toBe(true)
        const normal = dfRoundZombieCount(3, 1)
        const snap0 = sim.snapshot()
        expect(snap0.zombiesLeft).toBe(dfGasRoundCount(normal))
        expect(snap0.world.special?.kind).toBe('gas')
        expect(snap0.world.special!.pockets.length).toBeGreaterThan(0)
        // let the whole pack climb out
        for (let i = 0; i < 2400 && sim.snapshot().zombiesLeft > sim.zombies.length; i++) sim.step(0.05)
        expect(sim.zombies.length).toBe(snap0.zombiesLeft)
        for (const z of sim.zombies) {
            expect(z.type).toBe('ghoul')
            expect(z.masked).toBe(true)
            expect(z.gait).toBe('sprint')
            expect(z.barricade).toBeNull()
        }
        expect(sim.snapshot().zombies.every(z => z.masked)).toBe(true)
        // the squad wipes them out with a nuke: the last kill still leaves a Max Ammo
        const p = sim.player(0)!
        sim.dropPowerup('nuke', { ...p.pos })
        sim.step(0.05)
        expect(sim.zombies.length).toBe(0)
        expect(sim.powerups.some(pu => pu.kind === 'maxammo')).toBe(true)
        // the round ends and the next one is normal again
        sim.step(0.05)
        expect(sim.phase).toBe('intermission')
        expect(sim.specials.gas).toBe(false)
        expect(sim.snapshot().world.special).toBeUndefined()
        sim.startRound()
        expect(sim.specials.gas).toBe(false)
    })
})

describe('electric traps', () => {
    const trap = TRAP_MAP.traps!.find(t => t.id === 'trap-churchyard')!
    const lever = trap.lever.pos

    it('sit in open passages with the lever reachable from the floor', () => {
        const world = dfBuildCollision(DF_MAP, new Set(DF_MAP.doors.map(d => d.id)))
        for (const t of TRAP_MAP.traps!) {
            const cx = (t.area.min.x + t.area.max.x) / 2
            const cz = (t.area.min.z + t.area.max.z) / 2
            // a zombie fits through the middle of the passage once its door is open
            expect(dfBodyFits(world, { x: cx, y: 0, z: cz }, { radius: 0.4, height: 1.8, zombie: true })).toBe(true)
            // the player stands in front of the lever
            const fx = Math.sin(t.lever.yaw)
            const fz = Math.cos(t.lever.yaw)
            expect(dfBodyFits(world, { x: t.lever.pos.x + fx * 0.9, y: 0, z: t.lever.pos.z + fz * 0.9 }, { radius: 0.35, height: 1.8 })).toBe(true)
            // and it's a use target, away from the door prompt
            const it = dfInteractables(TRAP_MAP).find(i => i.id === t.id)!
            expect(it.kind).toBe('trap')
            const door = DF_MAP.doors.find(d => d.id === t.door)!
            expect(Math.hypot(door.pos.x - it.pos.x, door.pos.z - it.pos.z)).toBeGreaterThan(2.5)
            for (const [a, b] of t.coils) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(2.5)
        }
    })

    it('rules: cost, power, run and cooldown', () => {
        const r: DfTrapRun = { state: 'idle', timer: 0, owner: -1 }
        expect(dfTrapBlocked(r, false, 5000)).toBe('power')
        expect(dfTrapBlocked(r, true, DF_TRAP.cost - 1)).toBe('points')
        expect(dfTrapBlocked(r, true, DF_TRAP.cost)).toBeNull()
        dfTrapStart(r, 2)
        expect(r).toEqual({ state: 'active', timer: DF_TRAP.active, owner: 2 })
        expect(dfTrapBlocked(r, true, 9999)).toBe('active')
        expect(dfTrapTick(r, DF_TRAP.active - 0.1)).toBeNull()
        expect(dfTrapTick(r, 0.2)).toBe('cooldown')
        expect(r.timer).toBeCloseTo(DF_TRAP.cooldown - 0.1)
        expect(dfTrapBlocked(r, true, 9999)).toBe('cooldown')
        expect(dfTrapTick(r, DF_TRAP.cooldown)).toBe('idle')
        expect(r.state).toBe('idle')
        expect(dfTrapPlayerDamage(150)).toBe(DF_TRAP.playerDamage)
        expect(dfTrapPlayerDamage(DF_TRAP.playerFloor + 3)).toBe(3)
        expect(dfTrapPlayerDamage(DF_TRAP.playerFloor)).toBe(0)
    })

    it('charges per run, refuses while live or cooling down, and needs the power', () => {
        const { sim, advance } = makeSim()
        const p = sim.player(0)!
        sim.dev(0, { k: 'points', amount: 5000 })
        sim.dev(0, { k: 'tp', pos: { x: lever.x, y: 0, z: lever.z + 1 } })
        const before = p.points
        sim.use(0, trap.id)
        expect(p.points).toBe(before)
        sim.power = true
        advance(1)
        sim.step(1)
        sim.use(0, trap.id)
        expect(p.points).toBe(before - DF_TRAP.cost)
        const ev = sim.snapshot()
        expect(ev.events).toContainEqual({ k: 'buy', p: 0, what: `trap:${trap.id}` })
        expect(ev.world.traps!.find(t => t.id === trap.id)).toMatchObject({ state: 'active' })
        // no second run while it's live or cooling down
        advance(1)
        sim.step(1)
        sim.use(0, trap.id)
        expect(p.points).toBe(before - DF_TRAP.cost)
        run(sim, DF_TRAP.active - 1 + 0.1)
        expect(sim.snapshot().world.traps!.find(t => t.id === trap.id)!.state).toBe('cooldown')
        advance(1)
        sim.use(0, trap.id)
        expect(p.points).toBe(before - DF_TRAP.cost)
        run(sim, DF_TRAP.cooldown + 0.1)
        expect(sim.snapshot().world.traps!.find(t => t.id === trap.id)!.state).toBe('idle')
        advance(1)
        sim.use(0, trap.id)
        expect(p.points).toBe(before - 2 * DF_TRAP.cost)
    })

    it('fries zombies in the passage and pays the buyer; a player in it only gets stung', () => {
        const { sim, advance } = makeSim(2)
        sim.power = true
        const buyer = sim.player(0)!
        const mate = sim.player(1)!
        sim.dev(0, { k: 'points', amount: 5000 })
        sim.dev(0, { k: 'tp', pos: { x: lever.x, y: 0, z: lever.z + 1 } })
        advance(1)
        sim.step(0.05)
        sim.use(0, trap.id)
        sim.snapshot()
        const pts = buyer.points
        const kills = buyer.kills
        const inside = { x: (trap.area.min.x + trap.area.max.x) / 2, y: 0, z: trap.area.max.z - 0.5 }
        const z = sim.debugSpawn('brute', inside, 99999)
        expect(dfInTrap(trap.area, z.pos)).toBe(true)
        // the mate walks into it
        sim.dev(1, { k: 'tp', pos: { x: inside.x + 0.8, y: 0, z: trap.area.min.z + 0.5 } })
        const events = run(sim, 4)
        expect(sim.zombies.includes(z)).toBe(false)
        expect(events).toContainEqual(expect.objectContaining({ k: 'kill', z: z.id, p: -1, weapon: 'trap' }))
        expect(buyer.points - pts).toBe(DF_TRAP.killPoints)
        expect(buyer.kills).toBe(kills + 1)
        expect(events.some(e => e.k === 'zhit' && e.p === 1)).toBe(true)
        expect(mate.life).toBe('alive')
        expect(mate.health).toBeGreaterThanOrEqual(DF_TRAP.playerFloor)
        // trap kills are not streaks
        expect(events.some(e => e.k === 'streak')).toBe(false)
    })
})

describe('crawlers', () => {
    const shambler = DF_ENEMIES.shambler
    const fwd = { x: 0, y: 0, z: 1 }

    it('hitboxes lie low along the facing', () => {
        const target = { type: 'shambler' as const, pos: { x: 0, y: 0, z: 0 }, yaw: 0, anim: 'crawl' as const }
        const g = dfCrawlGeometry('shambler')
        // a head-height shot over a crawler misses it
        expect(dfZombieHitTest(target, { x: -3, y: shambler.headY, z: 0 }, { x: 1, y: 0, z: 0 }, 20)).toBeNull()
        expect(dfZombieHitTest({ ...target, anim: 'walk' }, { x: -3, y: shambler.headY, z: 0 }, { x: 1, y: 0, z: 0 }, 20)?.zone).toBe('head')
        // its head is out front, low
        expect(dfZombieHitTest(target, { x: -3, y: g.headY, z: g.headAhead }, { x: 1, y: 0, z: 0 }, 20)?.zone).toBe('head')
        expect(g.headY).toBeLessThan(0.6)
        // the torso lies along the facing, the thighs trail behind
        expect(dfZombieHitTest(target, { x: -3, y: g.bodyY, z: 0.2 }, { x: 1, y: 0, z: 0 }, 20)?.zone).toBe('body')
        expect(dfZombieHitTest(target, { x: -3, y: g.legY, z: -0.35 }, { x: 1, y: 0, z: 0 }, 20)?.zone).toBe('limb')
        // shooting down on it from in front hits the head first
        const eye = { x: 0, y: 1.6, z: 3 }
        const aim = { x: 0, y: g.headY - 1.6, z: g.headAhead - 3 }
        const l = Math.hypot(aim.x, aim.y, aim.z)
        expect(dfZombieHitTest(target, eye, { x: aim.x / l, y: aim.y / l, z: aim.z / l }, 20)?.zone).toBe('head')
        // a crawler swiping (anim attack) keeps the low hitbox through the flag
        expect(dfZombieHitTest({ ...target, anim: 'attack', crawl: true }, { x: -3, y: 1.2, z: 0 }, { x: 1, y: 0, z: 0 }, 20)).toBeNull()
        // facing turns the body
        const east = { ...target, yaw: Math.PI / 2 }
        expect(dfZombieHitTest(east, { x: g.headAhead, y: g.headY, z: -3 }, fwd, 20)?.zone).toBe('head')
    })
})

describe('kill streaks', () => {
    it('chains kills inside the window into tiers, once each', () => {
        const st = dfNewStreak()
        expect(dfStreakKill(st, 10, false)).toEqual([])
        expect(dfStreakKill(st, 10.5, false)).toEqual([{ kind: 'double', n: 2, bonus: 50 }])
        expect(dfStreakKill(st, 11.2, false)).toEqual([{ kind: 'triple', n: 3, bonus: 50 }])
        expect(dfStreakKill(st, 11.3, false)).toEqual([])
        expect(dfStreakKill(st, 11.4, false)).toEqual([{ kind: 'multi', n: 5, bonus: 75 }])
        for (let i = 0; i < 2; i++) dfStreakKill(st, 11.5, false)
        expect(dfStreakKill(st, 11.6, false)).toEqual([{ kind: 'massacre', n: 8, bonus: 100 }])
        // a pause breaks the chain
        expect(dfStreakKill(st, 11.6 + DF_STREAK.window + 0.01, false)).toEqual([])
        expect(st.chain).toBe(1)
    })

    it('two quick kills pay the bonus and tell the killer', () => {
        const { sim } = makeSim()
        const p = sim.player(0)!
        const a = sim.debugSpawn('shambler', { x: p.pos.x, y: 0, z: p.pos.z - 5 }, 1)
        const b = sim.debugSpawn('shambler', { x: p.pos.x + 0.6, y: 0, z: p.pos.z - 6 }, 1)
        sim.snapshot()
        const pts = p.points
        const origin = { x: p.pos.x, y: p.pos.y + 1.1, z: p.pos.z }
        sim.fire(0, { origin, dirs: [{ x: 0, y: 0, z: -1 }], hits: [{ z: a.id, zone: 'body', dist: 5 }] })
        sim.step(0.3)
        sim.fire(0, { origin, dirs: [{ x: 0.1, y: 0, z: -0.995 }], hits: [{ z: b.id, zone: 'body', dist: 6 }] })
        const events = sim.snapshot().events
        expect(sim.zombies.includes(a) || sim.zombies.includes(b)).toBe(false)
        expect(events.filter(e => e.k === 'streak')).toEqual([{ k: 'streak', p: 0, kind: 'double', n: 2, bonus: 50 }])
        expect(p.points - pts).toBe(DF_POINTS.killBody * 2 + 50)
    })
})
