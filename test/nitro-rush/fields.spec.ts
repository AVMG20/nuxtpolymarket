import { describe, expect, it } from 'vitest'
import { compileCustomTrack, exportCustomTrack, importCustomTrack, MAX_SECTIONS, roadKey, sanitizeCustomTrack, sectionCount, walkCustomTrack, type CustomTrack, type SectionId } from '#shared/utils/nitro-rush/custom'
import { FIELD_ITEMS_PER_SECTION, type CustomField } from '#shared/utils/nitro-rush/custom-fields'
import { blockWalls, defaultFieldPlan, edgeWalls, FIELD_MAX_ITEMS, walledOffFault, type FieldTile } from '#shared/utils/nitro-rush/field'
import { Track } from '#shared/utils/nitro-rush/track'

const ROAD: SectionId[] = ['straight-20', 'start', 'field', 'finish', 'straight-200']
const course = (sections: SectionId[], extra: Partial<CustomTrack> = {}): CustomTrack => ({ id: 'custom-test', name: 'Test', closed: false, sections, ...extra })
/** A 100 m square on section 2 of the main road, entered and left through the middle of its far edges. */
const field = (extra: Partial<CustomField> = {}): CustomField => ({ at: { branch: 0, at: 2 }, ...defaultFieldPlan(), ...extra })
const compiled = (t: CustomTrack) => {
    const { def, error } = compileCustomTrack(t)
    expect(error).toBeNull()
    return { def: def!, track: new Track(def!) }
}
const errorOf = (t: CustomTrack) => compileCustomTrack(t).error
const sanitized = (raw: Partial<CustomTrack> & Record<string, unknown>) => sanitizeCustomTrack({ id: 'custom-test', name: 'Test', closed: false, sections: ROAD, ...raw })

describe('field layout', () => {
    it('lays a field level with the road, its hub at the centre', () => {
        const { def, track } = compiled(course(ROAD))
        const [f] = def.fields!
        expect(def.fields).toHaveLength(1)
        expect(f).toMatchObject({ x: -50, z: -40, heading: 0, y: 0 })
        expect(f!.plan).toMatchObject({ width: 100, length: 100 })
        expect(f!.home).toEqual({ branch: 0, at: 90 })
        expect(f!.mouths.map(m => [m.edge, m.at])).toEqual([['entry', 50], ['exit', 50]])
        expect(track.routes).toHaveLength(1)
    })

    it('lifts a field to the road it is laid on', () => {
        const { def } = compiled(course(['straight-20', 'start', 'ramp-up', 'straight-20', 'field', 'finish', 'straight-200'], { fields: [field({ at: { branch: 0, at: 4 } })] }))
        expect(def.fields![0]!.y).toBeGreaterThan(0)
    })

    it('keeps the road arriving on the entry tile when it is off centre', () => {
        const { def } = compiled(course(ROAD, { fields: [field({ entry: 0 })] }))
        expect(def.fields![0]).toMatchObject({ x: -10, z: -40 })
        expect(def.fields![0]!.mouths[0]).toMatchObject({ edge: 'entry', at: 10 })
    })

    it('carries the road on out of a side edge or back out of the entry edge', () => {
        const side = walkCustomTrack(course(ROAD, { fields: [field({ exit: { edge: 'right', tile: 2 } })] }))
        expect(side.end.heading).toBeCloseTo(Math.PI / 2)
        const back = walkCustomTrack(course(ROAD, { fields: [field({ exit: { edge: 'entry', tile: 4 } })] }))
        expect(back.end.heading).toBeCloseTo(Math.PI)
        expect(back.end.z).toBeGreaterThan(0)
    })

    it('lays fields back to back and a field on a loop', () => {
        expect(compiled(course(['straight-20', 'start', 'field', 'field', 'finish', 'straight-200'])).def.fields).toHaveLength(2)
        const loop = compiled({ ...course(['start', 'field', 'straight-20', 'right-tight', 'right-tight', 'straight-100', 'straight-20', 'straight-20', 'right-tight', 'right-tight']), closed: true })
        expect(loop.track.closed).toBe(true)
    })

    it('needs flat road running along the grid', () => {
        expect(errorOf(course(['straight-20', 'start', 'slope-up', 'field', 'finish', 'straight-200']))).toMatch(/flat, unbanked/)
        expect(errorOf(course(['straight-20', 'start', 'bank-left', 'field', 'finish', 'straight-200']))).toMatch(/flat, unbanked/)
        expect(errorOf(course(['straight-20', 'start', 'left-eighth', 'field', 'finish', 'straight-200']))).toMatch(/diagonal/)
    })

    it('keeps other road and other fields off a field', () => {
        const wide = field({ width: 200, entry: 5, exit: { edge: 'exit', tile: 5 } })
        expect(errorOf(course(['straight-20', 'start', 'field', 'right-tight', 'right-tight', 'finish', 'straight-200'], { fields: [wide] }))).toMatch(/runs into a field/)
        const overlap = course(['straight-20', 'start', 'field', 'left-tight', 'left-tight', 'field', 'finish', 'straight-200'], {
            fields: [field({ exit: { edge: 'right', tile: 2 } }), field({ at: { branch: 0, at: 5 } })]
        })
        expect(errorOf(overlap)).toBe('two fields overlap')
    })

    it('rejects a field with a corner walled off', () => {
        const tiles: FieldTile[] = [{ col: 1, row: 0, kind: 'block' }, { col: 0, row: 1, kind: 'block' }, { col: 0, row: 0, kind: 'checkpoint', dir: 0 }]
        expect(errorOf(course(ROAD, { fields: [field({ tiles })] }))).toMatch(/walled off/)
    })
})

describe('field branches', () => {
    it('leaves a field through a second mouth on the same edge', () => {
        const t = course(ROAD, {
            fields: [field({ exit: { edge: 'exit', tile: 1 } })],
            branches: [{ sections: ['finish', 'straight-200'], from: { branch: 0, at: 2, port: { edge: 'exit', tile: 3 } }, to: null }]
        })
        const { def, track } = compiled(t)
        expect(def.fields![0]!.mouths.map(m => [m.branch, m.edge, m.at])).toEqual([[0, 'entry', 50], [0, 'exit', 30], [1, 'exit', 70]])
        expect(def.branches![0]!.from).toEqual(def.fields![0]!.home)
        expect(track.routes).toHaveLength(2)
    })

    it('gives a route per way out of the hub', () => {
        const out = (edge: 'left' | 'right') => ({ sections: ['finish', 'straight-200'] as SectionId[], from: { branch: 0, at: 2, port: { edge, tile: 2 } }, to: null })
        const { track } = compiled(course(ROAD, { branches: [out('left'), out('right')] }))
        expect(track.routes).toHaveLength(3)
    })

    /** Two fields 100 m apart; a branch leaves the first beside the main road and drives into the second. */
    const twoFields = (sections: SectionId[], tiles: FieldTile[] = []) => course(['straight-20', 'start', 'field', 'straight-100', 'field', 'finish', 'straight-200'], {
        fields: [field({ exit: { edge: 'exit', tile: 1 } }), field({ at: { branch: 0, at: 4 }, tiles })],
        branches: [{ sections, from: { branch: 0, at: 2, port: { edge: 'exit', tile: 3 } }, to: { branch: 0, at: 4 } }]
    })

    it('ends a branch at the hub of the field it drives into', () => {
        const { def, track } = compiled(twoFields(['straight-60']))
        const second = def.fields![1]!
        expect(def.branches![0]!.to).toEqual(second.home)
        expect(second.mouths.some(m => m.branch === 1 && m.edge === 'entry')).toBe(true)
        expect(track.routes).toHaveLength(2)
    })

    it('rejects a branch that misses its field or runs into a block', () => {
        expect(errorOf(twoFields(['right-tight', 'straight-60']))).toMatch(/doesn't reach its field/)
        expect(errorOf(twoFields(['straight-60'], [{ col: 4, row: 0, kind: 'block' }]))).toMatch(/runs into a block/)
    })

    it('rejects a branch driving into a gate turned across it, and takes one along it', () => {
        expect(errorOf(twoFields(['straight-60'], [{ col: 4, row: 0, kind: 'checkpoint', dir: 1 }]))).toMatch(/gate post/)
        expect(errorOf(twoFields(['straight-60'], [{ col: 4, row: 0, kind: 'checkpoint', dir: 0 }]))).toBeNull()
    })

    it('rejects a road back into the field it left', () => {
        const t = course(ROAD, { branches: [{ sections: ['left-tight', 'left-tight'], from: { branch: 0, at: 2, port: { edge: 'right', tile: 0 } }, to: { branch: 0, at: 2 } }] })
        expect(errorOf(t)).toMatch(/loop back into its own field/)
    })
})

describe('field walls', () => {
    const plan = defaultFieldPlan()

    it('breaks an edge round its openings and drops stretches shared with a field next door', () => {
        const walls = edgeWalls(plan, [{ edge: 'entry', at: 50, half: 6 }])
        expect(walls).toHaveLength(5)
        expect(walls.filter(w => w.z0 === 0 && w.z1 === 0).map(w => [w.x0, w.x1])).toEqual([[0, 44], [56, 100]])
        const shared = edgeWalls(plan, [], [{ edge: 'exit', at: 50, half: 50 }])
        expect(shared).toHaveLength(3)
        expect(shared.some(w => w.z0 === 100 && w.z1 === 100)).toBe(false)
    })

    it('outlines neighbouring blocks as one solid with no seam between them', () => {
        const walls = blockWalls({ ...plan, tiles: [{ col: 1, row: 1, kind: 'block' }, { col: 2, row: 1, kind: 'block' }] })
        expect(walls).toHaveLength(4)
        expect(walls.some(w => w.x0 === 40 && w.x1 === 40)).toBe(false)
        expect(walls.filter(w => w.z0 === w.z1).every(w => w.x0 === 20 && w.x1 === 60)).toBe(true)
    })

    it('leaves a block\'s sides on the field edge to the edge wall, and pillars out', () => {
        expect(blockWalls({ ...plan, tiles: [{ col: 0, row: 0, kind: 'block' }] })).toHaveLength(2)
        expect(blockWalls({ ...plan, tiles: [{ col: 2, row: 2, kind: 'pillar' }] })).toEqual([])
    })

    it('counts items and mouths boxed in by blocks as walled off, but not by pillars', () => {
        const pocket = (kind: 'block' | 'pillar'): FieldTile[] => [{ col: 1, row: 0, kind }, { col: 0, row: 1, kind }]
        const checkpoint: FieldTile = { col: 0, row: 0, kind: 'checkpoint', dir: 0 }
        expect(walledOffFault({ ...plan, tiles: pocket('block') }, [{ col: 2, row: 0 }])).toBeNull()
        expect(walledOffFault({ ...plan, tiles: [...pocket('block'), checkpoint] }, [{ col: 2, row: 0 }])).toMatch(/walled off/)
        expect(walledOffFault({ ...plan, tiles: pocket('block') }, [{ col: 2, row: 0 }, { col: 0, row: 0 }])).toMatch(/walled off/)
        expect(walledOffFault({ ...plan, tiles: [...pocket('pillar'), checkpoint] }, [{ col: 2, row: 0 }])).toBeNull()
    })
})

describe('field sanitising', () => {
    it('fills a field section with no stored field at the default size', () => {
        expect(sanitized({})!.fields).toEqual([field()])
    })

    it('rejects sizes off the 20 m grid or over 200 m', () => {
        for (const size of [{ width: 0 }, { width: 50 }, { width: 220 }, { length: 240 }, { width: 100.5 }]) {
            expect(sanitized({ fields: [field({ ...size, entry: 0, exit: { edge: 'exit', tile: 0 } })] }), JSON.stringify(size)).toBeNull()
        }
        expect(sanitized({ fields: [field({ width: 200, length: 20, entry: 0, exit: { edge: 'exit', tile: 9 } })] })).not.toBeNull()
    })

    it('rejects tiles off the grid, doubled up, unknown or pointing nowhere', () => {
        const bad: unknown[][] = [
            [{ col: 5, row: 0, kind: 'block' }],
            [{ col: 0, row: -1, kind: 'block' }],
            [{ col: 0, row: 0, kind: 'block' }, { col: 0, row: 0, kind: 'pillar' }],
            [{ col: 0, row: 0, kind: 'lava' }],
            [{ col: 0, row: 0, kind: 'boost' }],
            [{ col: 0, row: 0, kind: 'boost', dir: 4 }]
        ]
        for (const tiles of bad) expect(sanitized({ fields: [{ ...field(), tiles }] }), JSON.stringify(tiles)).toBeNull()
    })

    it('stores tiles in row order and caps a field\'s items', () => {
        const tiles: FieldTile[] = [{ col: 3, row: 2, kind: 'pillar' }, { col: 0, row: 1, kind: 'boost', dir: 1 }]
        expect(sanitized({ fields: [field({ tiles })] })!.fields![0]!.tiles).toEqual([tiles[1], tiles[0]])
        const many = Array.from({ length: FIELD_MAX_ITEMS + 1 }, (_, i): FieldTile => ({ col: i % 10, row: 5 + Math.floor(i / 10), kind: 'pillar' }))
        const big = { width: 200, length: 200, entry: 5, exit: { edge: 'exit' as const, tile: 5 } }
        expect(sanitized({ fields: [field({ ...big, tiles: many.slice(0, FIELD_MAX_ITEMS) })] })).not.toBeNull()
        expect(sanitized({ fields: [field({ ...big, tiles: many })] })).toBeNull()
    })

    it('rejects mouths off the edge, on neighbouring tiles or onto a block', () => {
        expect(sanitized({ fields: [field({ exit: { edge: 'exit', tile: 5 } })] })).toBeNull()
        expect(sanitized({ fields: [field({ exit: { edge: 'entry', tile: 3 } })] })).toBeNull()
        expect(sanitized({ fields: [field({ exit: { edge: 'entry', tile: 4 } })] })).not.toBeNull()
        expect(sanitized({ fields: [field({ tiles: [{ col: 2, row: 4, kind: 'block' }] })] })).toBeNull()
        const port = (tile: number) => ({ branches: [{ sections: ['finish', 'straight-200'] as SectionId[], from: { branch: 0, at: 2, port: { edge: 'exit' as const, tile } }, to: null }] })
        expect(sanitized({ ...port(3), fields: [field()] })).toBeNull()
        expect(sanitized({ ...port(4), fields: [field()] })).not.toBeNull()
        expect(sanitized({ ...port(4), fields: [field({ tiles: [{ col: 4, row: 4, kind: 'pillar' }] })] })).toBeNull()
    })

    it('rejects a field off a field section or stored twice', () => {
        expect(sanitized({ fields: [field({ at: { branch: 0, at: 1 } })] })).toBeNull()
        expect(sanitized({ fields: [field({ at: { branch: 1, at: 0 } })] })).toBeNull()
        expect(sanitized({ fields: [field(), field()] })).toBeNull()
    })

    it('needs a port to leave a field and none to drive into one', () => {
        const branch = (from: object, to: object | null) => ({ branches: [{ sections: ['finish', 'straight-200'], from, to }] })
        expect(sanitized(branch({ branch: 0, at: 2 }, null))).toBeNull()
        expect(sanitized(branch({ branch: 0, at: 2, port: { edge: 'left', tile: 2 } }, null))).not.toBeNull()
        const into = { sections: ['straight-20', 'start', 'field', 'straight-100', 'field', 'finish', 'straight-200'] }
        expect(sanitized({ ...into, ...branch({ branch: 0, at: 2, port: { edge: 'left', tile: 2 } }, { branch: 0, at: 4, port: { edge: 'entry', tile: 0 } }) })).toBeNull()
    })

    it('counts a field\'s items toward the section cap', () => {
        const tiles = Array.from({ length: FIELD_ITEMS_PER_SECTION + 1 }, (_, i): FieldTile => ({ col: i, row: 2, kind: 'pillar' }))
        const t = course(ROAD, { fields: [field({ tiles })] })
        expect(sectionCount(t)).toBe(ROAD.length + 2)
        const padded = [...ROAD.slice(0, 4), ...Array<SectionId>(MAX_SECTIONS - ROAD.length - 1).fill('straight-10'), 'straight-200'] as SectionId[]
        expect(sanitized({ sections: padded })).not.toBeNull()
        expect(sanitized({ sections: padded, fields: [field({ tiles })] })).toBeNull()
    })
})

describe('field road key and sharing', () => {
    it('keys courses without fields as before', () => {
        const t = course(['straight-20', 'start', 'straight-100', 'finish', 'straight-200'])
        expect(roadKey(t)).toBe(JSON.stringify([false, t.sections, []]))
    })

    it('changes the key when a field changes', () => {
        const base = roadKey(course(ROAD, { fields: [field()] }))
        expect(roadKey(course(ROAD, { fields: [field({ width: 120 })] }))).not.toBe(base)
        expect(roadKey(course(ROAD, { fields: [field({ exit: { edge: 'right', tile: 2 } })] }))).not.toBe(base)
        expect(roadKey(course(ROAD, { fields: [field({ tiles: [{ col: 1, row: 1, kind: 'pillar' }] })] }))).not.toBe(base)
        expect(roadKey(course(ROAD, { fields: [field({ tiles: [{ col: 1, row: 1, kind: 'boost', dir: 0 }] })] })))
            .not.toBe(roadKey(course(ROAD, { fields: [field({ tiles: [{ col: 1, row: 1, kind: 'boost', dir: 1 }] })] })))
    })

    it('tells the mouths branches leave a field through apart', () => {
        const out = (edge: 'left' | 'right') => course(ROAD, { fields: [field()], branches: [{ sections: ['finish', 'straight-200'], from: { branch: 0, at: 2, port: { edge, tile: 2 } }, to: null }] })
        expect(roadKey(out('left'))).not.toBe(roadKey(out('right')))
    })

    it('exports and imports a course with fields and branches through them', () => {
        const t = sanitized({
            fields: [field({ exit: { edge: 'exit', tile: 1 }, tiles: [{ col: 2, row: 2, kind: 'checkpoint', dir: 0 }, { col: 0, row: 3, kind: 'block' }] })],
            branches: [{ sections: ['finish', 'straight-200'], from: { branch: 0, at: 2, port: { edge: 'exit', tile: 3 } }, to: null }]
        })!
        const { track, error } = importCustomTrack(exportCustomTrack(t), 'custom-test')
        expect(error).toBeNull()
        expect(track).toEqual(t)
        expect(roadKey(track!)).toBe(roadKey(t))
    })

    it('leaves fields out of a course without them', () => {
        expect(JSON.parse(exportCustomTrack(course(['straight-20', 'start', 'finish', 'straight-200'])))).not.toHaveProperty('fields')
        expect(importCustomTrack(JSON.stringify({ sections: ROAD, closed: false, fields: [field({ width: 30 })] }), 'custom-test').error).toMatch(/fields/)
    })
})
