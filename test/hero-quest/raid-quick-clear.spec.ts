/**
 * The Raids showcase's quick-clear buttons (`app/utils/hero-quest-art/raids-scene.ts`): QUICK, ×5
 * and ×10 each light only with a best to take and a Key per clear, and sit side by side before ENTER.
 */
import { describe, expect, it } from 'vitest'
import { drawRaidReward, isRaidQuickHover, raidButtonEnabled, raidQuickCount, raidsHoverAt, type RaidRowView, type RaidsView } from '../../app/utils/hero-quest-art/raids-scene'
import { CAMERAS } from '../../app/utils/hero-quest-art/demo'
import { Surface } from '../../app/utils/hero-quest-art/surface'
import { RAID_QUICK_CLEAR_COUNTS } from '#shared/utils/hero-quest/constants'

const { w, h } = CAMERAS.zoom1

function view(keys: number, best: number, { open = true, busy = false } = {}): RaidsView {
    const row: RaidRowView = { id: 'raid_guild', open, keys, keyCap: 21, nextKeys: null, best, bestReward: 3, loadout: null, loadoutSlot: null, loadoutLive: false }
    return { selected: 'raid_guild', raids: [row], busy, loadouts: [], pickerOpen: false }
}

describe('hero-quest raid multi quick-clear', () => {
    it('lights each quick-clear only with a Key for every clear it takes', () => {
        expect(raidButtonEnabled(view(4, 3), 'quick:1')).toBe(true)
        expect(raidButtonEnabled(view(4, 3), 'quick:5')).toBe(false)
        expect(raidButtonEnabled(view(5, 3), 'quick:5')).toBe(true)
        expect(raidButtonEnabled(view(9, 3), 'quick:10')).toBe(false)
        expect(raidButtonEnabled(view(10, 3), 'quick:10')).toBe(true)
        expect(raidButtonEnabled(view(0, 3), 'quick:1')).toBe(false)
    })

    it('keeps every quick-clear dark before a best, while busy or with the raid shut, and ENTER on its own Key', () => {
        for (const count of RAID_QUICK_CLEAR_COUNTS) {
            expect(raidButtonEnabled(view(21, 0), `quick:${count}`)).toBe(false)
            expect(raidButtonEnabled(view(21, 3, { busy: true }), `quick:${count}`)).toBe(false)
            expect(raidButtonEnabled(view(21, 3, { open: false }), `quick:${count}`)).toBe(false)
        }
        expect(raidButtonEnabled(view(1, 0), 'enter')).toBe(true)
        expect(raidButtonEnabled(view(0, 0), 'enter')).toBe(false)
    })

    it('reads the clears off a button, and tells a quick-clear from the other targets', () => {
        for (const count of RAID_QUICK_CLEAR_COUNTS) {
            expect(isRaidQuickHover(`quick:${count}`)).toBe(true)
            expect(raidQuickCount(`quick:${count}`)).toBe(count)
        }
        expect(isRaidQuickHover('enter')).toBe(false)
        expect(isRaidQuickHover('raid_guild')).toBe(false)
        expect(isRaidQuickHover(null)).toBe(false)
    })

    it('lays QUICK, ×5, ×10 and ENTER left to right on one row, apart from each other', () => {
        const v = view(21, 3)
        const spans = new Map<string, { x0: number, x1: number, y0: number, y1: number }>()
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const at = raidsHoverAt(v, x, y)
                if (at !== 'enter' && !isRaidQuickHover(at)) continue
                const span = spans.get(at) ?? { x0: x, x1: x, y0: y, y1: y }
                spans.set(at, { x0: Math.min(span.x0, x), x1: Math.max(span.x1, x), y0: Math.min(span.y0, y), y1: Math.max(span.y1, y) })
            }
        }
        const order = ['quick:1', 'quick:5', 'quick:10', 'enter'].map(id => spans.get(id)!)
        for (const span of order) expect(span).toBeDefined()
        for (let i = 1; i < order.length; i++) {
            expect(order[i]!.x0).toBeGreaterThan(order[i - 1]!.x1 + 1)
            expect(order[i]!.y0).toBe(order[0]!.y0)
        }
        expect(order.at(-1)!.x1).toBeLessThan(w)
    })

    it('draws a multi-clear\'s reward without throwing', () => {
        const s = new Surface(w, h, 0, 0)
        const reward = { notation: 'scientific' as const, raidId: 'raid_trait' as const, quick: true, count: 10, won: true, level: 30, newBest: false, reward: 9320 }
        drawRaidReward(s, reward, { label: 'FIGHT AGAIN', enabled: true }, null, false, false)
        drawRaidReward(s, { ...reward, raidId: 'raid_guild', count: 5 }, { label: 'FIGHT NEXT', enabled: false }, 'ok', true, false)
    })
})
