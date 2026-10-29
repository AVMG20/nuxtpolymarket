import { describe, expect, it } from 'vitest'
import { DF_CRATE, dfCrateBlocked } from '#shared/utils/dead-front/salvage'
import { DF_SUPPORT_HELD } from '#shared/utils/dead-front/support'
import type { DfEvent } from '#shared/utils/dead-front/protocol'
import { DfMatchSim } from '#server/utils/dead-front/sim'
import type { DfPlayerSetup, SimPlayer, SimZombie } from '#server/utils/dead-front/sim-types'

const setup = (userId: string): DfPlayerSetup => ({ userId, name: userId, startWeapon: 'm1911', attachments: {}, perkMods: {} })

function makeSim(players = 2) {
    const sim = new DfMatchSim(Array.from({ length: players }, (_, i) => setup(`u${i}`)), { now: () => 1000, startDelay: 1000 })
    sim.dev(0, { k: 'hold', on: true })
    return sim
}

function run(sim: DfMatchSim, seconds: number, dt = 0.25): DfEvent[] {
    const out: DfEvent[] = []
    for (let t = 0; t < seconds; t += dt) {
        sim.step(dt)
        out.push(...sim.snapshot().events)
    }
    return out
}

/** Kills a zombie as `p` through the sim's own kill path. */
function kill(sim: DfMatchSim, p: SimPlayer, z: SimZombie): void {
    (sim as unknown as { killZombie: (z: unknown, p: unknown, zone: string, src: unknown) => void }).killZombie(z, p, 'body', { weapon: 'm1911', credit: 'm1911' })
}

describe('supply crates', () => {
    it('a rare kill drops a crate with a bench item in it, picked uniformly', () => {
        const sim = makeSim(1)
        const p = sim.player(0)!
        const asked: number[] = []
        let picked: readonly string[] = []
        sim.arsenal.rng = {
            chance: (c: number) => {
                asked.push(c)
                return true
            },
            pick: <T>(items: readonly T[]) => {
                picked = items as readonly string[]
                return items[items.length - 1]!
            }
        }
        kill(sim, p, sim.debugSpawn('shambler', { x: p.pos.x + 6, y: 0, z: p.pos.z }, 1))
        expect(asked).toContain(DF_CRATE.chance)
        expect(picked).toEqual(DF_CRATE.items)
        expect(sim.arsenal.crates).toHaveLength(1)
        expect(sim.arsenal.crates[0]).toMatchObject({ owner: p.pid, item: 'bomber' })
        // no roll, no crate
        sim.arsenal.rng = { chance: () => false, pick: <T>(items: readonly T[]) => items[0]! }
        kill(sim, p, sim.debugSpawn('shambler', { x: p.pos.x + 6, y: 0, z: p.pos.z }, 1))
        expect(sim.arsenal.crates).toHaveLength(1)
    })

    it('the killer\'s alone for 15 s: nobody else sees it or can take it', () => {
        const sim = makeSim()
        const [a, b] = sim.players
        const at = { x: a!.pos.x + 4, y: 0, z: a!.pos.z }
        const id = sim.arsenal.debugCrate(a!.pid, 'bomber', at)
        b!.pos = { ...at }
        run(sim, DF_CRATE.private - 1)
        expect(sim.arsenal.crates.map(c => c.id)).toEqual([id])
        expect(sim.arsenal.takeCrate(b!, id)).toBe(false)
        expect(sim.snapshot().world.arsenal!.crates).toBeUndefined()
        expect(sim.arsenal.mine(b!.pid).crates).toEqual([])
        const mineA = sim.arsenal.mine(a!.pid).crates
        expect(mineA).toHaveLength(1)
        expect(mineA[0]).toMatchObject({ id, item: 'bomber', open: false })
        expect(mineA[0]!.opensIn).toBeGreaterThan(0)
        // the killer walks over it: theirs, privately
        a!.pos = { ...at }
        sim.step(0.05)
        expect(sim.arsenal.gearOf(a!).support).toEqual(['bomber'])
        expect(sim.arsenal.gearOf(b!).support).toEqual([])
        expect(sim.snapshot().events.some(e => e.k === 'crate')).toBe(false)
        expect(sim.arsenal.mine(a!.pid).events.filter(e => e.k === 'crate')).toEqual([{ k: 'crate', p: a!.pid, owner: a!.pid, item: 'bomber', id, pos: { x: at.x, y: 0, z: at.z } }])
    })

    it('after 15 s anyone sees it and can take it; gone at 60 s', () => {
        const sim = makeSim()
        const [a, b] = sim.players
        const at = { x: a!.pos.x + 4, y: 0, z: a!.pos.z }
        const id = sim.arsenal.debugCrate(a!.pid, 'zeppelin', at)
        run(sim, DF_CRATE.private + 0.5)
        const shared = sim.snapshot().world.arsenal!.crates!
        expect(shared).toHaveLength(1)
        expect(shared[0]).toMatchObject({ id, open: true, owner: a!.pid })
        // no longer in the private slice (no double drawing)
        expect(sim.arsenal.mine(a!.pid).crates).toEqual([])
        b!.pos = { ...at }
        sim.step(0.05)
        const ev = sim.snapshot().events.find(e => e.k === 'crate')!
        expect(ev).toMatchObject({ k: 'crate', p: b!.pid, owner: a!.pid, item: 'zeppelin' })
        expect(sim.arsenal.gearOf(b!).support).toEqual(['zeppelin'])
        // another one nobody takes rusts away a minute after it dropped
        sim.arsenal.debugCrate(a!.pid, 'sentry', { x: a!.pos.x - 6, y: 0, z: a!.pos.z })
        run(sim, DF_CRATE.life - 1)
        expect(sim.arsenal.crates).toHaveLength(1)
        run(sim, 1.5)
        expect(sim.arsenal.crates).toHaveLength(0)
    })

    it('two players on an open crate in the same tick: only one gets it', () => {
        const sim = makeSim(3)
        const [a, b, c] = sim.players
        const at = { x: a!.pos.x + 4, y: 0, z: a!.pos.z }
        const id = sim.arsenal.debugCrate(c!.pid, 'launcher', at)
        run(sim, DF_CRATE.private + 0.5)
        a!.pos = { ...at }
        b!.pos = { ...at }
        sim.step(0.05)
        const got = [a!, b!].filter(p => sim.arsenal.gearOf(p).support.includes('launcher'))
        expect(got).toHaveLength(1)
        expect(sim.arsenal.crates).toHaveLength(0)
        // the same claim again finds nothing
        expect(sim.arsenal.takeCrate(a!, id)).toBe(false)
        expect(sim.arsenal.takeCrate(b!, id)).toBe(false)
        expect(sim.snapshot().events.filter(e => e.k === 'crate')).toHaveLength(1)
    })

    it('if you can\'t carry it, it stays for someone who can', () => {
        const sim = makeSim()
        const [a, b] = sim.players
        const at = { x: a!.pos.x + 4, y: 0, z: a!.pos.z }
        sim.arsenal.gearOf(a!).support = ['barrage', 'barrage', 'barrage']
        const id = sim.arsenal.debugCrate(a!.pid, 'bomber', at)
        a!.pos = { ...at }
        run(sim, 1)
        expect(sim.arsenal.crates.map(x => x.id)).toEqual([id])
        expect(sim.arsenal.gearOf(a!).support).toHaveLength(DF_SUPPORT_HELD.max)
        // once it's open, the teammate takes it
        run(sim, DF_CRATE.private)
        b!.pos = { ...at }
        sim.step(0.05)
        expect(sim.arsenal.gearOf(b!).support).toEqual(['bomber'])
        // gear in hand and a kit already held block their items too
        expect(dfCrateBlocked('sentry', { equip: 'decoy', kit: false, support: 0, supportMax: 3 })).toBe('hands')
        expect(dfCrateBlocked('kit', { equip: null, kit: true, support: 0, supportMax: 3 })).toBe('have')
        expect(dfCrateBlocked('kit', { equip: null, kit: false, support: 3, supportMax: 3 })).toBeNull()
    })
})
