import { describe, expect, it } from 'vitest'
import type { DfMapDef } from '#shared/utils/dead-front/map'
import type { DfEvent, DfShotHit } from '#shared/utils/dead-front/protocol'
import type { DfWeaponId } from '#shared/utils/dead-front/types'
import { DF_RARITIES } from '#shared/utils/dead-front/rarity'
import { dfWeaponStats } from '#shared/utils/dead-front/weapons'
import { DF_BURN, DF_CHAIN, DF_PAP_PERKS, dfChainFires, dfHasPapPerk, dfPapNewPerks, dfPapPerks, dfShotgunBlast } from '#shared/utils/dead-front/gunplay'
import { DfMatchSim } from '#server/utils/dead-front/sim'

// Gun feel rules that change play: Pack-a-Punch perks (one-motion reloads,
// fire, bursts, chain lightning, stagger), the shotgun's close-range blast and
// the handling a rarity tier brings.

const SPOT = (id: string, x: number, z: number) => ({ id, pos: { x, y: 0, z }, yaw: 0, zone: 'a' })
const FLAT: DfMapDef = {
    id: 'flat', name: 'Flat',
    bounds: { min: { x: -60, y: -1, z: -60 }, max: { x: 60, y: 12, z: 60 } },
    startZone: 'a',
    playerSpawns: [{ x: 0, y: 0, z: 0 }],
    solids: [{ min: { x: -60, y: -1, z: -60 }, max: { x: 60, y: 0, z: 60 }, mat: 'mud' }],
    zones: [{ id: 'a', name: 'A' }],
    doors: [], barricades: [], wallBuys: [], perks: [],
    boxSpots: [SPOT('box', 30, 30)], pap: SPOT('pap', -30, 30), power: SPOT('power', 30, -30),
    egg: { fuses: [], generator: SPOT('gen', -30, -30), pedestal: SPOT('ped', 0, -30), chargeRadius: 6 },
    riserSpawns: [SPOT('r', 50, 50)],
    nav: { nodes: [{ id: 0, pos: { x: 0, y: 0, z: 0 }, zone: 'a' }], links: [] },
    lights: []
}

const EYE = { x: 0, y: 1.62, z: 0 }

function armed(weapon: DfWeaponId, pap = 0) {
    let clock = 100
    const sim = new DfMatchSim([{ userId: 'u', name: 'u', startWeapon: 'm1911', attachments: {}, perkMods: {} }], { map: FLAT, now: () => clock, startDelay: 1000 })
    sim.dev(0, { k: 'hold', on: true })
    const p = sim.player(0)!
    p.weapons = [{ ...p.weapons[0]!, id: weapon, pap, stats: dfWeaponStats(weapon, pap), mag: 999, reserve: 999 }]
    p.slot = 0
    let t = 100
    const events: DfEvent[] = []
    /** Fires `pellets` rays at a zombie `d` metres down -z, each claiming a body hit. */
    const shoot = (zid: number, d: number, pellets = 1) => {
        t += 2
        clock = t
        const dirs = Array.from({ length: pellets }, () => ({ x: 0, y: -0.5 / d, z: -1 }))
        const hits: DfShotHit[] = Array.from({ length: pellets }, () => ({ z: zid, zone: 'body', dist: d }))
        sim.fire(0, { origin: EYE, dirs, hits })
        events.push(...sim.snapshot().events)
    }
    const step = (seconds: number) => {
        for (let s = 0; s < seconds; s += 0.05) {
            sim.step(0.05)
            events.push(...sim.snapshot().events)
        }
    }
    return { sim, p, shoot, step, events }
}

describe('Pack-a-Punch perks', () => {
    it('add up tier by tier and every perk has a name', () => {
        expect(dfPapPerks('m1897', 0)).toEqual([])
        expect(dfPapPerks('m1897', 1)).toEqual(['quadload'])
        expect(dfPapPerks('m1897', 3)).toEqual(['quadload', 'dragon', 'autoload'])
        expect(dfPapNewPerks('m1897', 2)).toEqual(['dragon'])
        expect(dfHasPapPerk('thompson', 2, 'chain')).toBe(true)
        expect(dfHasPapPerk('thompson', 1, 'chain')).toBe(false)
        for (const id of ['m1911', 'c96', 'webley', 'm1897', 'sawnoff', 'kar98k', 'win1895', 'thompson', 'mp18', 'ppsh', 'bar', 'lewis', 'chauchat', 'flammen', 'xray'] as DfWeaponId[]) {
            expect(dfPapPerks(id, 3).length, id).toBeGreaterThan(0)
            for (const k of dfPapPerks(id, 3)) expect(DF_PAP_PERKS[k].name).toBeTruthy()
        }
    })

    it('a packed trench gun loads every shell in one motion, much faster than shell by shell', () => {
        const base = dfWeaponStats('m1897', 0)
        expect(base.perRoundReload).toBeGreaterThan(0)
        for (const tier of [1, 2, 3]) {
            const s = dfWeaponStats('m1897', tier)
            expect(s.perRoundReload).toBe(0)
            expect(s.reloadEmptyTime).toBeLessThan(base.perRoundReload * s.magSize * 0.5)
        }
        expect(dfWeaponStats('webley', 1).reloadTime).toBeLessThan(dfWeaponStats('webley', 0).reloadTime * 0.7)
        expect(dfWeaponStats('lewis', 1).reloadTime).toBeLessThan(dfWeaponStats('lewis', 0).reloadTime * 0.7)
    })

    it('Dragon\'s Breath sets a zombie burning: it keeps losing health, pays no hit points for the fire, and the burn kill pays', () => {
        const { sim, p, shoot, step } = armed('mp18', 1)
        const z = sim.debugSpawn('shambler', { x: 0, y: 0, z: -6 }, 400)
        shoot(z.id, 6)
        const hp = z.hp
        expect(z.burn).toBeTruthy()
        expect(sim.snapshot().zombies.find(q => q.id === z.id)?.burning).toBe(true)
        const points = p.points
        step(DF_BURN.tick * 2 + 0.05)
        expect(z.hp).toBeLessThan(hp)
        expect(p.points).toBe(points)
        z.hp = 1
        step(DF_BURN.tick + 0.05)
        expect(sim.zombies.includes(z)).toBe(false)
        expect(p.points).toBeGreaterThan(points)
    })

    it('Blast Rounds: a kill bursts and hurts the zombie next to it', () => {
        const { sim, shoot, events } = armed('kar98k', 1)
        const a = sim.debugSpawn('shambler', { x: 0, y: 0, z: -10 }, 10)
        const b = sim.debugSpawn('shambler', { x: 1, y: 0, z: -10 }, 1e6)
        shoot(a.id, 10)
        expect(events.some(e => e.k === 'kill' && e.z === a.id)).toBe(true)
        expect(events.some(e => e.k === 'explode')).toBe(true)
        expect(b.hp).toBeLessThan(1e6)
    })

    it('Chain Lightning arcs on every fourth shot that hits, to the zombies around', () => {
        const { sim, shoot, events } = armed('thompson', 2)
        const a = sim.debugSpawn('shambler', { x: 0, y: 0, z: -8 }, 1e6)
        const b = sim.debugSpawn('shambler', { x: 2, y: 0, z: -8 }, 1e6)
        expect(dfChainFires(DF_CHAIN.every)).toBe(true)
        for (let i = 1; i < DF_CHAIN.every; i++) shoot(a.id, 8)
        expect(events.some(e => e.k === 'arc')).toBe(false)
        const hp = b.hp
        shoot(a.id, 8)
        expect(events.some(e => e.k === 'arc')).toBe(true)
        expect(b.hp).toBeLessThan(hp)
    })

    it('Stopping Power staggers, but not again while the knockback cools down', () => {
        const { sim, shoot, step } = armed('webley', 2)
        const z = sim.debugSpawn('shambler', { x: 0, y: 0, z: -8 }, 1e6)
        z.state = 'hunt'
        shoot(z.id, 8)
        expect(z.state).toBe('stagger')
        z.state = 'hunt'
        shoot(z.id, 8)
        expect(z.state).toBe('hunt')
        step(1.7)
        z.state = 'hunt'
        shoot(z.id, 8)
        expect(z.state).toBe('stagger')
    })
})

describe('the shotgun blast', () => {
    it('gibs a kill and staggers a survivor up close with most of the pellets in it', () => {
        expect(dfShotgunBlast('shotgun', 6, 8, 2, true)).toBe('gib')
        expect(dfShotgunBlast('shotgun', 6, 8, 2, false)).toBe('stagger')
        expect(dfShotgunBlast('shotgun', 6, 8, 9, true)).toBeNull()
        expect(dfShotgunBlast('shotgun', 1, 8, 2, true)).toBeNull()
        expect(dfShotgunBlast('smg', 1, 1, 2, true)).toBeNull()
        expect(dfShotgunBlast('shotgun', 5, 8, 2, false, true)).toBeNull()
        expect(dfShotgunBlast('shotgun', 8, 8, 2, false, true)).toBe('stagger')
    })

    it('in the match: a point-blank kill blows the zombie apart, a hit throws one back', () => {
        const { sim, shoot, events } = armed('m1897')
        const pellets = dfWeaponStats('m1897', 0).pellets
        const a = sim.debugSpawn('shambler', { x: 0, y: 0, z: -2 }, 10)
        shoot(a.id, 2, pellets)
        expect(events.find(e => e.k === 'kill' && e.z === a.id)).toMatchObject({ gib: true })
        const b = sim.debugSpawn('shambler', { x: 0, y: 0, z: -2 }, 1e6)
        b.state = 'hunt'
        shoot(b.id, 2, pellets)
        expect(b.state).toBe('stagger')
    })
})

describe('rarity handling', () => {
    it('each tier reloads quicker, kicks softer and aims faster', () => {
        for (let i = 1; i < DF_RARITIES.length; i++) {
            const lo = dfWeaponStats('thompson', 0, {}, i - 1)
            const hi = dfWeaponStats('thompson', 0, {}, i)
            expect(hi.reloadTime).toBeLessThan(lo.reloadTime)
            expect(hi.recoil).toBeLessThan(lo.recoil)
            expect(hi.adsTime).toBeLessThan(lo.adsTime)
        }
        // per-shell weapons get the quicker shells too; the wunderweapon has no rarity
        expect(dfWeaponStats('m1897', 0, {}, 3).perRoundReload).toBeLessThan(dfWeaponStats('m1897', 0).perRoundReload)
        expect(dfWeaponStats('wunder', 0, {}, 3).reloadTime).toBe(dfWeaponStats('wunder', 0).reloadTime)
    })
})
