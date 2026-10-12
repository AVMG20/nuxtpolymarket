import { describe, expect, it } from 'vitest'
import { parseDrawing, parseHorseName } from '#shared/utils/neighcasso/drawing'

describe('parseDrawing', () => {
    it('rounds and clamps points and defaults unknown parts to body', () => {
        const drawing = parseDrawing({ strokes: [{ k: 'wing', c: '#FF0000', w: 99.4, p: [-5, 10.6, 700, 450] }] })
        expect(drawing).toEqual({ v: 1, strokes: [{ k: 'body', c: '#ff0000', w: 60, p: [0, 11, 600, 400] }] })
    })

    it('rejects junk', () => {
        expect(parseDrawing(null)).toBeTypeOf('string')
        expect(parseDrawing({ strokes: [] })).toBeTypeOf('string')
        expect(parseDrawing({ strokes: [{ k: 'leg', c: 'red', w: 4, p: [1, 2] }] })).toBeTypeOf('string')
        expect(parseDrawing({ strokes: [{ k: 'leg', c: '#000000', w: 4, p: [1, 2, 3] }] })).toBeTypeOf('string')
        expect(parseDrawing({ strokes: [{ k: 'leg', c: '#000000', w: 4, p: new Array(30_000).fill(1) }] })).toBeTypeOf('string')
    })

    it('tidies names', () => {
        expect(parseHorseName('  Hoof   Hearted ')).toBe('Hoof Hearted')
        expect(parseHorseName('   ')).toBeNull()
        expect(parseHorseName(42)).toBeNull()
        expect(parseHorseName('x'.repeat(50))).toHaveLength(32)
    })
})
