import { describe, expect, it } from 'vitest'
import { EMBLEM_MAX_ELEMENTS, parseEmblem, serializeEmblem } from '#shared/utils/emblem'

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
})
