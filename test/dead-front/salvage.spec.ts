import { describe, expect, it } from 'vitest'
import {
    DF_SUPPORT_HELD, DF_SUPPORT, DF_STRIKE, dfPlanStrike,
    dfIsStrike, dfStrikeFlightStart
} from '#shared/utils/dead-front/support'
import { DF_MAP, dfInteractables } from '#shared/utils/dead-front/map'
import { DF_BENCH_SIZE, dfBenchUsePoint, dfMapBenches } from '#shared/utils/dead-front/map-benches'
import { dfBodyFits, dfBuildCollision, dfGroundHeight } from '#shared/utils/dead-front/physics'
import type { DfEvent } from '#shared/utils/dead-front/protocol'
import {
    DF_CRAFT_ORDER, DF_DECOY, DF_RECIPES, DF_SALVAGE, DF_SENTRY, dfChallengeCounts, dfChallengePool,
    dfCraftBlocked, dfCraftSpend, dfSalvageBonus, dfSalvageFade, DF_SILENCER_SALVAGE, dfSalvageRoll, dfSentryPick, dfTurnToward, dfYawGap
} from '#shared/utils/dead-front/salvage'
import type { DfKitState } from '#shared/utils/dead-front/salvage'
import { DF_RARITY_UPGRADE } from '#shared/utils/dead-front/rarity'
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
        let parts = 0
        for (let i = 0; i < 400; i++) {
            const b = dfSalvageRoll('brute', 9, roll)
            expect(b.scrap).toBeGreaterThanOrEqual(DF_SALVAGE.brute.scrap[0])
            expect(b.scrap).toBeLessThanOrEqual(DF_SALVAGE.brute.scrap[1])
            parts += b.parts
            const s = dfSalvageRoll('shambler', 9, roll)
            expect(s.scrap === 0 || (s.scrap >= DF_SALVAGE.amount[0] && s.scrap <= DF_SALVAGE.amount[1])).toBe(true)
        }
        expect(parts / 400).toBeGreaterThan(DF_SALVAGE.brute.part - 0.12)
        expect(parts / 400).toBeLessThan(DF_SALVAGE.brute.part + 0.12)
    })
})

describe('salvage: the workbench rules', () => {
    it('the bench sells everything, support included: cheapest gear first, the bomber the priciest support, the field kit dearest of all', () => {
        expect(DF_CRAFT_ORDER).toEqual(['sentry', 'decoy', 'kit', 'barrage', 'zeppelin', 'launcher', 'bomber'])
        expect(Object.keys(DF_RECIPES).sort()).toEqual([...DF_CRAFT_ORDER].sort())
        const price = (id: keyof typeof DF_RECIPES) => DF_RECIPES[id].scrap + DF_RECIPES[id].parts * 4
        expect(price('sentry')).toBeLessThan(price('kit'))
        for (const id of DF_CRAFT_ORDER) {
            if (id !== 'sentry' && id !== 'decoy') expect(price(id)).toBeGreaterThan(Math.max(price('sentry'), price('decoy')))
            if (id !== 'bomber' && id !== 'kit') expect(price(id)).toBeLessThan(price('bomber'))
            if (id !== 'kit') expect(price(id)).toBeLessThan(price('kit'))
        }
        // a cheat death costs as much as a Legendary upgrade
        expect({ scrap: DF_RECIPES.kit.scrap, parts: DF_RECIPES.kit.parts }).toEqual(DF_RARITY_UPGRADE[2])
        // every support item is on the bench
        expect(Object.keys(DF_SUPPORT).every(id => DF_RECIPES[id as keyof typeof DF_RECIPES]?.use === 'support')).toBe(true)
    })

    it('blocks for cost, full hands, full support and a kit in the pack', () => {
        const rich = { scrap: DF_SALVAGE.maxScrap, parts: DF_SALVAGE.maxParts }
        expect(dfCraftBlocked(DF_RECIPES.sentry, { scrap: DF_RECIPES.sentry.scrap - 1, parts: 0 }, kit())).toBe('scrap')
        expect(dfCraftBlocked(DF_RECIPES.sentry, { scrap: DF_RECIPES.sentry.scrap, parts: 0 }, kit())).toBeNull()
        expect(dfCraftBlocked(DF_RECIPES.kit, { scrap: DF_SALVAGE.maxScrap, parts: 0 }, kit())).toBe('parts')
        expect(dfCraftBlocked(DF_RECIPES.decoy, rich, kit({ equip: 'sentry' }))).toBe('hands')
        expect(dfCraftBlocked(DF_RECIPES.bomber, rich, kit({ support: DF_SUPPORT_HELD.max }))).toBe('full')
        expect(dfCraftBlocked(DF_RECIPES.barrage, rich, kit({ support: DF_SUPPORT_HELD.max }))).toBe('full')
        expect(dfCraftBlocked(DF_RECIPES.launcher, rich, kit({ support: 1 }))).toBeNull()
        expect(dfCraftBlocked(DF_RECIPES.kit, rich, kit({ kit: true }))).toBe('have')
    })

    it('spending never takes the pool below zero', () => {
        const pool = { scrap: DF_RECIPES.sentry.scrap + 1, parts: 1 }
        expect(dfCraftSpend(pool, DF_RECIPES.sentry)).toBe(true)
        expect(pool).toEqual({ scrap: 1, parts: 1 })
        expect(dfCraftSpend(pool, DF_RECIPES.sentry)).toBe(false)
        expect(dfCraftSpend(pool, DF_RECIPES.kit)).toBe(false)
        expect(pool).toEqual({ scrap: 1, parts: 1 })
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

    it('swings toward its target at a limited rate', () => {
        let yaw = 0
        yaw = dfTurnToward(yaw, Math.PI / 2, DF_SENTRY.turnRate, 0.05)
        expect(yaw).toBeCloseTo(DF_SENTRY.turnRate * 0.05, 5)
        for (let i = 0; i < 20; i++) yaw = dfTurnToward(yaw, Math.PI / 2, DF_SENTRY.turnRate, 0.05)
        expect(dfYawGap(yaw, Math.PI / 2)).toBeLessThan(1e-6)
        // the short way round
        expect(dfTurnToward(3, -3, 10, 0.01)).toBeGreaterThan(3)
    })
})

describe('support plans', () => {
    it('plans: shells walk round the mark, bombs and bursts run along the line', () => {
        const roll = seeded(3)
        const at = { x: 10, y: 0, z: 5 }
        const barrage = dfPlanStrike('barrage', at, { x: 0, y: 0, z: -1 }, roll)
        expect(barrage.hits).toHaveLength(DF_STRIKE.barrage.shells)
        for (const h of barrage.hits) {
            expect(Math.hypot(h.x - at.x, h.z - at.z)).toBeLessThanOrEqual(DF_STRIKE.barrage.spread + 0.01)
            expect(h.t).toBeGreaterThanOrEqual(DF_SUPPORT.barrage.delay - DF_STRIKE.barrage.jitter)
        }
        expect([...barrage.hits].sort((a, b) => a.t - b.t)).toEqual(barrage.hits)
        const zep = dfPlanStrike('zeppelin', at, { x: 1, y: 0, z: 0 }, roll)
        expect(zep.hits).toHaveLength(DF_STRIKE.zeppelin.bombs)
        for (const h of zep.hits) expect(Math.abs(h.z - at.z)).toBeLessThanOrEqual(1.3)
        // west to east, in order
        expect(zep.hits[0]!.x).toBeLessThan(zep.hits[zep.hits.length - 1]!.x)
        expect(zep.hits[0]!.t).toBeLessThan(zep.hits[zep.hits.length - 1]!.t)
        expect(dfStrikeFlightStart(zep)).toBeGreaterThan(0)
        // the bomber: rows of bombs inside the circle, then the whole circle (last)
        const bomber = dfPlanStrike('bomber', at, { x: 0, y: 0, z: 1 }, roll)
        const last = bomber.hits[bomber.hits.length - 1]!
        expect(last).toMatchObject({ x: at.x, z: at.z, r: DF_STRIKE.bomber.radius, all: true })
        expect(bomber.hits.filter(h => h.all)).toHaveLength(1)
        expect(bomber.hits.length).toBeGreaterThan(10)
        for (const h of bomber.hits) {
            expect(Math.hypot(h.x - at.x, h.z - at.z)).toBeLessThanOrEqual(DF_STRIKE.bomber.radius + 0.6)
            expect(h.t).toBeLessThanOrEqual(last.t)
        }
        expect(bomber.from.z).toBeLessThan(at.z)
        expect(bomber.to.z).toBeGreaterThan(at.z)
        expect(dfIsStrike('launcher')).toBe(false)
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
        const id = sim.arsenal.debugDrop(a!.pid, 'scrap', 2, pos)
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

    it('a silencer turns up more salvage', () => {
        expect(dfSalvageBonus('thompson', { muzzle: 'thompson-maxim' })).toBe(DF_SILENCER_SALVAGE)
        expect(dfSalvageBonus('thompson', {})).toBe(1)
        // a roll just over the plain chance only drops with the silencer
        const at = () => DF_SALVAGE.chance * (1 + (DF_SILENCER_SALVAGE - 1) / 2)
        expect(dfSalvageRoll('shambler', 1, at, DF_SILENCER_SALVAGE).scrap).toBeGreaterThan(0)
        expect(dfSalvageRoll('shambler', 1, at).scrap).toBe(0)
    })

    it('the drop chances fade with the round, so the horde outgrows the income', () => {
        expect(dfSalvageFade(1)).toBe(1)
        expect(dfSalvageFade(DF_SALVAGE.fadeFrom)).toBe(1)
        expect(dfSalvageFade(DF_SALVAGE.fadeFrom * 4)).toBeCloseTo(0.5, 5)
        // a roll that drops early doesn't late
        const at = () => DF_SALVAGE.chance * 0.9
        expect(dfSalvageRoll('shambler', 1, at).scrap).toBeGreaterThan(0)
        expect(dfSalvageRoll('shambler', 30, at).scrap).toBe(0)
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
        expect(sim.arsenal.drops.filter(d => d.kind === 'scrap')[0]!.n).toBeGreaterThanOrEqual(DF_SALVAGE.brute.scrap[0])
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
        pool.parts = 0
        sim.snapshot()
        let ok = 0
        for (let i = 0; i < 10; i++) if (sim.arsenal.handle(a!, { k: 'craft', bench: bench.id, item: 'sentry' })) ok++
        expect(ok).toBe(1)
        expect(pool).toEqual({ scrap: DF_RECIPES.launcher.scrap * 2 - 1, parts: 0 })
        expect(sim.snapshot().events.filter(e => e.k === 'craft')).toHaveLength(1)
        // salvage is per player: b has none of a's
        expect(sim.arsenal.handle(b!, { k: 'craft', bench: bench.id, item: 'launcher' })).toBe(false)
        // support goes onto the reward list, once from what's left
        for (let i = 0; i < 5; i++) sim.arsenal.handle(a!, { k: 'craft', bench: bench.id, item: 'launcher' })
        expect(sim.arsenal.gearOf(a!).support).toEqual(['launcher'])
        expect(pool.scrap).toBe(DF_RECIPES.launcher.scrap - 1)
        // the bomber needs its parts
        pool.scrap = DF_RECIPES.bomber.scrap
        pool.parts = DF_RECIPES.bomber.parts - 1
        expect(sim.arsenal.handle(a!, { k: 'craft', bench: bench.id, item: 'bomber' })).toBe(false)
        pool.parts++
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
        sim.arsenal.gearOf(p).pool.parts = DF_SALVAGE.maxParts
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

    it('a sentry doesn\'t shoot through walls and gets clawed apart', () => {
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
        sim.zombies.splice(sim.zombies.indexOf(hidden), 1)
        // three brutes on top of it (out of the gun's arc while it turns, armoured heads)
        for (let i = 0; i < 3; i++) sim.debugSpawn('brute', { x: s.pos.x + Math.cos(i * 2) * 0.8, y: 0, z: s.pos.z + Math.sin(i * 2) * 0.8 }, 1e9)
        const events = run(sim, 6)
        expect(events.some(e => e.k === 'sentry' && e.what === 'broken')).toBe(true)
    })

    it('a gramophone pulls zombies off you, then blows them up', () => {
        const { sim } = makeSim()
        const p = sim.player(0)!
        sim.dev(0, { k: 'god', on: true })
        sim.dev(0, { k: 'hold', on: true })
        sim.arsenal.gearOf(p).equip = 'decoy'
        const at = { x: p.pos.x + 8, y: 0, z: p.pos.z - 2 }
        expect(sim.arsenal.handle(p, { k: 'deploy', pos: at, yaw: 0 })).toBe(true)
        const d = sim.arsenal.decoys[0]!
        const z = sim.debugSpawn('shambler', { x: p.pos.x - 2, y: 0, z: p.pos.z - 6 }, 1e5)
        const start = Math.hypot(z.pos.x - d.pos.x, z.pos.z - d.pos.z)
        run(sim, 4)
        const mid = Math.hypot(z.pos.x - d.pos.x, z.pos.z - d.pos.z)
        expect(mid).toBeLessThan(start - 2)
        z.hp = 300
        const events = run(sim, DF_DECOY.fuse)
        expect(events.some(e => e.k === 'decoy')).toBe(true)
        expect(events.some(e => e.k === 'explode' && e.kind === 'grenade')).toBe(true)
        expect(sim.zombies.includes(z)).toBe(false)
        expect(p.health).toBe(p.effects.maxHealth)
    })

    it('kills never hand out support', () => {
        const { sim, advance } = makeSim()
        const p = sim.player(0)!
        sim.arsenal.rng.chance = () => false
        const origin = { x: p.pos.x, y: p.pos.y + 1.1, z: p.pos.z }
        for (let i = 0; i < 60; i++) {
            const z = sim.debugSpawn('shambler', { x: p.pos.x, y: 0, z: p.pos.z - 5 }, 1)
            p.weapons[0]!.mag = p.weapons[0]!.stats.magSize
            sim.fire(0, { origin, dirs: [{ x: 0, y: 0, z: -1 }], hits: [{ z: z.id, zone: 'body', dist: 5 }] })
            sim.step(0.4)
            advance(0.4)
        }
        expect(p.kills).toBeGreaterThanOrEqual(60)
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
        // a kill's own part drop may land at the player's feet and get picked up too
        expect(sim.arsenal.gearOf(p).pool.parts).toBeGreaterThanOrEqual(1)
        expect(sim.arsenal.gearOf(p).pool.scrap).toBeGreaterThanOrEqual(2)
        expect(p.points - pts).toBeGreaterThanOrEqual(250)
        expect(sim.snapshot().world.arsenal!.challenge?.done).toBe(true)
    })
})
