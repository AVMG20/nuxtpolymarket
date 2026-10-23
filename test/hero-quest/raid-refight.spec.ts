/**
 * The raid reward popup's second button (`app/utils/hero-quest-art/raids-scene.ts`): Fight next after
 * a boss win or quick-clear, Fight again otherwise, and dark without a Key.
 */
import { describe, expect, it } from 'vitest'
import { drawRaidReward, raidRefight, raidRewardHoverAt, type RaidRewardView, type RaidRowView } from '../../app/utils/hero-quest-art/raids-scene'
import { CAMERAS } from '../../app/utils/hero-quest-art/demo'
import { textWidth } from '../../app/utils/hero-quest-art/font'
import { Surface } from '../../app/utils/hero-quest-art/surface'
import type { RaidId } from '#shared/utils/hero-quest/content/raids'

const { w, h } = CAMERAS.zoom3

function row(id: RaidId, keys: number, best: number, open = true): RaidRowView {
    return { id, open, keys, keyCap: 10, nextKeys: null, best, bestReward: 0, loadout: null, loadoutSlot: null, loadoutLive: false }
}

function reward(raidId: RaidId, won = true, quick = false): RaidRewardView {
    return { notation: 'scientific', raidId, quick, count: 1, won, level: 12, newBest: won && !quick, reward: won ? 3 : 0 }
}

/** Every x on the row through the buttons' middle that hits `which`. */
function columns(which: 'ok' | 'refight'): number[] {
    let midY = -1
    for (let y = 0; y < h && midY < 0; y++) {
        for (let x = 0; x < w; x++) if (raidRewardHoverAt(w, h, x, y)) midY = y + 6
    }
    return Array.from({ length: w }, (_, x) => x).filter(x => raidRewardHoverAt(w, h, x, midY) === which)
}

describe('hero-quest raid reward popup', () => {
    it('fights next after a boss win or a quick-clear, and again after a boss loss', () => {
        for (const id of ['raid_guild', 'raid_dig_site', 'raid_forge'] as const) {
            expect(raidRefight(reward(id), row(id, 3, 12), false)).toEqual({ label: 'FIGHT NEXT', enabled: true })
            expect(raidRefight(reward(id, true, true), row(id, 3, 12), false).label).toBe('FIGHT NEXT')
            expect(raidRefight(reward(id, false), row(id, 3, 12), false)).toEqual({ label: 'FIGHT AGAIN', enabled: true })
        }
    })

    it('fights again for the raids that always pay the level reached', () => {
        for (const id of ['raid_training_grounds', 'raid_trait'] as const) {
            expect(raidRefight(reward(id), row(id, 4, 30), false)).toEqual({ label: 'FIGHT AGAIN', enabled: true })
            expect(raidRefight(reward(id, true, true), row(id, 4, 30), false).label).toBe('FIGHT AGAIN')
        }
    })

    it('is off with no Key, while a request is out, or with the raid shut or missing', () => {
        expect(raidRefight(reward('raid_guild'), row('raid_guild', 0, 5), false)).toEqual({ label: 'FIGHT NEXT', enabled: false })
        expect(raidRefight(reward('raid_guild'), row('raid_guild', 3, 5), true).enabled).toBe(false)
        expect(raidRefight(reward('raid_guild'), row('raid_guild', 3, 5, false), false).enabled).toBe(false)
        expect(raidRefight(reward('raid_guild'), undefined, false).enabled).toBe(false)
    })

    it('lays Continue left of the next fight, apart, equal, and wide enough for every label', () => {
        const ok = columns('ok')
        const next = columns('refight')
        expect(ok.length).toBeGreaterThan(0)
        expect(next.length).toBe(ok.length)
        expect(next[0]!).toBeGreaterThan(ok.at(-1)! + 1)
        // the plate's 1px rim each side, and a pixel of air inside it
        for (const label of ['CONTINUE', 'OK', 'FIGHT NEXT', 'FIGHT AGAIN']) expect(textWidth(label) + 4).toBeLessThanOrEqual(ok.length)
    })

    it('draws every case without throwing', () => {
        const s = new Surface(w, h, 0, 0)
        drawRaidReward(s, reward('raid_guild'), { label: 'FIGHT NEXT', enabled: true }, 'refight', true, false)
        drawRaidReward(s, reward('raid_guild', false), { label: 'FIGHT AGAIN', enabled: false }, null, false, false)
        drawRaidReward(s, { ...reward('raid_trait', true, true), count: 10 }, { label: 'FIGHT AGAIN', enabled: false }, 'ok', false, true)
    })
})
