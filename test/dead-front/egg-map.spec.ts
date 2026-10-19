import { describe, expect, it } from 'vitest'
import { DF_PLAYER } from '#shared/utils/dead-front/constants'
import { DF_MAP, dfInteractables } from '#shared/utils/dead-front/map'
import type { DfInteractable } from '#shared/utils/dead-front/map'
import { dfBodyFits, dfBuildCollision, dfGroundHeight } from '#shared/utils/dead-front/physics'
import type { Vec3 } from '#shared/utils/dead-front/types'
import { DfMatchSim } from '#server/utils/dead-front/sim'
import { dfObjectiveTarget } from '../../app/utils/dead-front/engine/objective'
import { dfPickInteractable, dfPromptFor } from '../../app/utils/dead-front/engine/prompt'

// The easter egg on the real map, step by step, the way a player does it:
// stand somewhere reachable in front of each part, check the prompt the HUD
// would show, press F, and follow the objective waypoint to the next part.

const ITEMS = dfInteractables(DF_MAP)

/** A standing spot within use range of an interactable (the body fits, on a floor near its height). */
function standNear(sim: DfMatchSim, it: DfInteractable): Vec3 {
    const body = { radius: DF_PLAYER.radius, height: DF_PLAYER.height }
    for (const r of [1.2, 1.6, 2, 0.8]) {
        for (let k = 0; k < 16; k++) {
            const a = (k / 16) * Math.PI * 2
            const x = it.pos.x + Math.sin(a) * r
            const z = it.pos.z + Math.cos(a) * r
            for (const fromY of [it.pos.y + 1.2, it.pos.y + 0.2, it.pos.y - 1]) {
                const y = dfGroundHeight(sim.world, x, z, fromY)
                // the server takes uses within 2.2 m of height
                if (!Number.isFinite(y) || Math.abs(y - it.pos.y) > 2) continue
                const p = { x, y, z }
                if (!dfBodyFits(sim.world, p, body)) continue
                return p
            }
        }
    }
    throw new Error(`nowhere to stand near ${it.id}`)
}

function useAs(sim: DfMatchSim, it: DfInteractable, expectText?: RegExp): void {
    const p = sim.player(0)!
    const at = standNear(sim, it)
    sim.dev(0, { k: 'tp', pos: at })
    const snap = sim.snapshot()
    const me = snap.players[0]!
    const prompt = dfPromptFor(it, { map: DF_MAP, world: snap.world, me, solo: true })
    expect(prompt, it.id).not.toBeNull()
    expect(prompt!.action, `${it.id}: ${prompt!.text}`).toBe('use')
    if (expectText) expect(prompt!.text).toMatch(expectText)
    // facing it, the prompt picker lands on it (or something at the same spot)
    const eye = { x: at.x, y: at.y + DF_PLAYER.eyeHeight, z: at.z }
    const idx = dfPickInteractable(ITEMS, eye, it.pos.x - at.x, it.pos.z - at.z, DF_PLAYER.useRange, i => dfPromptFor(ITEMS[i]!, { map: DF_MAP, world: snap.world, me, solo: true }) === null)
    expect(idx, it.id).toBeGreaterThanOrEqual(0)
    p.useCooldown.clear()
    sim.use(0, it.id)
}

describe('the easter egg on Sainte-Croix', () => {
    it('runs power -> fuses -> install -> charge -> rods -> claim with the right prompts and waypoints', () => {
        let sim: DfMatchSim | null = null
        sim = new DfMatchSim([{ userId: 'u', name: 'u', startWeapon: 'm1911', attachments: {}, perkMods: {} }], { now: () => sim?.time ?? 0, startDelay: 1000 })
        const s = sim
        s.dev(0, { k: 'points', amount: 100_000 })
        s.dev(0, { k: 'hold', on: true })
        // open every door, in an order that's always reachable
        const open = new Set<string>()
        for (let pass = 0; pass < DF_MAP.doors.length; pass++) {
            for (const d of DF_MAP.doors) {
                if (open.has(d.id)) continue
                if (!d.zones.some(z => s.activeZones.has(z))) continue
                useAs(s, ITEMS.find(i => i.id === d.id)!, /debris/)
                open.add(d.id)
            }
        }
        expect(open.size).toBe(DF_MAP.doors.length)

        const target = () => dfObjectiveTarget(s.egg, s.power, DF_MAP, s.player(0)!.pos)
        // before the power, the fuses and generator explain themselves but do nothing
        const fuse0 = ITEMS.find(i => i.kind === 'fuse')!
        expect(dfPromptFor(fuse0, { map: DF_MAP, world: s.snapshot().world, me: s.snapshot().players[0]!, solo: true })!.action).toBe('none')

        expect(target()!.pos).toEqual(DF_MAP.power.pos)
        useAs(s, ITEMS.find(i => i.kind === 'power')!, /power/)
        expect(s.power).toBe(true)
        expect(s.egg.step).toBe('fuses')

        for (let n = 0; n < DF_MAP.egg.fuses.length; n++) {
            const t = target()!
            const fuse = ITEMS.find(i => i.kind === 'fuse' && i.pos === t.pos)!
            expect(fuse, 'waypoint points at a fuse').toBeDefined()
            useAs(s, fuse, /fuse/)
        }
        expect(s.egg.step).toBe('install')
        expect(target()!.pos).toEqual(DF_MAP.egg.generator.pos)
        const gen = ITEMS.find(i => i.kind === 'generator')!
        useAs(s, gen, /install/)
        expect(s.egg.step).toBe('charge')
        const charging = dfPromptFor(gen, { map: DF_MAP, world: s.snapshot().world, me: s.snapshot().players[0]!, solo: true })!
        expect(charging.text).toMatch(/Charge 0\//)

        // feed it: kills close to the generator
        const p = s.player(0)!
        for (let k = 0; k < s.egg.chargeNeeded; k++) {
            const z = s.debugSpawn('shambler', { ...standNear(s, gen) }, 1)
            s['killZombie'](z, p, 'body', { weapon: 'knife', credit: null })
        }
        expect(s.egg.step).toBe('rods')
        // the pedestal and the generator point at the rods; each rod is thrown once, the waypoint walks them
        const ped = ITEMS.find(i => i.kind === 'pedestal')!
        expect(dfPromptFor(ped, { map: DF_MAP, world: s.snapshot().world, me: s.snapshot().players[0]!, solo: true })!.action).toBe('none')
        expect(DF_MAP.egg.rods).toHaveLength(3)
        expect(DF_MAP.egg.rods.some(r => r.pos.y > 1), 'one rod up on the raised level').toBe(true)
        const thrown: string[] = []
        for (let n = 0; n < DF_MAP.egg.rods.length; n++) {
            const t = target()!
            expect(t.label).toBe('Lightning rod')
            const rod = ITEMS.find(i => i.kind === 'rod' && i.pos === t.pos)!
            expect(rod, 'waypoint points at a rod').toBeDefined()
            expect(thrown).not.toContain(rod.id)
            useAs(s, rod, /lightning-rod switch/)
            thrown.push(rod.id)
            if (n < DF_MAP.egg.rods.length - 1) {
                expect(s.egg.rodsOn).toHaveLength(n + 1)
                expect(s.egg.rodTimer).toBeGreaterThan(0)
                const again = dfPromptFor(rod, { map: DF_MAP, world: s.snapshot().world, me: s.snapshot().players[0]!, solo: true })!
                expect(again.text).toBe('Already thrown')
                expect(again.action).toBe('none')
            }
            // walking to the next one takes a while (zombies keep coming meanwhile)
            for (let k = 0; k < 10; k++) s.step(1)
        }
        expect(s.egg.step).toBe('claim')
        expect(target()!.pos).toEqual(DF_MAP.egg.pedestal.pos)
        useAs(s, ITEMS.find(i => i.kind === 'pedestal')!, /wonder weapon/)
        expect(s.egg.step).toBe('done')
        expect(p.weapons.some(w => w.id === 'wunder')).toBe(true)
        expect(target()).toBeNull()
    })

    it('the lightning rods reset when the clock runs out, and can be thrown again', () => {
        let sim: DfMatchSim | null = null
        sim = new DfMatchSim([{ userId: 'u', name: 'u', startWeapon: 'm1911', attachments: {}, perkMods: {} }], { now: () => sim?.time ?? 0, startDelay: 1000 })
        const s = sim
        for (const d of DF_MAP.doors) s.doors.add(d.id)
        s.world = dfBuildCollision(DF_MAP, s.doors)
        s.dev(0, { k: 'hold', on: true })
        s.dev(0, { k: 'egg', step: 'rods' })
        expect(s.egg.step).toBe('rods')
        expect(s.power).toBe(true)
        const rods = ITEMS.filter(i => i.kind === 'rod')
        expect(rods.map(r => r.id).sort()).toEqual(['rod-0', 'rod-1', 'rod-2'])
        s.snapshot()
        useAs(s, rods[0]!)
        useAs(s, rods[1]!)
        expect(s.egg.rodsOn).toHaveLength(2)
        const events = (): { k: string, on?: boolean, n?: number }[] => s.snapshot().events as { k: string, on?: boolean, n?: number }[]
        events()
        for (let k = 0; k < 70; k++) s.step(1)
        const resets = events().filter(e => e.k === 'rod')
        expect(resets.map(e => [e.on, e.n])).toEqual([[false, 1], [false, 0]])
        expect(s.egg.step).toBe('rods')
        expect(s.egg.rodsOn).toEqual([])
        expect(s.egg.rodTimer).toBe(0)
        for (const r of rods) useAs(s, r)
        expect(s.egg.step).toBe('claim')
    })

    it('every buyable on the map can be reached and used from where a player can stand', () => {
        let sim: DfMatchSim | null = null
        sim = new DfMatchSim([{ userId: 'u', name: 'u', startWeapon: 'm1911', attachments: {}, perkMods: {} }], { now: () => sim?.time ?? 0, startDelay: 1000 })
        const s = sim
        for (const d of DF_MAP.doors) s.doors.add(d.id)
        s.world = dfBuildCollision(DF_MAP, s.doors)
        for (const it of ITEMS) {
            if (it.kind === 'door') continue
            expect(() => standNear(s, it), it.id).not.toThrow()
        }
    })
})
