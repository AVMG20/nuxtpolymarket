import { describe, expect, it } from 'vitest'
import { DF_SUPPORT_HELD } from '#shared/utils/dead-front/support'
import { DF_MAP, dfInteractables } from '#shared/utils/dead-front/map'
import { DF_BENCH_SIZE, dfBenchUsePoint, dfMapBenches } from '#shared/utils/dead-front/map-benches'
import { dfBodyFits, dfBuildCollision, dfGroundHeight } from '#shared/utils/dead-front/physics'
import type { DfEvent } from '#shared/utils/dead-front/protocol'
import {
    DF_RECIPES, DF_SALVAGE, DF_SENTRY, dfChallengeCounts, dfChallengePool, dfChallengeReward,
    dfCraftBlocked, dfCraftSpend, dfSalvageRoll, dfSentryPick
} from '#shared/utils/dead-front/salvage'
import type { DfKitState } from '#shared/utils/dead-front/salvage'
import { DfMatchSim } from '#server/utils/dead-front/sim'
import type { DfPlayerSetup } from '#server/utils/dead-front/sim-types'

const setup = (userId: string): DfPlayerSetup => ({ userId, name: userId, startWeapon: 'm1911', attachments: {}, perkMods: {} })

function makeSim(players = 1) {
    let clock = 1000
    const sim = new DfMatchSim(Array.from({ length: players }, (_, i) => setup(`u${i}`)), { now: () => clock, startDelay: 1000 })
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

/** A seeded uniform roll, for repeatable statistics. */
function seeded(seed: number): () => number {
    let s = seed >>> 0
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0
        return s / 4294967296
    }
}

const kit = (over: Partial<DfKitState> = {}): DfKitState => ({ equip: null, kit: false, support: 0, supportMax: DF_SUPPORT_HELD.max, ...over })

describe('salvage: drops', () => {
    it('brutes always drop a pile; bloaters usually; the roll stays in range', () => {
        const roll = seeded(7)
        for (let i = 0; i < 50; i++) {
            const b = dfSalvageRoll('brute', 9, roll)
            expect(b).toBeGreaterThanOrEqual(DF_SALVAGE.brute.scrap[0])
            expect(b).toBeLessThanOrEqual(DF_SALVAGE.brute.scrap[1])
            const s = dfSalvageRoll('shambler', 9, roll)
            expect(s === 0 || (s >= DF_SALVAGE.amount[0] && s <= DF_SALVAGE.amount[1])).toBe(true)
        }
    })
})

describe('salvage: the workbench rules', () => {
    it('blocks for cost, full hands, full support and a kit in the pack', () => {
        const rich = { scrap: DF_SALVAGE.maxScrap }
        expect(dfCraftBlocked(DF_RECIPES.sentry, { scrap: DF_RECIPES.sentry.scrap - 1 }, kit())).toBe('scrap')
        expect(dfCraftBlocked(DF_RECIPES.sentry, { scrap: DF_RECIPES.sentry.scrap }, kit())).toBeNull()
        expect(dfCraftBlocked(DF_RECIPES.kit, { scrap: DF_RECIPES.kit.scrap - 1 }, kit())).toBe('scrap')
        expect(dfCraftBlocked(DF_RECIPES.decoy, rich, kit({ equip: 'sentry' }))).toBe('hands')
        expect(dfCraftBlocked(DF_RECIPES.bomber, rich, kit({ support: DF_SUPPORT_HELD.max }))).toBe('full')
        expect(dfCraftBlocked(DF_RECIPES.barrage, rich, kit({ support: DF_SUPPORT_HELD.max }))).toBe('full')
        expect(dfCraftBlocked(DF_RECIPES.launcher, rich, kit({ support: 1 }))).toBeNull()
        expect(dfCraftBlocked(DF_RECIPES.kit, rich, kit({ kit: true }))).toBe('have')
    })

    it('spending never takes the pool below zero', () => {
        const pool = { scrap: DF_RECIPES.sentry.scrap + 1 }
        expect(dfCraftSpend(pool, DF_RECIPES.sentry)).toBe(true)
        expect(pool).toEqual({ scrap: 1 })
        expect(dfCraftSpend(pool, DF_RECIPES.sentry)).toBe(false)
        expect(dfCraftSpend(pool, DF_RECIPES.kit)).toBe(false)
        expect(pool).toEqual({ scrap: 1 })
    })

    it('benches stand against a wall, in the open, reachable from the floor', () => {
        const world = dfBuildCollision(DF_MAP, new Set())
        const benches = dfMapBenches()
        expect(DF_MAP.benches?.map(b => b.id)).toEqual(benches.map(b => b.id))
        for (const b of benches) {
            const use = dfBenchUsePoint(b)
            // a body fits where you work it, on the floor
            expect(dfBodyFits(world, { x: use.x, y: use.y + 0.05, z: use.z }, { radius: 0.35, height: 1.7 })).toBe(true)
            expect(dfGroundHeight(world, use.x, use.z, 1)).toBeCloseTo(b.pos.y, 3)
            // the bench top is solid, and the wall is right behind it
            expect(dfGroundHeight(world, b.pos.x, b.pos.z, 2)).toBeCloseTo(b.pos.y + DF_BENCH_SIZE.height, 3)
            const back = { x: b.pos.x - Math.sin(b.yaw) * (DF_BENCH_SIZE.depth / 2 + 0.3), z: b.pos.z - Math.cos(b.yaw) * (DF_BENCH_SIZE.depth / 2 + 0.3) }
            expect(dfGroundHeight(world, back.x, back.z, 6)).toBeGreaterThan(2)
            // zombies can reach the player working it (a nav node close by)
            expect(DF_MAP.nav.nodes.some(n => Math.hypot(n.pos.x - use.x, n.pos.z - use.z) < 2.5 && Math.abs(n.pos.y - use.y) < 0.5)).toBe(true)
        }
        expect(dfInteractables(DF_MAP).filter(i => i.kind === 'bench')).toHaveLength(benches.length)
    })
})

describe('sentry rules', () => {
    it('picks the nearest zombie in range it can see', () => {
        const muzzle = { x: 0, y: 1, z: 0 }
        const targets = [
            { id: 1, pos: { x: 0, y: 0, z: -3 }, hp: 10 },
            { id: 2, pos: { x: 0, y: 0, z: -6 }, hp: 10 },
            { id: 3, pos: { x: 1, y: 0, z: -2 }, hp: 0 },
            { id: 4, pos: { x: 30, y: 0, z: 0 }, hp: 10 }
        ]
        expect(dfSentryPick(muzzle, targets, () => true)?.id).toBe(1)
        // the closest one is behind a wall
        expect(dfSentryPick(muzzle, targets, (_a, b) => b.z < -4)?.id).toBe(2)
        expect(dfSentryPick(muzzle, targets, () => false)).toBeNull()
        expect(dfSentryPick(muzzle, [{ id: 9, pos: { x: 0, y: 0, z: -2 }, hp: 5, skip: true }], () => true)).toBeNull()
    })
})

describe('round challenges', () => {
    it('none on round 1 or in the gas; the brute only when one comes', () => {
        expect(dfChallengePool(1, { gas: false, brutes: 0 })).toEqual([])
        expect(dfChallengePool(6, { gas: true, brutes: 0 })).toEqual([])
        expect(dfChallengePool(9, { gas: false, brutes: 1 })).toContain('brute')
        expect(dfChallengePool(9, { gas: false, brutes: 0 })).not.toContain('brute')
        const kill = { type: 'shambler' as const, zone: 'head' as const, weapon: 'm1911', explosive: false, gear: false }
        expect(dfChallengeCounts('heads', kill)).toBe(true)
        expect(dfChallengeCounts('heads', { ...kill, gear: true })).toBe(false)
        expect(dfChallengeCounts('knife', { ...kill, weapon: 'knife' })).toBe(true)
        expect(dfChallengeCounts('gear', { ...kill, gear: true })).toBe(true)
    })
})

describe('salvage: the match', () => {
    it('a drop is its owner\'s: only they see it, only they take it, and only once', () => {
        const { sim } = makeSim(2)
        const [a, b] = sim.players
        const pos = { x: a!.pos.x + 3, y: 0, z: a!.pos.z }
        b!.pos = { ...pos }
        const id = sim.arsenal.debugDrop(a!.pid, 2, pos)
        // b stands on it: not theirs, it stays (and b never sees it)
        run(sim, 0.5)
        expect(sim.arsenal.drops).toHaveLength(1)
        expect(sim.arsenal.mine(b!.pid).drops).toHaveLength(0)
        expect(sim.arsenal.mine(a!.pid).drops.map(d => d.id)).toEqual([id])
        expect(sim.snapshot().world.arsenal!.drops).toBeUndefined()
        expect(sim.arsenal.pickUp(b!, id)).toBe(false)
        a!.pos = { ...pos }
        sim.step(0.05)
        const mine = sim.arsenal.mine(a!.pid)
        expect(mine.events.filter(e => e.k === 'salvage')).toHaveLength(1)
        expect(mine.scrap).toBe(2)
        expect(sim.arsenal.mine(b!.pid).events).toHaveLength(0)
        expect(sim.arsenal.gearOf(b!).pool.scrap).toBe(0)
        // the same claim again finds nothing
        expect(sim.arsenal.pickUp(a!, id)).toBe(false)
        expect(sim.arsenal.gearOf(a!).pool.scrap).toBe(2)
    })

    it('kills drop salvage on the ground (brutes always) and it rusts away', () => {
        const { sim } = makeSim()
        const p = sim.player(0)!
        sim.dev(0, { k: 'god', on: true })
        const z = sim.debugSpawn('brute', { x: p.pos.x, y: 0, z: p.pos.z - 8 }, 1)
        sim.dev(0, { k: 'tp', pos: { x: p.pos.x + 20, y: 0, z: p.pos.z } })
        // kill it straight through the hook the sim uses
        ;(sim as unknown as { killZombie: (z: unknown, p: unknown, zone: string, src: unknown) => void }).killZombie(z, p, 'body', { weapon: 'm1911', credit: 'm1911' })
        expect(sim.arsenal.drops.length).toBeGreaterThanOrEqual(1)
        expect(sim.arsenal.drops.every(d => d.owner === p.pid)).toBe(true)
        expect(sim.arsenal.drops[0]!.n).toBeGreaterThanOrEqual(DF_SALVAGE.brute.scrap[0])
        run(sim, DF_SALVAGE.life + 0.5, 0.25)
        expect(sim.arsenal.drops).toHaveLength(0)
        expect(sim.arsenal.gearOf(p).pool.scrap).toBe(0)
    })

    it('crafting can\'t overspend: a burst of identical requests crafts once', () => {
        const { sim } = makeSim(2)
        const bench = dfInteractables(sim.map).find(i => i.kind === 'bench')!
        for (const p of sim.players) p.pos = { ...bench.pos }
        const [a, b] = sim.players
        const pool = sim.arsenal.gearOf(a!).pool
        pool.scrap = DF_RECIPES.sentry.scrap + DF_RECIPES.launcher.scrap * 2 - 1
        sim.snapshot()
        let ok = 0
        for (let i = 0; i < 10; i++) if (sim.arsenal.handle(a!, { k: 'craft', bench: bench.id, item: 'sentry' })) ok++
        expect(ok).toBe(1)
        expect(pool).toEqual({ scrap: DF_RECIPES.launcher.scrap * 2 - 1 })
        expect(sim.snapshot().events.filter(e => e.k === 'craft')).toHaveLength(1)
        // salvage is per player: b has none of a's
        expect(sim.arsenal.handle(b!, { k: 'craft', bench: bench.id, item: 'launcher' })).toBe(false)
        // support goes onto the reward list, once from what's left
        for (let i = 0; i < 5; i++) sim.arsenal.handle(a!, { k: 'craft', bench: bench.id, item: 'launcher' })
        expect(sim.arsenal.gearOf(a!).support).toEqual(['launcher'])
        expect(pool.scrap).toBe(DF_RECIPES.launcher.scrap - 1)
        // the bomber needs its full price
        pool.scrap = DF_RECIPES.bomber.scrap - 1
        expect(sim.arsenal.handle(a!, { k: 'craft', bench: bench.id, item: 'bomber' })).toBe(false)
        pool.scrap++
        expect(sim.arsenal.handle(a!, { k: 'craft', bench: bench.id, item: 'bomber' })).toBe(true)
        expect(sim.arsenal.gearOf(a!).support).toEqual(['launcher', 'bomber'])
        // and the list is full at three
        sim.arsenal.gearOf(a!).support.push('barrage')
        expect(sim.arsenal.handle(a!, { k: 'craft', bench: bench.id, item: 'launcher' })).toBe(false)
    })

    it('crafting needs you at the bench, standing, with a real recipe', () => {
        const { sim } = makeSim()
        const p = sim.player(0)!
        const bench = dfInteractables(sim.map).find(i => i.kind === 'bench')!
        sim.arsenal.gearOf(p).pool.scrap = DF_SALVAGE.maxScrap
        p.pos = { x: bench.pos.x + 8, y: 0, z: bench.pos.z }
        expect(sim.arsenal.handle(p, { k: 'craft', bench: bench.id, item: 'kit' })).toBe(false)
        p.pos = { ...bench.pos }
        expect(sim.arsenal.handle(p, { k: 'craft', bench: 'door-farm', item: 'kit' })).toBe(false)
        expect(sim.arsenal.handle(p, { k: 'craft', bench: bench.id, item: 'toString' as never })).toBe(false)
        expect(sim.arsenal.handle(p, { k: 'craft', bench: bench.id, item: 'plate' as never })).toBe(false)
        expect(sim.arsenal.handle(p, { k: 'craft', bench: bench.id, item: 'kit' })).toBe(true)
        expect(sim.arsenal.gearOf(p).kit).toBe(true)
    })

    it('hits come off health straight (no armour); a field kit gets you back up', () => {
        const { sim } = makeSim()
        const p = sim.player(0)!
        const g = sim.arsenal.gearOf(p)
        const hurt = (dmg: number) => (sim as unknown as { hurtPlayer: (p: unknown, raw: number, z: number, ex: boolean) => void }).hurtPlayer(p, dmg, -1, false)
        const h0 = p.health
        hurt(40)
        expect(p.health).toBeCloseTo(h0 - 40, 5)
        g.kit = true
        sim.dev(0, { k: 'down' })
        expect(p.life).toBe('down')
        expect(g.kit).toBe(false)
        run(sim, 3.2)
        expect(p.life).toBe('alive')
    })

    it('a sentry guns down the nearest zombie it can see, pays its owner, then runs dry', () => {
        const { sim } = makeSim()
        const p = sim.player(0)!
        sim.dev(0, { k: 'god', on: true })
        sim.arsenal.gearOf(p).equip = 'sentry'
        expect(sim.arsenal.handle(p, { k: 'deploy', pos: { x: p.pos.x, y: 0, z: p.pos.z - 1.5 }, yaw: 0 })).toBe(true)
        expect(sim.arsenal.gearOf(p).equip).toBeNull()
        // the gear is spent: a second deploy has nothing to place
        expect(sim.arsenal.handle(p, { k: 'deploy', pos: { x: p.pos.x, y: 0, z: p.pos.z - 1.5 }, yaw: 0 })).toBe(false)
        expect(sim.arsenal.sentries).toHaveLength(1)
        const s = sim.arsenal.sentries[0]!
        const near = sim.debugSpawn('shambler', { x: s.pos.x + 5, y: 0, z: s.pos.z }, 200)
        const far = sim.debugSpawn('shambler', { x: s.pos.x - 12, y: 0, z: s.pos.z }, 200)
        sim.dev(0, { k: 'hold', on: true })
        const pts = p.points
        const kills = p.kills
        const events = run(sim, 2.5)
        expect(sim.zombies.includes(near)).toBe(false)
        expect(events.some(e => e.k === 'kill' && e.z === near.id && e.weapon === 'sentry')).toBe(true)
        expect(p.kills).toBeGreaterThan(kills)
        expect(p.points).toBeGreaterThan(pts)
        expect(sim.snapshot().world.arsenal!.sentries[0]!.shots).toBeGreaterThan(0)
        // left alone it finishes the other one too, then winds down
        run(sim, 4)
        expect(sim.zombies.includes(far)).toBe(false)
        const all = run(sim, DF_SENTRY.life)
        expect(all.some(e => e.k === 'sentry' && e.what === 'spent')).toBe(true)
        expect(sim.arsenal.sentries).toHaveLength(0)
    })

    it('a sentry doesn\'t shoot through walls', () => {
        const { sim } = makeSim()
        const p = sim.player(0)!
        sim.dev(0, { k: 'god', on: true })
        sim.dev(0, { k: 'hold', on: true })
        sim.arsenal.gearOf(p).equip = 'sentry'
        sim.arsenal.handle(p, { k: 'deploy', pos: { x: p.pos.x, y: 0, z: p.pos.z - 1.5 }, yaw: 0 })
        const s = sim.arsenal.sentries[0]!
        // a zombie in the houses north of the square wall (z < 1)
        const hidden = sim.debugSpawn('shambler', { x: s.pos.x, y: 0, z: -3 }, 200)
        run(sim, 1.5)
        expect(hidden.hp).toBe(200)
    })

    it('kills never hand out support', () => {
        const { sim, advance } = makeSim()
        const p = sim.player(0)!
        sim.arsenal.rng.chance = () => false
        const origin = { x: p.pos.x, y: p.pos.y + 1.1, z: p.pos.z }
        for (let i = 0; i < 20; i++) {
            const z = sim.debugSpawn('shambler', { x: p.pos.x, y: 0, z: p.pos.z - 5 }, 1)
            p.weapons[0]!.mag = p.weapons[0]!.stats.magSize
            sim.fire(0, { origin, dirs: [{ x: 0, y: 0, z: -1 }], hits: [{ z: z.id, zone: 'body', dist: 5 }] })
            sim.step(0.4)
            advance(0.4)
        }
        expect(p.kills).toBeGreaterThanOrEqual(20)
        expect(sim.arsenal.gearOf(p).support).toEqual([])
        expect(sim.snapshot().world.arsenal!.players[0]!.support).toEqual([])
    })

    it('a barrage bought at the bench lands where it\'s called, friendly-safe, once', () => {
        const { sim } = makeSim(2)
        const [p, mate] = sim.players
        // no power-up drops: a Nuke from the horde would add its own explosion
        ;(sim as unknown as { powerupsThisRound: number }).powerupsThisRound = Infinity
        const bench = dfInteractables(sim.map).find(i => i.kind === 'bench')!
        const home = { ...p!.pos }
        p!.pos = { ...bench.pos }
        sim.arsenal.gearOf(p!).pool.scrap = DF_RECIPES.barrage.scrap
        expect(sim.arsenal.handle(p!, { k: 'craft', bench: bench.id, item: 'barrage' })).toBe(true)
        expect(sim.arsenal.gearOf(p!).support).toEqual(['barrage'])
        expect(sim.arsenal.gearOf(p!).pool.scrap).toBe(0)
        p!.pos = home
        // the mark: 12 m ahead, a horde and a teammate standing in it
        sim.dev(0, { k: 'hold', on: true })
        const at = { x: p!.pos.x, y: 0, z: p!.pos.z - 12 }
        mate!.pos = { ...at }
        // zombies can't touch them (only a blast from the world could)
        mate!.invulnUntil = 1e9
        const horde = Array.from({ length: 5 }, (_, i) => sim.debugSpawn('shambler', { x: at.x + (i - 2) * 1.2, y: 0, z: at.z + 0.5 }))
        const hp = mate!.health
        expect(sim.arsenal.handle(p!, { k: 'callin', at, dir: { x: 0, y: 0, z: -1 } })).toBe(true)
        expect(sim.arsenal.handle(p!, { k: 'callin', at, dir: { x: 0, y: 0, z: -1 } })).toBe(false)
        const events = run(sim, 6)
        const strike = events.find(e => e.k === 'strike')
        expect(strike && strike.k === 'strike' && strike.hits.length).toBe(8)
        expect(events.filter(e => e.k === 'explode').length).toBe(8)
        expect(horde.filter(z => sim.zombies.includes(z))).toHaveLength(0)
        expect(mate!.health).toBe(hp)
        expect(mate!.life).toBe('alive')
        expect(sim.arsenal.strikes).toHaveLength(0)
    })

    it('a call-in out of range or without support does nothing', () => {
        const { sim } = makeSim()
        const p = sim.player(0)!
        expect(sim.arsenal.handle(p, { k: 'callin', at: { x: p.pos.x, y: 0, z: p.pos.z - 5 }, dir: { x: 0, y: 0, z: -1 } })).toBe(false)
        sim.arsenal.debugSupport(p, 'bomber')
        expect(sim.arsenal.handle(p, { k: 'callin', at: { x: p.pos.x + DF_SUPPORT_HELD.range + 5, y: 0, z: p.pos.z }, dir: { x: 1, y: 0, z: 0 } })).toBe(false)
        expect(sim.arsenal.handle(p, { k: 'callin', at: { x: Number.NaN, y: 0, z: 0 }, dir: { x: 1, y: 0, z: 0 } })).toBe(false)
        expect(sim.arsenal.gearOf(p).support).toEqual(['bomber'])
    })

    it('a round challenge pays the squad when it is met', () => {
        const { sim } = makeSim()
        const p = sim.player(0)!
        sim.dev(0, { k: 'hold', on: true })
        sim.round = 2
        sim.startRound()
        const c = sim.arsenal.challenge
        expect(c).not.toBeNull()
        c!.id = 'knife'
        c!.goal = 2
        const pts = p.points
        for (let i = 0; i < 2; i++) {
            const z = sim.debugSpawn('shambler', { x: p.pos.x, y: 0, z: p.pos.z - 1 }, 1)
            sim.melee(0, { z: z.id, zone: 'body' })
            sim.step(1)
        }
        const events = sim.snapshot().events
        expect(events.some(e => e.k === 'challenge' && e.what === 'done')).toBe(true)
        // a kill's own drop may land at the player's feet and get picked up too
        expect(sim.arsenal.gearOf(p).pool.scrap).toBeGreaterThanOrEqual(dfChallengeReward(sim.round).scrap)
        expect(p.points - pts).toBeGreaterThanOrEqual(250)
        expect(sim.snapshot().world.arsenal!.challenge?.done).toBe(true)
    })
})
