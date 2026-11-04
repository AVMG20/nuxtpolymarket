import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DfProfileView, DfProgressReport } from '#shared/utils/dead-front/types'
import { DfMatch } from '#server/utils/dead-front/match'

// The development test hooks (teleport, points, god mode, rounds) must never
// be reachable outside `import.meta.dev`.

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
})
