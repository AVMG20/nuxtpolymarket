import { describe, expect, it } from 'vitest'
import { townCameraMove, townDragDelta, townKeyboardDelta } from '../../app/utils/town/camera'

describe('Polytown camera controls', () => {
    for (const yaw of [0, 0.7, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        it(`keeps dragged ground under the pointer at yaw ${yaw}`, () => {
            const pitch = 0.95
            const delta = townDragDelta(40, 25, yaw, pitch, 0.01)
            const right = townCameraMove(1, 0, yaw)
            const forward = townCameraMove(0, 1, yaw)
            // The camera moves opposite the grabbed ground in screen space.
            expect(-(delta.x * right.x + delta.z * right.z) / 0.01).toBeCloseTo(40)
            expect((delta.x * forward.x + delta.z * forward.z) * Math.sin(pitch) / 0.01).toBeCloseTo(25)
        })
    }
    it('moves W into the view and D to screen right after a quarter orbit', () => {
        const w = townKeyboardDelta(0, 1, Math.PI / 2, 2)
        const d = townKeyboardDelta(1, 0, Math.PI / 2, 2)
        expect(w.x).toBeCloseTo(-2)
        expect(w.z).toBeCloseTo(0)
        expect(d.x).toBeCloseTo(0)
        expect(d.z).toBeCloseTo(-2)
    })
    it('keeps diagonals at the same speed and cancels opposite keys', () => {
        const diagonal = townKeyboardDelta(1, 1, 0.7, 3)
        expect(Math.hypot(diagonal.x, diagonal.z)).toBeCloseTo(3)
        expect(townKeyboardDelta(0, 0, 0.7, 3)).toEqual({ x: 0, z: 0 })
    })
})
