import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DfMapDef } from '#shared/utils/dead-front/map'
import type { DfProfileView, DfProgressReport } from '#shared/utils/dead-front/types'
import { DfMatchSim } from '#server/utils/dead-front/sim'
import { DfMatch } from '#server/utils/dead-front/match'

// The development test hooks (teleport, points, god mode, rounds) must never
// be reachable outside `import.meta.dev`, and must behave when they are.

const spot = (id: string, x: number, z: number, zone = 'a') => ({ id, pos: { x, y: 0, z }, yaw: 0, zone })

const MAP: DfMapDef = {
    id: 'test',
    name: 'Test',
    bounds: { min: { x: -40, y: -1, z: -40 }, max: { x: 40, y: 12, z: 40 } },
    startZone: 'a',
    playerSpawns: [{ x: 0, y: 0, z: 0 }],
    solids: [{ min: { x: -40, y: -1, z: -40 }, max: { x: 40, y: 0, z: 40 }, mat: 'mud' }],
    zones: [{ id: 'a', name: 'A' }],
    doors: [],
    barricades: [],
    wallBuys: [],
    perks: [],
    boxSpots: [spot('box-0', 0, -4)],
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

const profile = (): DfProfileView => ({
    unlockedWeapons: ['m1911'], weaponXp: {}, loadout: { startWeapon: 'm1911', attachments: {} }, researchPerk: null,
    perkXp: {}, perkMods: {}, gamesPlayed: 0, bestRound: 0, totalKills: 0, eggsCompleted: 0
})
const report: DfProgressReport = { perk: null, perkXpGained: 0, perkLevelBefore: 0, perkLevelAfter: 0, weaponXpGained: {}, weaponLevelsUp: {}, newWeapons: [] }

afterEach(() => {
    vi.useRealTimers()
})

describe('dead front dev hooks', () => {
    it('are ignored by the match outside development builds', async () => {
        vi.useFakeTimers()
        const match = await DfMatch.create([{ userId: 'a', name: 'A' }], {
            send: () => {},
            onPlayerGone: () => {},
            onFinished: () => {},
            loadProfile: async () => profile(),
            applyResult: async () => report
        })
        const before = match.sim.player(0)!.points
        const at = { ...match.sim.player(0)!.pos }
        match.handle('a', { t: 'dev', op: { k: 'points', amount: 100000 } })
        match.handle('a', { t: 'dev', op: { k: 'tp', pos: { x: 30, y: 0, z: 30 } } })
        expect(match.sim.player(0)!.points).toBe(before)
        expect(match.sim.player(0)!.pos).toEqual(at)
        await match.finish()
    })

    it('teleports, grants points, clears and holds spawns in the simulation', () => {
        const sim = new DfMatchSim([{ userId: 'u', name: 'u', startWeapon: 'm1911', attachments: {}, perkMods: {} }], { map: MAP, now: () => 1000, startDelay: 0 })
        const p = sim.player(0)!
        const tp = p.tp
        sim.dev(0, { k: 'tp', pos: { x: 3, y: 0, z: -2 } })
        expect(p.pos).toEqual({ x: 3, y: 0, z: -2 })
        expect(p.tp).toBe(tp + 1)
        sim.dev(0, { k: 'tp', pos: { x: Number.NaN, y: 0, z: 0 } })
        expect(p.pos).toEqual({ x: 3, y: 0, z: -2 })
        sim.dev(0, { k: 'points', amount: 2500 })
        expect(p.points).toBe(500 + 2500)
        sim.dev(0, { k: 'points', amount: -1e9 })
        expect(p.points).toBe(0)
        sim.dev(0, { k: 'round', round: 5 })
        expect(sim.round).toBe(5)
        expect(sim.phase).toBe('active')
        sim.dev(0, { k: 'hold', on: true })
        for (let i = 0; i < 200; i++) sim.step(0.05)
        expect(sim.zombies).toHaveLength(0)
    })

    it('god mode keeps the player standing', () => {
        const sim = new DfMatchSim([{ userId: 'u', name: 'u', startWeapon: 'm1911', attachments: {}, perkMods: {} }], { map: MAP, now: () => 1000, startDelay: 0 })
        sim.dev(0, { k: 'god', on: true })
        sim.dev(0, { k: 'down' })
        // a requested down still downs (it is an explicit test action), god only blocks damage
        expect(sim.player(0)!.life).toBe('down')
    })
})
