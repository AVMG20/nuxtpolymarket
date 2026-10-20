/**
 * The Collections detail's body (`app/utils/hero-quest-art/collections-scene.ts`): lines that run
 * past the footer scroll rather than being cut off, so every ability and stat line can be read, and
 * previous and next sit beside the close button.
 */
import { describe, expect, it } from 'vitest'
import { detailMaxScroll, detailNavAt, onDetailClose, type CollectionTile } from '../../app/utils/hero-quest-art/collections-scene'
import { CAMERAS } from '../../app/utils/hero-quest-art/demo'

const { w, h } = CAMERAS.zoom3

function tile(lines: string[]): CollectionTile {
    return {
        id: 'champ_sylwen', rarity: 'rare', owned: true, name: 'Sylwen', subtitle: 'Control',
        star: 0, level: 1, dupeProgress: 0, dupesToLevelUp: 1, maxed: false, mark: null,
        sections: [{ title: 'Fielded', scope: 'In the party', active: true, lines }],
        actions: [], picker: null, craft: null
    }
}

describe('collections detail', () => {
    it('does not scroll while its lines fit', () => {
        expect(detailMaxScroll(w, h, tile(['PWR +1%']))).toBe(0)
    })

    it('scrolls a long description, by as much as it overflows', () => {
        const long = Array.from({ length: 12 }, (_, i) => `Ability ${i}: every 9.22s: extends every debuff, burn, stun and silence on the target by 8.64s.`)
        const max = detailMaxScroll(w, h, tile(long))
        expect(max).toBeGreaterThan(0)
        // one more line overflows by one more line's height or more
        expect(detailMaxScroll(w, h, tile([...long, 'PWR +1%']))).toBeGreaterThan(max)
    })

    it('puts previous, then next, left of the close button, apart from it', () => {
        // every pixel of the view's top band, by what it is on
        const xs = { prev: [] as number[], next: [] as number[], close: [] as number[] }
        for (let y = 0; y < 40; y++) {
            for (let x = 0; x < w; x++) {
                const nav = detailNavAt(w, h, x, y)
                const close = onDetailClose(w, h, x, y)
                expect(nav !== null && close).toBe(false)
                if (nav) xs[nav].push(x)
                if (close) xs.close.push(x)
            }
        }
        expect(xs.prev.length).toBeGreaterThan(0)
        expect(xs.next.length).toBe(xs.prev.length)
        expect(Math.max(...xs.prev)).toBeLessThan(Math.min(...xs.next))
        expect(Math.max(...xs.next)).toBeLessThan(Math.min(...xs.close))
    })
})
