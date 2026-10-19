import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DF_COSTS, DF_PLAYER, DF_POINTS, DF_REVIVE_GRACE, DF_SOLO_SECONDWIND_MAX } from '#shared/utils/dead-front/constants'
import type { DfMapDef } from '#shared/utils/dead-front/map'
import type { DfServerMsg } from '#shared/utils/dead-front/protocol'
import type { DfProfileView, DfProgressReport, DfWeaponId } from '#shared/utils/dead-front/types'
import { dfWeaponStats } from '#shared/utils/dead-front/weapons'
import { DfHub } from '#server/utils/dead-front/hub'
import type { DfSocket } from '#server/utils/dead-front/hub'
import { DF_STALE_INPUT, DfMatchSim } from '#server/utils/dead-front/sim'

// The co-op loop: last stand, revives, bleed-out and respawn, dropped
// players, solo Second Wind, and the host leaving mid-match.

const spot = (id: string, x: number, z: number) => ({ id, pos: { x, y: 0, z }, yaw: 0, zone: 'a' })
const MAP: DfMapDef = {
    id: 'coop', name: 'Coop',
    bounds: { min: { x: -40, y: -1, z: -40 }, max: { x: 40, y: 12, z: 40 } },
    startZone: 'a',
    playerSpawns: [{ x: 0, y: 0, z: 0 }, { x: 1.5, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }],
    solids: [{ min: { x: -40, y: -1, z: -40 }, max: { x: 40, y: 0, z: 40 }, mat: 'mud' }],
    zones: [{ id: 'a', name: 'A' }],
    doors: [], barricades: [], wallBuys: [],
    perks: [{ id: 'perk-sw', perk: 'secondwind', pos: { x: 0, y: 0, z: -3 }, yaw: 0, zone: 'a' }],
    boxSpots: [spot('box', 20, 20)], pap: spot('pap', -20, 20), power: spot('power', 20, -20),
    egg: { fuses: [], generator: spot('gen', -20, -20), pedestal: spot('ped', 0, -20), chargeRadius: 6 },
    riserSpawns: [spot('r', 30, 30)],
    nav: { nodes: [{ id: 0, pos: { x: 0, y: 0, z: 0 }, zone: 'a' }], links: [] },
    lights: []
}

function makeSim(start: DfWeaponId[] = ['m1911', 'm1911']) {
    let clock = 100
    const sim = new DfMatchSim(start.map((w, i) => ({ userId: `u${i}`, name: `u${i}`, startWeapon: w, attachments: {}, perkMods: {} })), { map: MAP, now: () => clock, startDelay: 1000 })
    sim.dev(0, { k: 'hold', on: true })
    return { sim, tick: (s: number) => { for (let t = 0; t < s; t += 0.05) { clock += 0.05; sim.step(0.05) } } }
}

const knockDown = (sim: DfMatchSim, pid: number) => sim['hurtPlayer'](sim.player(pid)!, 10_000, 1, false)

describe('last stand', () => {
    it('keeps the Second Wind Last Stand mod for the down that took the perk', () => {
        const { sim, tick } = makeSim()
        const a = sim.player(0)!
        a.setup.perkMods = { secondwind: ['secondwind-laststand'] }
        a.perks = ['secondwind']
        sim['setEffects'](a)
        knockDown(sim, 0)
        expect(a.perks).toEqual([])
        expect(a.effects.lastStandDamageMult).toBe(1.75)
        const b = sim.player(1)!
        b.pos = { x: 0.8, y: 0, z: 0 }
        sim.revive(1, 0)
        tick(DF_PLAYER.reviveTime + DF_REVIVE_GRACE + 0.2)
        expect(a.life).toBe('alive')
        // no Second Wind bought back: the next down is a plain one
        knockDown(sim, 0)
        expect(a.life).toBe('down')
        expect(a.effects.lastStandDamageMult).toBe(1)
    })

    it('hands a downed player their own pistol and gives back the gun they held on revive', () => {
        const { sim, tick } = makeSim()
        const a = sim.player(0)!
        a.weapons.push({ id: 'thompson', pap: 0, mag: 30, reserve: 120, attachments: {}, stats: dfWeaponStats('thompson', 0) })
        a.slot = 1
        knockDown(sim, 0)
        expect(a.life).toBe('down')
        expect(a.weapons[a.slot]!.id).toBe('m1911')
        // last stand is pistols only
        sim.swap(0, 1)
        expect(a.weapons[a.slot]!.id).toBe('m1911')
        const b = sim.player(1)!
        b.pos = { x: 0.8, y: 0, z: 0 }
        sim.revive(1, 0)
        tick(DF_PLAYER.reviveTime + 0.2)
        expect(a.life).toBe('alive')
        expect(a.weapons[a.slot]!.id).toBe('thompson')
        expect(b.points).toBe(DF_POINTS.startPoints + DF_POINTS.revive)
    })

    it('lends the start pistol to someone carrying none, and returns their guns', () => {
        const { sim, tick } = makeSim(['kar98k', 'm1911'])
        const a = sim.player(0)!
        a.weapons.push({ id: 'mp18', pap: 0, mag: 20, reserve: 100, attachments: {}, stats: dfWeaponStats('mp18', 0) })
        knockDown(sim, 0)
        expect(a.weapons.map(w => w.id)).toEqual(['m1911'])
        sim.player(1)!.pos = { x: 0.8, y: 0, z: 0 }
        sim.revive(1, 0)
        tick(DF_PLAYER.reviveTime + 0.2)
        expect(a.weapons.map(w => w.id)).toEqual(['kar98k', 'mp18'])
    })

    it('a revive only counts while the reviver keeps holding and stays close', () => {
        const { sim, tick } = makeSim()
        knockDown(sim, 0)
        const b = sim.player(1)!
        b.pos = { x: 0.8, y: 0, z: 0 }
        sim.revive(1, 0)
        tick(DF_PLAYER.reviveTime * 0.6)
        sim.revive(1, null)
        tick(0.1)
        expect(sim.player(0)!.reviveProgress).toBe(0)
        sim.revive(1, 0)
        tick(1)
        b.pos = { x: 6, y: 0, z: 0 }
        tick(DF_PLAYER.reviveTime)
        expect(sim.player(0)!.life).toBe('down')
    })

    it('gives a revived player a moment of grace before zombies can drop them again', () => {
        const { sim, tick } = makeSim()
        knockDown(sim, 0)
        sim.player(1)!.pos = { x: 0.8, y: 0, z: 0 }
        sim.revive(1, 0)
        tick(DF_PLAYER.reviveTime + 0.1)
        const a = sim.player(0)!
        knockDown(sim, 0)
        expect(a.life).toBe('alive')
        tick(DF_REVIVE_GRACE)
        knockDown(sim, 0)
        expect(a.life).toBe('down')
    })
})

describe('bleed-out and respawn', () => {
    it('bleeds out, spectates, and comes back at the next round with the start weapon and their points', () => {
        const { sim, tick } = makeSim(['c96', 'm1911'])
        const a = sim.player(0)!
        a.points = 4321
        a.perks = ['secondwind']
        knockDown(sim, 0)
        tick(a.effects.bleedoutTime + 0.2)
        expect(a.life).toBe('dead')
        expect(sim.over).toBe(false) // the teammate still stands
        sim.startRound()
        expect(a.life).toBe('alive')
        expect(a.weapons.map(w => w.id)).toEqual(['c96'])
        expect(a.perks).toEqual([])
        expect(a.points).toBe(4321)
        expect(a.health).toBe(a.effects.maxHealth)
    })
})

describe('dropped players', () => {
    it('a teammate who dropped while standing keeps the match alive through their grace', () => {
        const { sim, tick } = makeSim()
        sim.setConnected(1, false)
        knockDown(sim, 0)
        tick(0.1)
        expect(sim.over).toBe(false)
        // they never come back: the match layer removes them and it's over
        sim.removePlayer(1)
        tick(0.1)
        expect(sim.over).toBe(true)
    })

    it('zombies ignore a disconnected player', () => {
        const { sim, tick } = makeSim()
        sim.setConnected(0, false)
        sim.player(1)!.pos = { x: 20, y: 0, z: 0 }
        const z = sim.debugSpawn('shambler', { x: 0, y: 0, z: 3 })
        tick(1)
        expect(z.target).toBe(1)
    })
})

describe('solo Second Wind', () => {
    it('sells without power, picks you back up, and sells out after three bottles', () => {
        const { sim, tick } = makeSim(['m1911'])
        const p = sim.player(0)!
        p.points = 100_000
        p.pos = { x: 0, y: 0, z: -2 }
        for (let n = 0; n < DF_SOLO_SECONDWIND_MAX; n++) {
            p.useCooldown.clear()
            sim.use(0, 'perk-sw')
            expect(p.perks).toContain('secondwind')
            expect(sim.snapshot().players[0]!.windBuys).toBe(n + 1)
            knockDown(sim, 0)
            expect(p.life).toBe('down')
            expect(sim.over).toBe(false)
            tick(3.2)
            expect(p.life).toBe('alive')
            tick(DF_REVIVE_GRACE)
        }
        p.useCooldown.clear()
        const before = p.points
        sim.use(0, 'perk-sw')
        expect(p.points).toBe(before)
        expect(p.perks).not.toContain('secondwind')
        expect(DF_COSTS.secondwindSolo).toBeLessThan(1000)
    })
})

// ---------------------------------------------------------------- the hub

const profile = (): DfProfileView => ({
    unlockedWeapons: ['m1911'], weaponXp: {}, loadout: { startWeapon: 'm1911', attachments: {} }, researchPerk: null,
    perkXp: {}, perkMods: {}, gamesPlayed: 0, bestRound: 0, totalKills: 0, eggsCompleted: 0
})
const report: DfProgressReport = { perk: null, perkXpGained: 0, perkLevelBefore: 0, perkLevelAfter: 0, weaponXpGained: {}, weaponLevelsUp: {}, newWeapons: [] }

interface Fake extends DfSocket {
    inbox: DfServerMsg[]
    last: <T extends DfServerMsg['t']>(t: T) => Extract<DfServerMsg, { t: T }> | undefined
}
let seq = 0
function socket(): Fake {
    const inbox: DfServerMsg[] = []
    return {
        id: `c${++seq}`,
        inbox,
        send: frame => inbox.push(JSON.parse(frame) as DfServerMsg),
        close: () => {},
        last: <T extends DfServerMsg['t']>(t: T) => [...inbox].reverse().find(m => m.t === t) as Extract<DfServerMsg, { t: T }> | undefined
    }
}

describe('host leaving mid-match', () => {
    let hub: DfHub
    beforeEach(() => {
        vi.useFakeTimers()
        hub = new DfHub({ loadProfile: async () => profile(), applyResult: async () => report })
    })
    afterEach(() => vi.useRealTimers())
    const send = (s: Fake, msg: object) => hub.message(s.id, JSON.stringify(msg))
    const flush = async () => {
        for (let i = 0; i < 5; i++) await Promise.resolve()
    }

    it('the squad plays on, nobody can join late, and the lobby has a new host afterwards', async () => {
        const a = socket()
        const b = socket()
        const c = socket()
        hub.open(a, { id: 'ua', name: 'Alice' })
        hub.open(b, { id: 'ub', name: 'Bob' })
        hub.open(c, { id: 'uc', name: 'Cleo' })
        send(a, { t: 'create' })
        const id = a.last('lobby')!.lobby!.id
        send(b, { t: 'join', id })
        send(b, { t: 'ready', ready: true })
        send(a, { t: 'start' })
        await flush()
        expect(b.last('start')).toBeDefined()
        // no late joins
        send(c, { t: 'join', id })
        expect(c.last('error')?.message).toMatch(/already in the field/)
        // the host walks out
        send(a, { t: 'leave' })
        await flush()
        expect(a.last('end')).toBeDefined()
        b.inbox.length = 0
        vi.advanceTimersByTime(200)
        expect(b.last('snap')).toBeDefined()
        expect(b.last('snap')!.s.players.map(p => p.userId)).toEqual(['ub'])
        // Bob finishes the match and is back in the lobby as its host
        send(b, { t: 'leave' })
        await flush()
        expect(b.last('end')).toBeDefined()
        expect(hub.summaries()).toEqual([])
    })
})

describe('lag', () => {
    function lagSim(players: number) {
        let clock = 100
        const sim = new DfMatchSim(Array.from({ length: players }, (_, i) => ({ userId: `u${i}`, name: `u${i}`, startWeapon: 'm1911' as DfWeaponId, attachments: {}, perkMods: {} })), { map: MAP, now: () => clock, startDelay: 1000 })
        const report = (pid: number) => sim.input(pid, { seq: Math.round(clock * 20), pos: { ...sim.player(pid)!.pos }, yaw: 0, pitch: 0, flags: 0, rtt: 80 })
        return { sim, report, wait: (s: number) => { clock += s } }
    }

    it('holds a solo match still while the player\'s reports stall', () => {
        const { sim, report, wait } = lagSim(1)
        report(0)
        expect(sim.soloStalled).toBe(false)
        wait(DF_STALE_INPUT + 0.1)
        expect(sim.soloStalled).toBe(true)
        report(0)
        expect(sim.soloStalled).toBe(false)
    })

    it('waits for a reconnected solo player\'s first report before calling it a stall', () => {
        const { sim, report, wait } = lagSim(1)
        report(0)
        sim.setConnected(0, false)
        sim.setConnected(0, true)
        wait(2)
        expect(sim.soloStalled).toBe(false)
        report(0)
        wait(DF_STALE_INPUT + 0.1)
        expect(sim.soloStalled).toBe(true)
    })

    it('gives no lag shield to stalls back to back', () => {
        const { sim, report, wait } = lagSim(2)
        const a = sim.player(0)!
        report(0)
        wait(1)
        report(0)
        wait(1)
        sim['hurtPlayer'](a, 30, 1, false)
        expect(a.health).toBe(a.effects.maxHealth - 30)
    })

    it('lets no zombie land on a player whose reports stalled, unless they are long gone', () => {
        const { sim, report, wait } = lagSim(2)
        const a = sim.player(0)!
        report(0)
        wait(DF_STALE_INPUT + 0.1)
        sim['hurtPlayer'](a, 30, 1, false)
        expect(a.health).toBe(a.effects.maxHealth)
        wait(5)
        sim['hurtPlayer'](a, 30, 1, false)
        expect(a.health).toBe(a.effects.maxHealth - 30)
    })
})
