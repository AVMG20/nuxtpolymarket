import { describe, expect, it } from 'vitest'
import { DF_COSTS, DF_MACHINE_TIMES } from '#shared/utils/dead-front/constants'
import { dfInteractables } from '#shared/utils/dead-front/map'
import {
    DF_KIT, DF_RARITIES, DF_RARITY_UPGRADE, dfBoxKitChance, dfBoxKitRoll, dfBoxRarityRoll, dfBoxRarityWeights, dfClampRarity,
    dfKitFits, dfKitTierWeights, dfRarityDamageMult, dfRarityUpgradeCost
} from '#shared/utils/dead-front/rarity'
import type { DfEvent } from '#shared/utils/dead-front/protocol'
import { dfWeaponStats } from '#shared/utils/dead-front/weapons'
import { DfMatchSim } from '#server/utils/dead-front/sim'
import type { DfPlayerSetup } from '#server/utils/dead-front/sim-types'

const setup = (userId: string): DfPlayerSetup => ({ userId, name: userId, startWeapon: 'm1911', attachments: {}, perkMods: {} })

function makeSim(players = 1) {
    const sim = new DfMatchSim(Array.from({ length: players }, (_, i) => setup(`u${i}`)), { now: () => 1000, startDelay: 1000 })
    return sim
}

function run(sim: DfMatchSim, seconds: number, dt = 0.05): DfEvent[] {
    const out: DfEvent[] = []
    for (let t = 0; t < seconds; t += dt) {
        sim.step(dt)
        out.push(...sim.snapshot().events)
    }
    return out
}

const share = (w: readonly number[], i: number) => w[i]! / w.reduce((a, b) => a + b, 0)

describe('rarity rules', () => {
    it('four tiers, each hitting harder; the wunderweapon has none', () => {
        expect(DF_RARITIES.map(r => r.name)).toEqual(['Common', 'Rare', 'Epic', 'Legendary'])
        const base = dfWeaponStats('thompson', 0, {})
        for (const r of DF_RARITIES) {
            const s = dfWeaponStats('thompson', 0, {}, r.tier)
            expect(s.damage).toBeCloseTo(base.damage * r.damage, 5)
            expect(s.magSize).toBe(base.magSize)
        }
        expect(dfWeaponStats('wunder', 0, {}, 3).damage).toBe(dfWeaponStats('wunder', 0, {}).damage)
        expect(dfRarityDamageMult('wunder', 3)).toBe(1)
        // on top of Pack-a-Punch, independent of it
        expect(dfWeaponStats('thompson', 2, {}, 2).damage).toBeCloseTo(dfWeaponStats('thompson', 2, {}).damage * 1.55, 5)
        expect(dfClampRarity(7)).toBe(3)
        expect(dfClampRarity(Number.NaN)).toBe(0)
    })

    it('the box: mostly common early, no commons and plenty of legendaries by round 20', () => {
        expect(share(dfBoxRarityWeights(1), 0)).toBeGreaterThan(0.75)
        expect(share(dfBoxRarityWeights(5), 0)).toBeGreaterThan(0.6)
        expect(share(dfBoxRarityWeights(20), 0)).toBe(0)
        expect(share(dfBoxRarityWeights(30), 3)).toBeGreaterThanOrEqual(0.25)
        for (let r = 2; r <= 25; r++) expect(share(dfBoxRarityWeights(r), 3)).toBeGreaterThanOrEqual(share(dfBoxRarityWeights(r - 1), 3))
        expect(dfBoxRarityRoll(1, 0)).toBe(0)
        expect(dfBoxRarityRoll(1, 0.9999)).toBe(3)
        expect(dfBoxRarityRoll(20, 0)).toBe(1)
    })

    it('upgrade kits: rarer early, more and better later', () => {
        expect(dfBoxKitChance(1)).toBeCloseTo(DF_KIT.chance[0])
        expect(dfBoxKitChance(25)).toBeCloseTo(DF_KIT.chance[1])
        expect(dfBoxKitChance(10)).toBeGreaterThan(dfBoxKitChance(4))
        expect(share(dfKitTierWeights(20), 2)).toBeGreaterThan(share(dfKitTierWeights(1), 2))
        expect(dfBoxKitRoll(1, 0.5, 0)).toBeNull()
        expect(dfBoxKitRoll(1, 0, 0)).toBe(1)
        expect(dfBoxKitRoll(1, 0, 0.9999)).toBe(3)
        expect(dfKitFits(2, 'thompson', 0)).toBe('apply')
        expect(dfKitFits(2, 'thompson', 2)).toBe('keep')
        expect(dfKitFits(2, 'thompson', 3)).toBe('keep')
        expect(dfKitFits(3, 'wunder', 0)).toBe('none')
    })

    it('bench costs rise per tier, parts for the top', () => {
        expect(dfRarityUpgradeCost(0)).toEqual(DF_RARITY_UPGRADE[0])
        expect(dfRarityUpgradeCost(2)!.parts).toBeGreaterThan(0)
        expect(dfRarityUpgradeCost(1)!.scrap).toBeGreaterThan(dfRarityUpgradeCost(0)!.scrap)
        expect(dfRarityUpgradeCost(3)).toBeNull()
    })
})

describe('rarity in the match', () => {
    it('a box weapon comes with its rarity, shown on offer and in the snapshot; Pack-a-Punch keeps it', () => {
        const sim = makeSim()
        const p = sim.player(0)!
        p.points = 100000
        const box = sim.map.boxSpots[sim.box.spot]!
        p.pos = { ...box.pos }
        sim.use(0, box.id)
        sim['boxInternal'].willMove = false
        sim['boxInternal'].kit = null
        sim['boxInternal'].rarity = 2
        run(sim, DF_MACHINE_TIMES.boxRoll + 0.2)
        expect(sim.box.state).toBe('ready')
        expect(sim.box.rarity).toBe(2)
        const offered = sim.box.weapon!
        sim.use(0, box.id)
        const w = p.weapons.find(x => x.id === offered)!
        expect(w.rarity).toBe(2)
        expect(w.stats.damage).toBeCloseTo(dfWeaponStats(offered, 0, {}, 2).damage, 5)
        expect(sim.snapshot().world.box.rarity).toBeUndefined()
        const snapW = sim.snapshot().players[0]!.weapons.find(x => x.id === offered)!
        expect(snapW.rarity).toBe(2)
        // Pack-a-Punch it: it comes back packed and still Epic
        sim.power = true
        p.slot = p.weapons.indexOf(w)
        p.pos = { ...sim.map.pap.pos }
        sim.use(0, sim.map.pap.id)
        run(sim, DF_MACHINE_TIMES.papWork + 0.2)
        p.useCooldown.clear()
        sim.use(0, sim.map.pap.id)
        const packed = p.weapons.find(x => x.id === offered)!
        expect(packed.pap).toBe(1)
        expect(packed.rarity).toBe(2)
        expect(packed.stats.damage).toBeCloseTo(dfWeaponStats(offered, 1, {}, 2).damage, 5)
    })

    it('a box kit raises the held weapon, or is set down when it is already that good', () => {
        const sim = makeSim()
        const p = sim.player(0)!
        p.points = 100000
        const box = sim.map.boxSpots[sim.box.spot]!
        const roll = (kit: 1 | 2 | 3) => {
            p.pos = { ...box.pos }
            p.useCooldown.clear()
            sim.use(0, box.id)
            sim['boxInternal'].willMove = false
            sim['boxInternal'].kit = kit
            run(sim, DF_MACHINE_TIMES.boxRoll + 0.2)
            expect(sim.box.kit).toBe(kit)
            expect(sim.box.weapon).toBeUndefined()
            p.useCooldown.clear()
            sim.use(0, box.id)
        }
        roll(2)
        expect(p.weapons[0]!.rarity).toBe(2)
        expect(sim.box.state).toBe('idle')
        // Epic again on an Epic pistol: it goes on the ground, not to waste
        sim.snapshot()
        roll(2)
        expect(p.weapons[0]!.rarity).toBe(2)
        expect(sim.arsenal.kits).toHaveLength(1)
        expect(sim.snapshot().world.arsenal!.kits).toHaveLength(1)
        expect(p.points).toBe(100000 - 2 * DF_COSTS.box)
    })

    it('a dropped kit: anyone can take it once, not onto a weapon already that good, and it goes after two minutes', () => {
        const sim = makeSim(2)
        const [a, b] = sim.players
        const at = { x: a!.pos.x + 1, y: 0, z: a!.pos.z }
        const id = sim.arsenal.debugKit(3, at)
        a!.pos = { ...at }
        b!.pos = { ...at }
        a!.weapons[0]!.rarity = 3
        // already Legendary: it stays
        expect(sim.arsenal.handle(a!, { k: 'kit', id })).toBe(false)
        expect(sim.arsenal.kits).toHaveLength(1)
        // b takes it; a repeat (or a parallel claim) finds nothing
        let ok = 0
        for (let i = 0; i < 5; i++) for (const p of [b!, a!]) if (sim.arsenal.handle(p, { k: 'kit', id })) ok++
        expect(ok).toBe(1)
        expect(b!.weapons[0]!.rarity).toBe(3)
        expect(b!.weapons[0]!.stats.damage).toBeCloseTo(dfWeaponStats('m1911', 0, {}, 3).damage, 5)
        expect(sim.arsenal.kits).toHaveLength(0)
        // too far, or expired
        const far = sim.arsenal.debugKit(1, { x: at.x + 10, y: 0, z: at.z })
        b!.weapons[0]!.rarity = 0
        expect(sim.arsenal.handle(b!, { k: 'kit', id: far })).toBe(false)
        sim.dev(0, { k: 'god', on: true })
        sim.dev(1, { k: 'god', on: true })
        sim.dev(0, { k: 'hold', on: true })
        run(sim, DF_KIT.life + 0.5, 0.5)
        expect(sim.arsenal.kits).toHaveLength(0)
    })

    it('the bench upgrades a tier at a time: salvage first, and a repeat can\'t double up', () => {
        const sim = makeSim()
        const p = sim.player(0)!
        const bench = dfInteractables(sim.map).find(i => i.kind === 'bench')!
        p.pos = { ...bench.pos }
        const pool = sim.arsenal.gearOf(p).pool
        pool.scrap = DF_RARITY_UPGRADE[0]!.scrap + DF_RARITY_UPGRADE[1]!.scrap - 1
        pool.parts = DF_RARITY_UPGRADE[1]!.parts
        let ok = 0
        for (let i = 0; i < 8; i++) if (sim.arsenal.handle(p, { k: 'upgrade', bench: bench.id, slot: 0, from: 0 })) ok++
        expect(ok).toBe(1)
        expect(p.weapons[0]!.rarity).toBe(1)
        expect(pool.scrap).toBe(DF_RARITY_UPGRADE[1]!.scrap - 1)
        // one short for the next tier
        expect(sim.arsenal.handle(p, { k: 'upgrade', bench: bench.id, slot: 0, from: 1 })).toBe(false)
        pool.scrap++
        expect(sim.arsenal.handle(p, { k: 'upgrade', bench: bench.id, slot: 0, from: 1 })).toBe(true)
        expect(p.weapons[0]!.rarity).toBe(2)
        expect(pool).toEqual({ scrap: 0, parts: 0 })
        const events = sim.snapshot().events.filter(e => e.k === 'rarity')
        expect(events.map(e => e.k === 'rarity' && e.rarity)).toEqual([1, 2])
        // the wunderweapon takes none
        p.weapons.push({ ...p.weapons[0]!, id: 'wunder', rarity: undefined })
        pool.scrap = 99
        expect(sim.arsenal.handle(p, { k: 'upgrade', bench: bench.id, slot: 1, from: 0 })).toBe(false)
    })
})
