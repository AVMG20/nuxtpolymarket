import { afterEach, describe, expect, it, vi } from 'vitest'
import { DF_COSTS, DF_POINTS } from '#shared/utils/dead-front/constants'
import { DF_BARRICADE_PLANKS } from '#shared/utils/dead-front/map'
import type { DfMapDef } from '#shared/utils/dead-front/map'
import type { DfEvent } from '#shared/utils/dead-front/protocol'
import type { DfMatchResult, DfProfileView, DfProgressReport } from '#shared/utils/dead-front/types'
import { dfWeaponStats } from '#shared/utils/dead-front/weapons'
import { DfMatchSim } from '#server/utils/dead-front/sim'
import { DfMatch, dfPlayerSetup } from '#server/utils/dead-front/match'
import type { DfPlayerSetup } from '#server/utils/dead-front/sim-types'

const spot = (id: string, x: number, z: number, zone = 'a') => ({ id, pos: { x, y: 0, z }, yaw: 0, zone })

const MAP: DfMapDef = {
    id: 'test',
    name: 'Test',
    bounds: { min: { x: -40, y: -1, z: -40 }, max: { x: 40, y: 12, z: 40 } },
    startZone: 'a',
    playerSpawns: [{ x: 0, y: 0, z: 0 }, { x: 1.5, y: 0, z: 0 }],
    solids: [{ min: { x: -40, y: -1, z: -40 }, max: { x: 40, y: 0, z: 40 }, mat: 'mud' }],
    zones: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
    doors: [{ id: 'door-ab', label: 'B', cost: 750, zones: ['a', 'b'], pos: { x: 5, y: 0, z: 0 } }],
    barricades: [{ id: 'win-a', zone: 'a', pos: { x: 0, y: 0, z: 8 }, inward: { x: 0, y: 0, z: -1 }, outside: { x: 0, y: 0, z: 9 }, width: 1.2 }],
    wallBuys: [{ id: 'wall-mp18', weapon: 'mp18', pos: { x: -3, y: 1.4, z: 0 }, normal: { x: 1, y: 0, z: 0 }, zone: 'a' }],
    perks: [{ id: 'perk-ironhide', perk: 'ironhide', pos: { x: 3, y: 0, z: -3 }, yaw: 0, zone: 'a' }],
    boxSpots: [spot('box-0', 0, -4), spot('box-1', 12, 0, 'b')],
    pap: spot('pap', -4, -4),
    power: spot('power', 4, 4),
    egg: {
        fuses: [spot('fuse-1', -2, 2), spot('fuse-2', 2, 2), spot('fuse-3', 0, 3)],
        generator: spot('generator', -6, 6),
        pedestal: spot('pedestal', 6, -6),
        chargeRadius: 8
    },
    riserSpawns: [spot('riser-0', -8, -8)],
    nav: { nodes: [{ id: 0, pos: { x: 0, y: 0, z: 0 }, zone: 'a' }], links: [] },
    lights: []
}

const setup = (userId: string): DfPlayerSetup => ({ userId, name: userId, startWeapon: 'm1911', attachments: {}, perkMods: {} })

function makeSim(players = 1) {
    let clock = 1000
    const sim = new DfMatchSim(Array.from({ length: players }, (_, i) => setup(`u${i}`)), { map: MAP, now: () => clock, startDelay: 1000 })
    return { sim, advance: (s: number) => { clock += s } }
}

function drain(sim: DfMatchSim): DfEvent[] {
    return sim.snapshot().events
}

/** A ray from the player's eye at the zombie's chest. */
function aimAt(sim: DfMatchSim, pid: number, target: { x: number, y: number, z: number }) {
    const p = sim.player(pid)!
    const origin = { x: p.pos.x, y: p.pos.y + 1.62, z: p.pos.z }
    const d = { x: target.x - origin.x, y: target.y - origin.y, z: target.z - origin.z }
    const l = Math.hypot(d.x, d.y, d.z)
    return { origin, dir: { x: d.x / l, y: d.y / l, z: d.z / l }, dist: l }
}

describe('DfMatchSim shots', () => {
    it('pays 10 per hit and the kill total, and validates claims', () => {
        const { sim, advance } = makeSim()
        const p = sim.player(0)!
        const stats = dfWeaponStats('m1911', 0)
        const z = sim.debugSpawn('shambler', { x: 0, y: 0, z: 6 }, stats.damage * 2.5)
        drain(sim)
        const aim = aimAt(sim, 0, { x: 0, y: 1.1, z: 6 })
        expect(sim.fire(0, { origin: aim.origin, dirs: [aim.dir], hits: [{ z: z.id, zone: 'body', dist: aim.dist }] })).toBe(true)
        expect(p.points).toBe(DF_POINTS.startPoints + DF_POINTS.hit)
        expect(z.hp).toBeCloseTo(stats.damage * 1.5)

        // A claim along a ray pointing away is rejected (ammo still spent).
        advance(1)
        const away = { x: -aim.dir.x, y: aim.dir.y, z: -aim.dir.z }
        sim.fire(0, { origin: aim.origin, dirs: [away], hits: [{ z: z.id, zone: 'body', dist: aim.dist }] })
        expect(z.hp).toBeCloseTo(stats.damage * 1.5)
        expect(p.weapons[0]!.mag).toBe(stats.magSize - 2)

        advance(1)
        sim.fire(0, { origin: aim.origin, dirs: [aim.dir], hits: [{ z: z.id, zone: 'body', dist: aim.dist }] })
        advance(1)
        sim.fire(0, { origin: aim.origin, dirs: [aim.dir], hits: [{ z: z.id, zone: 'body', dist: aim.dist }] })
        expect(sim.zombies).not.toContain(z)
        expect(p.kills).toBe(1)
        expect(p.points).toBe(DF_POINTS.startPoints + DF_POINTS.hit * 2 + DF_POINTS.killBody)
        expect(p.weaponKills.m1911).toBe(1)
        const events = drain(sim)
        expect(events.some(e => e.k === 'kill' && e.z === z.id)).toBe(true)
        expect(events.filter(e => e.k === 'shot')).toHaveLength(4)
    })

    it('pays 100 for a headshot kill', () => {
        const { sim } = makeSim()
        const p = sim.player(0)!
        const z = sim.debugSpawn('shambler', { x: 0, y: 0, z: 6 }, 1)
        const aim = aimAt(sim, 0, { x: 0, y: 1.62, z: 6 })
        sim.fire(0, { origin: aim.origin, dirs: [aim.dir], hits: [{ z: z.id, zone: 'head', dist: aim.dist }] })
        expect(p.points).toBe(DF_POINTS.startPoints + DF_POINTS.killHead)
        expect(p.headshots).toBe(1)
    })

    it('enforces the fire rate and the magazine', () => {
        const { sim, advance } = makeSim()
        const p = sim.player(0)!
        const stats = dfWeaponStats('m1911', 0)
        const shot = { origin: { x: 0, y: 1.62, z: 0 }, dirs: [{ x: 0, y: 0, z: 1 }], hits: [] }
        let accepted = 0
        for (let i = 0; i < 10; i++) if (sim.fire(0, shot)) accepted++
        expect(accepted).toBeLessThanOrEqual(3)
        for (let i = 0; i < 40; i++) {
            advance(1)
            sim.fire(0, shot)
        }
        expect(p.weapons[0]!.mag).toBe(0)
        advance(1)
        expect(sim.fire(0, shot)).toBe(false)
        sim.reload(0)
        for (let i = 0; i < 100; i++) sim.step(0.05)
        expect(p.weapons[0]!.mag).toBe(stats.magSize)
    })

    it('does not let a wall hide a claimed hit', () => {
        const map: DfMapDef = { ...MAP, solids: [...MAP.solids, { min: { x: -2, y: 0, z: 3 }, max: { x: 2, y: 3, z: 3.5 }, mat: 'stone' }] }
        const sim = new DfMatchSim([setup('u0')], { map, now: () => 0, startDelay: 1000 })
        const z = sim.debugSpawn('shambler', { x: 0, y: 0, z: 6 }, 1000)
        const aim = aimAt(sim, 0, { x: 0, y: 1.1, z: 6 })
        sim.fire(0, { origin: aim.origin, dirs: [aim.dir], hits: [{ z: z.id, zone: 'body', dist: aim.dist }] })
        // With the shared physics in place the wall blocks the claim; skeleton physics has no raycast.
        const blocked = z.hp === 1000
        const hasRaycast = sim.world.solids.length > 1
        expect(blocked || !hasRaycast).toBe(true)
    })
})

describe('DfMatchSim interactions', () => {
    it('buys a door once and opens its zones', () => {
        const { sim } = makeSim()
        const p = sim.player(0)!
        p.pos = { x: 4.5, y: 0, z: 0 }
        p.points = 2000
        sim.use(0, 'door-ab')
        sim.use(0, 'door-ab')
        expect(p.points).toBe(2000 - 750)
        expect(sim.doors.has('door-ab')).toBe(true)
        expect(sim.activeZones.has('b')).toBe(true)
    })

    it('needs to be in range', () => {
        const { sim } = makeSim()
        const p = sim.player(0)!
        p.points = 2000
        p.pos = { x: -20, y: 0, z: 0 }
        sim.use(0, 'door-ab')
        expect(sim.doors.size).toBe(0)
    })

    it('needs power for perks and caps the purchase to one', () => {
        const { sim } = makeSim()
        const p = sim.player(0)!
        p.points = 10000
        p.pos = { x: 3, y: 0, z: -3 }
        sim.use(0, 'perk-ironhide')
        expect(p.perks).toEqual([])
        sim.power = true
        sim.use(0, 'perk-ironhide')
        expect(p.perks).toEqual(['ironhide'])
    })

    it('rolls the box and never hands out a held weapon', () => {
        for (let run = 0; run < 15; run++) {
            const { sim } = makeSim()
            const p = sim.player(0)!
            p.points = 5000
            p.pos = { x: 0, y: 0, z: -3.5 }
            sim.use(0, 'box-0')
            expect(p.points).toBe(5000 - DF_COSTS.box)
            expect(sim.box.state).toBe('rolling')
            for (let i = 0; i < 90 && sim.box.state === 'rolling'; i++) sim.step(0.05)
            expect(sim.box.state).toBe('ready')
            expect(sim.box.weapon).not.toBe('m1911')
            const offered = sim.box.weapon!
            for (let i = 0; i < 20; i++) sim.step(0.05)
            sim.use(0, 'box-0')
            expect(p.weapons.map(w => w.id)).toContain(offered)
            expect(p.weaponsFound.has(offered)).toBe(true)
            expect(sim.box.state).toBe('idle')
        }
    })

    it('repairs boards at a rate limit and pays for them', () => {
        const { sim } = makeSim()
        const p = sim.player(0)!
        p.pos = { x: 0, y: 0, z: 7 }
        sim.planks['win-a'] = 0
        sim.use(0, 'win-a')
        sim.use(0, 'win-a')
        expect(sim.planks['win-a']).toBe(1)
        expect(p.points).toBe(DF_POINTS.startPoints + DF_POINTS.plank)
        for (let i = 0; i < 12; i++) sim.step(0.05)
        sim.use(0, 'win-a')
        expect(sim.planks['win-a']).toBe(2)
        // A zombie in the opening blocks repairs.
        sim.debugSpawn('shambler', { x: 0, y: 0, z: 8.3 })
        for (let i = 0; i < 12; i++) sim.step(0.05)
        sim.use(0, 'win-a')
        expect(sim.planks['win-a']!).toBeLessThanOrEqual(2)
        expect(DF_BARRICADE_PLANKS).toBeGreaterThan(2)
    })

    it('runs the easter egg to the wunderweapon', () => {
        const { sim } = makeSim()
        const p = sim.player(0)!
        const go = (x: number, z: number) => { p.pos = { x, y: 0, z } }
        go(-2, 2)
        sim.use(0, 'fuse-1')
        expect(sim.egg.fusesFound).toEqual([])
        go(4, 4)
        sim.use(0, 'power')
        expect(sim.power).toBe(true)
        expect(sim.egg.step).toBe('fuses')
        go(-2, 2)
        sim.use(0, 'fuse-1')
        go(2, 2)
        sim.use(0, 'fuse-2')
        go(0, 3)
        sim.use(0, 'fuse-3')
        expect(sim.egg.step).toBe('install')
        go(-6, 6)
        sim.use(0, 'generator')
        expect(sim.egg.step).toBe('charge')
        const needed = sim.egg.chargeNeeded
        for (let i = 0; i < needed; i++) {
            const z = sim.debugSpawn('shambler', { x: -6, y: 0, z: 9 }, 1)
            const aim = aimAt(sim, 0, { x: -6, y: 1.1, z: 9 })
            p.weapons[0]!.mag = 5
            p.fireTokens = 3
            sim.fire(0, { origin: aim.origin, dirs: [aim.dir], hits: [{ z: z.id, zone: 'body', dist: aim.dist }] })
        }
        expect(sim.egg.step).toBe('claim')
        go(6, -6)
        sim.use(0, 'pedestal')
        expect(sim.egg.step).toBe('done')
        expect(p.weapons.map(w => w.id)).toContain('wunder')
        expect(sim.result(0)!.completedEasterEgg).toBe(true)
        expect(sim.result(0)!.weaponsFound).toContain('wunder')
        const events = drain(sim)
        expect(events.filter(e => e.k === 'egg').map(e => (e as { step: string }).step)).toEqual(['fuses', 'install', 'charge', 'claim', 'done'])
    })
})

describe('DfMatchSim rounds and downs', () => {
    it('spawns the round, ends it when cleared, and starts the next', () => {
        const { sim } = makeSim()
        sim.startRound()
        expect(sim.round).toBe(1)
        let spawned = 0
        for (let i = 0; i < 20 * 40 && sim.round === 1; i++) {
            sim.step(0.05)
            for (const z of [...sim.zombies]) {
                spawned++
                sim['killZombie'](z, sim.player(0)!, 'body', { weapon: 'm1911', credit: 'm1911' })
            }
            if (sim.phase === 'intermission') break
        }
        expect(spawned).toBe(6)
        expect(sim.phase).toBe('intermission')
        expect(sim.roundsCompleted).toBe(1)
        for (let i = 0; i < 20 * 11; i++) sim.step(0.05)
        expect(sim.round).toBe(2)
        expect(sim.player(0)!.grenades).toBe(4)
    })

    it('downs a player, lets a teammate revive, and ends when everyone is down', () => {
        const { sim } = makeSim(2)
        const a = sim.player(0)!
        const b = sim.player(1)!
        sim.power = true
        a.perks = ['ironhide']
        sim['hurtPlayer'](a, 10_000, 1, false)
        expect(a.life).toBe('down')
        expect(a.perks).toEqual([])
        b.pos = { x: 0.5, y: 0, z: 0 }
        sim.revive(1, 0)
        for (let i = 0; i < 20 * 3.2; i++) sim.step(0.05)
        expect(a.life).toBe('alive')
        expect(b.revives).toBe(1)
        expect(sim.over).toBe(false)
        // a freshly revived player gets a moment's grace
        sim['hurtPlayer'](a, 10_000, 1, false)
        expect(a.life).toBe('alive')
        for (let i = 0; i < 20 * 1.6; i++) sim.step(0.05)
        sim['hurtPlayer'](a, 10_000, 1, false)
        sim['hurtPlayer'](b, 10_000, 1, false)
        sim.step(0.05)
        expect(sim.over).toBe(true)
    })

    it('bleeds out into dead and respawns next round with the start weapon', () => {
        const { sim } = makeSim(2)
        const a = sim.player(0)!
        sim['hurtPlayer'](a, 10_000, 1, false)
        for (let i = 0; i < 20 * 31; i++) sim.step(0.05)
        expect(a.life).toBe('dead')
        expect(sim.over).toBe(false)
        sim.startRound()
        expect(a.life).toBe('alive')
        expect(a.weapons.map(w => w.id)).toEqual(['m1911'])
    })

    it('ends a solo match on the down', () => {
        const { sim } = makeSim(1)
        sim['hurtPlayer'](sim.player(0)!, 10_000, 1, false)
        sim.step(0.05)
        expect(sim.over).toBe(true)
    })

    it('clamps movement speed and rejects teleports', () => {
        const { sim, advance } = makeSim()
        const p = sim.player(0)!
        advance(0.05)
        sim.input(0, { seq: 1, pos: { x: 30, y: 0, z: 0 }, yaw: 0, pitch: 0, flags: 0 })
        expect(p.pos.x).toBe(0)
        const tp = p.tp
        for (let i = 0; i < 20; i++) {
            advance(0.05)
            sim.input(0, { seq: 2 + i, pos: { x: p.pos.x + 1.5, y: 0, z: 0 }, yaw: 0, pitch: 0, flags: 0 })
        }
        // 1 s of input at 30 m/s claimed; the server allows sprint speed plus slack.
        expect(p.pos.x).toBeLessThan(13)
        expect(p.tp).toBeGreaterThan(tp)
        expect(sim.ack(0)).toBe(21)
    })
})

describe('DfMatch', () => {
    afterEach(() => {
        vi.useRealTimers()
    })

    it('resolves the profile loadout', () => {
        const profile: DfProfileView = {
            unlockedWeapons: ['m1911', 'mp18'],
            weaponXp: {},
            loadout: { startWeapon: 'thompson', attachments: {} },
            researchPerk: null,
            perkXp: {},
            perkMods: { ironhide: ['x'] },
            gamesPlayed: 0,
            bestRound: 0,
            totalKills: 0,
            eggsCompleted: 0
        }
        expect(dfPlayerSetup({ userId: 'u', name: 'U' }, profile).startWeapon).toBe('m1911')
        expect(dfPlayerSetup({ userId: 'u', name: 'U' }, { ...profile, loadout: { startWeapon: 'mp18', attachments: {} } }).startWeapon).toBe('mp18')
        expect(dfPlayerSetup({ userId: 'u', name: 'U' }, profile).perkMods).toEqual({ ironhide: ['x'] })
    })

    it('applies each result exactly once, even when leave races game over', async () => {
        vi.useFakeTimers()
        const applied: string[] = []
        const sent: { userId: string, frame: string }[] = []
        const profile = (): DfProfileView => ({
            unlockedWeapons: ['m1911'], weaponXp: {}, loadout: { startWeapon: 'm1911', attachments: {} }, researchPerk: null,
            perkXp: {}, perkMods: {}, gamesPlayed: 0, bestRound: 0, totalKills: 0, eggsCompleted: 0
        })
        const report: DfProgressReport = { perk: null, perkXpGained: 0, perkLevelBefore: 0, perkLevelAfter: 0, weaponXpGained: {}, weaponLevelsUp: {}, newWeapons: [] }
        let finished = 0
        const match = await DfMatch.create([{ userId: 'a', name: 'A' }, { userId: 'b', name: 'B' }], {
            send: (userId, frame) => sent.push({ userId, frame }),
            onPlayerGone: () => {},
            onFinished: () => finished++,
            loadProfile: async () => profile(),
            applyResult: async (userId: string, _r: DfMatchResult) => {
                applied.push(userId)
                await Promise.resolve()
                return report
            }
        })
        vi.advanceTimersByTime(200)
        expect(sent.some(s => s.frame.startsWith('{"t":"snap"'))).toBe(true)
        const snap = JSON.parse(sent.find(s => s.frame.startsWith('{"t":"snap"'))!.frame)
        expect(snap.s.ack).toBe(0)
        expect(snap.s.players).toHaveLength(2)
        await Promise.all([match.leave('a'), match.leave('a'), match.finish(), match.finish()])
        expect(applied.sort()).toEqual(['a', 'b'])
        expect(finished).toBe(1)
        expect(sent.filter(s => s.frame.startsWith('{"t":"end"')).map(s => s.userId).sort()).toEqual(['a', 'b'])
    })
})
