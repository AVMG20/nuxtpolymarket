/**
 * The Collections detail's body (`app/utils/hero-quest-art/collections-scene.ts`): lines that run
 * past the footer scroll rather than being cut off, so every ability and stat line can be read.
 */
import { describe, expect, it } from 'vitest'
import { detailMaxScroll, type CollectionTile } from '../../app/utils/hero-quest-art/collections-scene'
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
})
