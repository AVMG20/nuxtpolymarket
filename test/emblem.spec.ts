import { describe, expect, it } from 'vitest'
import { EMBLEM_MAX_ELEMENTS, EMBLEM_MAX_POINTS_PER_STROKE, parseEmblem, serializeEmblem } from '#shared/utils/emblem'

describe('profile emblem validation', () => {
    it('accepts and serializes a valid emblem', () => {
        const emblem = {
            version: 1,
            background: '#112233',
            elements: [
                { kind: 'stroke', color: '#ffffff', width: 4, points: [[10, 10], [20, 20]] },
                { kind: 'shape', shape: 'star', color: '#ffcc00', x: 50, y: 50, size: 30, rotation: 0 }
            ]
        }

        const serialized = serializeEmblem(emblem)
        expect(serialized).toBeTypeOf('string')
        expect(parseEmblem(serialized)).toEqual(emblem)
    })

    it('rejects unsafe colors and out-of-bounds geometry', () => {
        expect(parseEmblem({ version: 1, background: 'url(javascript:alert(1))', elements: [] })).toBeNull()
        expect(parseEmblem({
            version: 1,
            background: '#112233',
            elements: [{ kind: 'shape', shape: 'circle', color: '#ffffff', x: 500, y: 50, size: 30, rotation: 0 }]
        })).toBeNull()
    })

    it('rejects emblems over the mark limit', () => {
        expect(parseEmblem({
            version: 1,
            background: '#112233',
            elements: Array.from({ length: EMBLEM_MAX_ELEMENTS + 1 }, () => ({
                kind: 'shape', shape: 'circle', color: '#ffffff', x: 50, y: 50, size: 20, rotation: 0
            }))
        })).toBeNull()
    })

    it('rejects strokes over the per-stroke point limit', () => {
        expect(parseEmblem({
            version: 1,
            background: '#112233',
            elements: [{
                kind: 'stroke',
                color: '#ffffff',
                width: 4,
                points: Array.from({ length: EMBLEM_MAX_POINTS_PER_STROKE + 1 }, () => [10, 10])
            }]
        })).toBeNull()
    })

    it('rejects an unknown shape kind', () => {
        expect(parseEmblem({
            version: 1,
            background: '#112233',
            elements: [{ kind: 'shape', shape: 'hexagon', color: '#ffffff', x: 50, y: 50, size: 20, rotation: 0 }]
        })).toBeNull()
    })

    it('rejects a mismatched version', () => {
        expect(parseEmblem({ version: 2, background: '#112233', elements: [] })).toBeNull()
    })

    it('rejects non-object and malformed JSON input', () => {
        expect(parseEmblem(null)).toBeNull()
        expect(parseEmblem(42)).toBeNull()
        expect(parseEmblem('not json')).toBeNull()
        expect(parseEmblem('')).toBeNull()
    })

    it('parses a JSON-serialized emblem string the same as the object form', () => {
        const emblem = {
            version: 1,
            background: '#000000',
            elements: [{ kind: 'shape', shape: 'square', color: '#ff0000', x: 20, y: 20, size: 10, rotation: 45 }]
        }
        expect(parseEmblem(JSON.stringify(emblem))).toEqual(emblem)
    })

    it('serializeEmblem returns null for invalid input instead of throwing', () => {
        expect(serializeEmblem({ version: 1, background: 'not-a-color', elements: [] })).toBeNull()
        expect(serializeEmblem(undefined)).toBeNull()
    })
})
