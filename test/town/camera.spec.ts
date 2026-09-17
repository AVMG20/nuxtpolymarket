import { describe, expect, it } from 'vitest'
import { townCameraMove, townDragDelta, townKeyboardDelta, townSnapTurn, townWheelZoomFactor } from '../../app/utils/town/camera'

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

describe('Polytown wheel zoom', () => {
    it('zooms proportionally to the wheel delta and clamps a flick', () => {
        expect(townWheelZoomFactor(0)).toBe(1)
        expect(townWheelZoomFactor(20)).toBeGreaterThan(1)
        expect(townWheelZoomFactor(20)).toBeLessThan(townWheelZoomFactor(40))
        expect(townWheelZoomFactor(-20)).toBeCloseTo(1 / townWheelZoomFactor(20))
        expect(townWheelZoomFactor(5000)).toBeCloseTo(townWheelZoomFactor(60))
        expect(townWheelZoomFactor(-5000)).toBeCloseTo(townWheelZoomFactor(-60))
    })
    it('treats a line-mode notch like a mouse notch', () => {
        expect(townWheelZoomFactor(3, 1)).toBeCloseTo(townWheelZoomFactor(48))
        expect(townWheelZoomFactor(1, 2)).toBeCloseTo(townWheelZoomFactor(60))
    })
})

describe('Polytown snap turn', () => {
    it('steps once per threshold and keeps the remainder', () => {
        expect(townSnapTurn(0)).toEqual({ steps: 0, remainder: 0 })
        expect(townSnapTurn(69)).toEqual({ steps: 0, remainder: 69 })
        expect(townSnapTurn(150)).toEqual({ steps: 2, remainder: 10 })
        expect(townSnapTurn(-75)).toEqual({ steps: -1, remainder: -5 })
    })
})
