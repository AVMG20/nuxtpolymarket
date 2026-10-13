import { describe, expect, it } from 'vitest'
import { Presenter } from '../../app/utils/hero-quest-art/canvas'
import { stageScale } from '../../app/utils/hero-quest-art/stage-size'

// the battle stage's frame, with the menu band under it
const presenter = { scaleFor: Presenter.prototype.scaleFor.bind({ w: 272, h: 175 } as Presenter) }

describe('hero-quest stage size', () => {
    it('fills the room on Large, keeps to the release width on Small, and sits between on Mid', () => {
        const room = { width: 1600, height: 900 }
        expect(stageScale(presenter, room, 'large', 1)).toBe(5)
        expect(stageScale(presenter, room, 'small', 1)).toBe(3)
        expect(stageScale(presenter, room, 'mid', 1)).toBe(4)
    })

    it('sizes by the height when that is what is short, so the stage never runs off the window', () => {
        const room = { width: 1600, height: 500 }
        for (const size of ['large', 'mid', 'small'] as const) {
            const scale = stageScale(presenter, room, size, 1)
            expect(scale, size).toBe(2)
            expect(175 * scale).toBeLessThanOrEqual(room.height)
        }
    })

    it('scales in device pixels, so a Retina screen gets the finer steps', () => {
        const room = { width: 1600, height: 900 }
        expect(stageScale(presenter, room, 'large', 2)).toBe(10)
        expect(stageScale(presenter, room, 'small', 2)).toBe(6)
        expect(stageScale(presenter, room, 'mid', 2)).toBe(8)
    })

    it('never draws under one pixel per pixel', () => {
        expect(stageScale(presenter, { width: 100, height: 50 }, 'large', 1)).toBe(1)
    })
})
