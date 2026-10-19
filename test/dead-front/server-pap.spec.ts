import { afterEach, describe, expect, it, vi } from 'vitest'
import { DF_COSTS, DF_MACHINE_TIMES, dfPapCost } from '#shared/utils/dead-front/constants'
import type { DfMapDef } from '#shared/utils/dead-front/map'
import type { DfEvent } from '#shared/utils/dead-front/protocol'
import type { DfProfileView, DfProgressReport, DfWeaponId } from '#shared/utils/dead-front/types'
import { dfWeaponStats } from '#shared/utils/dead-front/weapons'
import { DfMatch } from '#server/utils/dead-front/match'
import { DF_BOX_MOVE_CHANCE, DfMatchSim } from '#server/utils/dead-front/sim'
import type { DfPlayerSetup, SimPlayer, SimWeapon } from '#server/utils/dead-front/sim-types'

// Pack-a-Punch never loses (or duplicates) a weapon, its slots never shift,
// and solo pause freezes the match.

const spot = (id: string, x: number, z: number, zone = 'a') => ({ id, pos: { x, y: 0, z }, yaw: 0, zone })

const MAP: DfMapDef = {
    id: 'test',
    name: 'Test',
    bounds: { min: { x: -40, y: -1, z: -40 }, max: { x: 40, y: 12, z: 40 } },
    startZone: 'a',
    playerSpawns: [{ x: 0, y: 0, z: 0 }, { x: 1.5, y: 0, z: 0 }],
    solids: [{ min: { x: -40, y: -1, z: -40 }, max: { x: 40, y: 0, z: 40 }, mat: 'mud' }],
    zones: [{ id: 'a', name: 'A' }],
    doors: [],
    barricades: [{ id: 'win-a', zone: 'a', pos: { x: 0, y: 0, z: 8 }, inward: { x: 0, y: 0, z: -1 }, outside: { x: 0, y: 0, z: 9 }, width: 1.2 }],
    wallBuys: [{ id: 'wall-mp18', weapon: 'mp18', pos: { x: -1, y: 1.4, z: -1 }, normal: { x: 1, y: 0, z: 0 }, zone: 'a' }],
    perks: [],
    boxSpots: [spot('box-0', 1, -1)],
    pap: spot('pap', -1, 1),
    power: spot('power', 1, 1),
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
    sim.power = true
    sim['devHold'] = true
    for (const p of sim.players) p.points = 1_000_000
    return { sim, advance: (s: number) => { clock += s } }
}

const weapon = (sim: DfMatchSim, p: SimPlayer, id: DfWeaponId, pap = 0): SimWeapon => sim['makeWeapon'](p, id, pap)
const ids = (p: SimPlayer) => p.weapons.map(w => w.id)
const step = (sim: DfMatchSim, seconds: number) => {
    for (let t = 0; t < seconds; t += 0.05) sim.step(0.05)
}
/** Uses an interactable past its per-id cooldown. */
const use = (sim: DfMatchSim, pid: number, id: string) => {
    sim.player(pid)!.useCooldown.clear()
    sim.use(pid, id)
}
const noDupes = (p: SimPlayer) => expect(new Set(ids(p)).size).toBe(p.weapons.length)

describe('Pack-a-Punch keeps every weapon', () => {
    it('costs 5,000 then 15,000 then 30,000', () => {
        expect(DF_COSTS.pap).toEqual([5000, 15000, 30000])
        expect(dfPapCost(0)).toBe(5000)
        expect(dfPapCost(1)).toBe(15000)
        expect(dfPapCost(2)).toBe(30000)
        expect(dfPapCost(3)).toBeNull()
        const { sim } = makeSim()
        const p = sim.player(0)!
        p.points = 5000 + 15000 + 30000
        for (let tier = 0; tier < 3; tier++) {
            use(sim, 0, 'pap')
            step(sim, DF_MACHINE_TIMES.papWork + 0.1)
            use(sim, 0, 'pap')
            expect(p.weapons[0]!.pap).toBe(tier + 1)
        }
        expect(p.points).toBe(0)
        use(sim, 0, 'pap')
        expect(sim.pap.state).toBe('idle')
    })

    it('packs the middle slot of Kar98k / Thompson / wunderweapon and gives it back in place', () => {
        const { sim } = makeSim()
        const p = sim.player(0)!
        p.weapons = [weapon(sim, p, 'kar98k'), weapon(sim, p, 'thompson'), weapon(sim, p, 'wunder')]
        p.slot = 1
        use(sim, 0, 'pap')
        expect(sim.pap.state).toBe('working')
        // the slot stays reserved: nothing shifts while it's in the machine
        expect(ids(p)).toEqual(['kar98k', 'thompson', 'wunder'])
        expect(p.weapons[1]!.away).toBe(true)
        expect(p.weapons[p.slot]!.away).toBeFalsy()
        // the placeholder can't be swapped to or fired
        sim.swap(0, 1)
        expect(p.slot).not.toBe(1)
        step(sim, DF_MACHINE_TIMES.papWork + 0.1)
        use(sim, 0, 'pap')
        expect(ids(p)).toEqual(['kar98k', 'thompson', 'wunder'])
        expect(p.weapons[1]!.pap).toBe(1)
        expect(p.weapons[1]!.away).toBeFalsy()
        expect(p.slot).toBe(1)
        expect(p.weapons[0]!.pap).toBe(0)
        noDupes(p)
    })

    it('returns the weapon with full ammo when the offer runs out, and says so', () => {
        const { sim } = makeSim()
        const p = sim.player(0)!
        p.weapons = [weapon(sim, p, 'kar98k'), weapon(sim, p, 'thompson')]
        p.slot = 1
        p.weapons[1]!.mag = 0
        p.weapons[1]!.reserve = 0
        use(sim, 0, 'pap')
        sim.snapshot()
        step(sim, DF_MACHINE_TIMES.papWork + DF_MACHINE_TIMES.papOffer + 0.5)
        expect(sim.pap.state).toBe('idle')
        expect(ids(p)).toEqual(['kar98k', 'thompson'])
        const back = p.weapons[1]!
        const stats = dfWeaponStats('thompson', 1)
        expect(back.pap).toBe(1)
        expect(back.mag).toBe(stats.magSize)
        expect(back.reserve).toBeGreaterThan(0)
        // an automatic return doesn't yank the weapon you're holding out of your hands
        expect(p.slot).toBe(0)
        const events: DfEvent[] = sim.snapshot().events
        expect(events).toContainEqual({ k: 'papReturn', p: 0, weapon: 'thompson', tier: 1 })
    })

    it('returns the only weapon into your hands', () => {
        const { sim } = makeSim()
        const p = sim.player(0)!
        use(sim, 0, 'pap')
        expect(ids(p)).toEqual(['m1911'])
        expect(p.weapons[0]!.away).toBe(true)
        expect(sim.fire(0, { origin: { x: 0, y: 1.62, z: 0 }, dirs: [{ x: 0, y: 0, z: 1 }], hits: [] })).toBe(false)
        step(sim, DF_MACHINE_TIMES.papWork + DF_MACHINE_TIMES.papOffer + 0.5)
        expect(ids(p)).toEqual(['m1911'])
        expect(p.weapons[0]!.pap).toBe(1)
        expect(p.slot).toBe(0)
    })

    it('a weapon bought meanwhile takes the free slot; the packed one still comes back to its own', () => {
        const { sim } = makeSim()
        const p = sim.player(0)!
        use(sim, 0, 'pap')
        use(sim, 0, 'wall-mp18')
        expect(ids(p)).toEqual(['m1911', 'mp18'])
        expect(p.slot).toBe(1)
        step(sim, DF_MACHINE_TIMES.papWork + DF_MACHINE_TIMES.papOffer + 0.5)
        expect(ids(p)).toEqual(['m1911', 'mp18'])
        expect(p.weapons[0]!.pap).toBe(1)
        expect(p.slot).toBe(1)
        noDupes(p)
    })

    it('with full slots a buy replaces the weapon in hand, never the reserved slot', () => {
        const { sim } = makeSim()
        const p = sim.player(0)!
        p.weapons = [weapon(sim, p, 'kar98k'), weapon(sim, p, 'thompson'), weapon(sim, p, 'wunder')]
        p.slot = 1
        use(sim, 0, 'pap')
        p.slot = 0
        use(sim, 0, 'wall-mp18')
        expect(ids(p)).toEqual(['mp18', 'thompson', 'wunder'])
        // and it can't buy a second copy of the packed weapon
        p.slot = 2
        use(sim, 0, 'wall-mp18')
        step(sim, DF_MACHINE_TIMES.papWork + 0.1)
        use(sim, 0, 'pap')
        expect(ids(p)).toEqual(['mp18', 'thompson', 'wunder'])
        expect(p.weapons[1]!.pap).toBe(1)
        noDupes(p)
    })

    it('keeps it for an owner who is down, and hands it back on revive', () => {
        const { sim } = makeSim(2)
        const p = sim.player(0)!
        p.weapons = [weapon(sim, p, 'kar98k'), weapon(sim, p, 'thompson')]
        p.slot = 1
        use(sim, 0, 'pap')
        sim.dev(0, { k: 'down' })
        expect(p.life).toBe('down')
        step(sim, DF_MACHINE_TIMES.papWork + DF_MACHINE_TIMES.papOffer + 0.5)
        expect(sim.pap.state).toBe('idle')
        sim['revivePlayer'](p, null)
        expect(ids(p)).toEqual(['kar98k', 'thompson'])
        expect(p.weapons[1]!.pap).toBe(1)
        noDupes(p)
    })

    it('holds the offer for an owner who bled out and returns it after the respawn', () => {
        const { sim } = makeSim(2)
        const p = sim.player(0)!
        p.weapons = [weapon(sim, p, 'm1911'), weapon(sim, p, 'thompson')]
        p.slot = 1
        use(sim, 0, 'pap')
        step(sim, DF_MACHINE_TIMES.papWork + 0.1)
        expect(sim.pap.state).toBe('ready')
        p.life = 'dead'
        p.savedWeapons = null
        step(sim, DF_MACHINE_TIMES.papOffer + 2)
        expect(sim.pap.state).toBe('ready')
        sim['respawn'](p)
        step(sim, DF_MACHINE_TIMES.papOffer + 0.5)
        expect(ids(p)).toEqual(['m1911', 'thompson'])
        expect(p.weapons[1]!.pap).toBe(1)
        noDupes(p)
    })

    it('waits for a dropped owner until they reconnect', () => {
        const { sim } = makeSim(2)
        const p = sim.player(0)!
        use(sim, 0, 'pap')
        step(sim, DF_MACHINE_TIMES.papWork + 0.1)
        sim.setConnected(0, false)
        step(sim, DF_MACHINE_TIMES.papOffer + 2)
        expect(sim.pap.state).toBe('ready')
        sim.setConnected(0, true)
        step(sim, DF_MACHINE_TIMES.papOffer + 0.5)
        expect(p.weapons[0]!.pap).toBe(1)
        expect(p.weapons[0]!.away).toBeFalsy()
    })

    it('the box trade keeps your weapon until you take the new one', () => {
        const { sim } = makeSim()
        const p = sim.player(0)!
        p.weapons = [weapon(sim, p, 'kar98k'), weapon(sim, p, 'thompson')]
        p.slot = 0
        use(sim, 0, 'box-0')
        expect(sim.box.state).toBe('rolling')
        step(sim, DF_MACHINE_TIMES.boxRoll + 0.1)
        if (sim.box.state === 'ready') {
            // the untaken offer may go; the weapons you carry may not
            step(sim, DF_MACHINE_TIMES.boxOffer + 0.5)
            expect(ids(p)).toEqual(['kar98k', 'thompson'])
            use(sim, 0, 'box-0')
            step(sim, DF_MACHINE_TIMES.boxRoll + 0.1)
            if (sim.box.state === 'ready') {
                const offered = sim.box.weapon!
                use(sim, 0, 'box-0')
                expect(ids(p)).toEqual([offered, 'thompson'])
            }
        }
        noDupes(p)
    })

    it('a new weapon slots in before the wunderweapon, never behind it', () => {
        const { sim } = makeSim()
        const p = sim.player(0)!
        p.weapons = [weapon(sim, p, 'kar98k'), weapon(sim, p, 'wunder')]
        p.slot = 1
        use(sim, 0, 'wall-mp18')
        expect(ids(p)).toEqual(['kar98k', 'mp18', 'wunder'])
        expect(p.slot).toBe(1)
    })
})

describe('mystery box locations', () => {
    const boxMap: DfMapDef = {
        ...MAP,
        zones: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
        boxSpots: [spot('box-start', 1, -1, 'a'), spot('box-b1', 10, 10, 'b'), spot('box-b2', -10, 10, 'b')]
    }
    const boxSim = () => {
        const sim = new DfMatchSim([setup('u0')], { map: boxMap, now: () => 0, startDelay: 1000 })
        sim['devHold'] = true
        sim.player(0)!.points = 10_000_000
        return sim
    }

    it('never starts in the start zone', () => {
        const seen = new Set<number>()
        for (let i = 0; i < 200; i++) {
            const sim = boxSim()
            expect(boxMap.boxSpots[sim.box.spot]!.zone).not.toBe(boxMap.startZone)
            seen.add(sim.box.spot)
        }
        // and it varies between the allowed spots
        expect(seen.size).toBe(2)
    })

    it('moves after about 10% of rolls, refunds those rolls and never touches your weapons', () => {
        expect(DF_BOX_MOVE_CHANCE).toBe(0.1)
        const sim = boxSim()
        const p = sim.player(0)!
        p.weapons = [weapon(sim, p, 'kar98k'), weapon(sim, p, 'thompson')]
        p.slot = 0
        const rolls = 1500
        let moves = 0
        const visited = new Set<number>()
        for (let i = 0; i < rolls; i++) {
            const at = boxMap.boxSpots[sim.box.spot]!
            visited.add(sim.box.spot)
            p.pos = { ...at.pos }
            const before = p.points
            use(sim, 0, at.id)
            expect(sim.box.state).toBe('rolling')
            expect(p.points).toBe(before - DF_COSTS.box)
            step(sim, DF_MACHINE_TIMES.boxRoll + 0.05)
            if (sim.box.state === 'moving') {
                moves++
                expect(p.points).toBe(before)
                const from = sim.box.spot
                step(sim, DF_MACHINE_TIMES.boxMove + 0.05)
                expect(sim.box.state).toBe('idle')
                expect(sim.box.spot).not.toBe(from)
            } else {
                expect(sim.box.state).toBe('ready')
                sim['resetBox']()
            }
            expect(ids(p)).toEqual(['kar98k', 'thompson'])
        }
        const rate = moves / rolls
        expect(rate).toBeGreaterThan(0.065)
        expect(rate).toBeLessThan(0.135)
        // it may wander into the start zone later
        expect(visited.has(0)).toBe(true)
    })

    it('a move announces itself in the squad feed', () => {
        const sim = boxSim()
        sim['boxInternal'].willMove = true
        const at = boxMap.boxSpots[sim.box.spot]!
        sim.player(0)!.pos = { ...at.pos }
        sim.snapshot()
        use(sim, 0, at.id)
        sim['boxInternal'].willMove = true
        step(sim, DF_MACHINE_TIMES.boxRoll + 0.05)
        expect(sim.snapshot().events).toContainEqual({ k: 'box', what: 'move' })
    })
})

describe('solo pause', () => {
    it('freezes spawns, zombies and timers while paused, and only in solo', () => {
        const { sim } = makeSim()
        sim['devHold'] = false
        sim.startRound()
        const z = sim.debugSpawn('shambler', { x: 0, y: 0, z: 6 })
        sim.pause(0, true)
        expect(sim.paused).toBe(true)
        // the match layer stops stepping a paused sim
        const before = { time: sim.time, zombies: sim.zombies.length, pos: { ...z.pos } }
        for (let i = 0; i < 40; i++) if (!sim.paused) sim.step(0.05)
        expect(sim.time).toBe(before.time)
        expect(sim.zombies.length).toBe(before.zombies)
        expect(z.pos).toEqual(before.pos)
        sim.pause(0, false)
        expect(sim.paused).toBe(false)

        const coop = makeSim(2).sim
        coop.pause(0, true)
        expect(coop.paused).toBe(false)
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('the match stops ticking and sending snapshots while the solo player is paused', async () => {
        vi.useFakeTimers()
        const sent: string[] = []
        const profile = (): DfProfileView => ({
            unlockedWeapons: ['m1911'], weaponXp: {}, loadout: { startWeapon: 'm1911', attachments: {} }, researchPerk: null,
            perkXp: {}, perkMods: {}, gamesPlayed: 0, bestRound: 0, totalKills: 0, eggsCompleted: 0
        })
        const report: DfProgressReport = { perk: null, perkXpGained: 0, perkLevelBefore: 0, perkLevelAfter: 0, weaponXpGained: {}, weaponLevelsUp: {}, newWeapons: [] }
        const match = await DfMatch.create([{ userId: 'a', name: 'A' }], {
            send: (_u, frame) => sent.push(frame),
            onPlayerGone: () => {},
            onFinished: () => {},
            loadProfile: async () => profile(),
            applyResult: async () => report
        })
        vi.advanceTimersByTime(300)
        const t0 = match.sim.time
        expect(t0).toBeGreaterThan(0)
        match.handle('a', { t: 'pause', paused: true })
        const frames = sent.length
        vi.advanceTimersByTime(2000)
        expect(match.sim.time).toBe(t0)
        expect(sent.length).toBe(frames)
        match.handle('a', { t: 'pause', paused: false })
        vi.advanceTimersByTime(300)
        // resumes without a catch-up burst
        expect(match.sim.time).toBeGreaterThan(t0)
        expect(match.sim.time).toBeLessThan(t0 + 0.6)
        await match.finish()
    })
})
