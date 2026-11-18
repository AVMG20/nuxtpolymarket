import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { minimapPlan } from '../../app/utils/nitro-rush/minimap'
import { fieldClearance, ribbon, roadLeft, roadRight } from '../../app/utils/nitro-rush/road-geometry'
import { tracksideLayout } from '../../app/utils/nitro-rush/trackside-spots'
import { CourseMaterials, layCourse } from '../../app/utils/nitro-rush/builder-course'
import { LINE_COLORS } from '../../app/utils/nitro-rush/config'
import { buildFields, deckPillars } from '../../app/utils/nitro-rush/world-field'
import { fieldAdSpots } from '../../app/utils/nitro-rush/world-field-ads'
import { pillarsUnder } from '../../app/utils/nitro-rush/world-road'
import { buildGantries } from '../../app/utils/nitro-rush/world-venue'
import { worldKit } from '../../app/utils/nitro-rush/world-kit'
import { compileCustomTrack, type SectionId } from '#shared/utils/nitro-rush/custom'
import { defaultFieldPlan, edgeAt, GATE_SPAN, type FieldTile } from '#shared/utils/nitro-rush/field'
import { Track } from '#shared/utils/nitro-rush/track'
import { growField } from '#shared/utils/nitro-rush/field-edit'

// Canvas textures need a browser; the geometry doesn't.
vi.mock('../../app/utils/nitro-rush/textures', async (original) => {
    const THREE = await import('three')
    return { ...await original<object>(), concreteTexture: () => new THREE.Texture(), chevronTexture: () => new THREE.Texture(), radialTexture: () => new THREE.Texture(), checkerTexture: () => new THREE.Texture(), obstacleGlowTexture: () => new THREE.Texture(), boostPadTexture: () => new THREE.Texture() }
})
vi.mock('../../app/utils/nitro-rush/signs', async (original) => {
    const THREE = await import('three')
    return { ...await original<object>(), jumpArrowTexture: () => new THREE.Texture(), bannerTexture: () => new THREE.Texture() }
})

const ROAD: SectionId[] = ['straight-200', 'start', 'straight-200', 'field', 'straight-200', 'finish', 'straight-200']
const TILES: FieldTile[] = [
    { col: 1, row: 1, kind: 'block' },
    { col: 3, row: 3, kind: 'pillar' },
    { col: 1, row: 3, kind: 'boost', dir: 1 },
    { col: 3, row: 1, kind: 'checkpoint', dir: 0 }
]

function fieldTrack() {
    const { def, error } = compileCustomTrack({ id: 'custom-test', name: 'Test', closed: false, sections: ROAD, fields: [{ at: { branch: 0, at: 3 }, ...defaultFieldPlan(), tiles: TILES }] })
    expect(error).toBeNull()
    return new Track(def!)
}

describe('rendering a field', () => {
    const track = fieldTrack()
    const field = track.fields[0]!

    it('lays no road across the field, only up to its mouths', () => {
        const line = track.branches[0]!
        const geo = ribbon(line, 0, line.length, roadLeft, roadRight, 0, 4)
        const pos = geo.getAttribute('position')
        const index = geo.getIndex()!
        const local = { u: 0, v: 0 }
        for (let t = 0; t < index.count; t += 3) {
            let x = 0
            let z = 0
            for (let k = 0; k < 3; k++) {
                x += pos.getX(index.getX(t + k)) / 3
                z += pos.getZ(index.getX(t + k)) / 3
            }
            field.local(x, z, local)
            expect(field.contains(local.u, local.v)).toBe(false)
        }
    })

    it('builds the field with its walls, items and gate, all finite', () => {
        const group = new THREE.Group()
        const owned: { dispose(): void }[] = []
        buildFields(worldKit(track, group, owned), new THREE.MeshBasicMaterial(), new THREE.Texture())
        const meshes: THREE.Mesh[] = []
        group.traverse(o => o instanceof THREE.Mesh && meshes.push(o))
        // Floor, grid, obstacle glow, walls, bands, hazard stripes, blocks, the pillar's band, tower and ring, pads, and the gate's glow and line; its arch is the venue's.
        expect(meshes.length).toBe(13)
        for (const m of meshes) {
            const pos = m.geometry.getAttribute('position')
            for (let i = 0; i < pos.array.length; i++) expect(Number.isFinite(pos.array[i])).toBe(true)
        }
        for (const o of owned) o.dispose()
    })

    it('lights a field start and finish in their own colours, with a frame over each in the builder', () => {
        const tiles: FieldTile[] = [{ col: 1, row: 1, kind: 'start', dir: 0 }, { col: 1, row: 4, kind: 'finish', dir: 0 }]
        const { def, error } = compileCustomTrack({ id: 'custom-test', name: 'Test', closed: false, sections: ['straight-200', 'field', 'straight-200'], fields: [{ at: { branch: 0, at: 1 }, ...defaultFieldPlan(), tiles }] })
        expect(error).toBeNull()
        const lined = new Track(def!)
        const group = new THREE.Group()
        const owned: { dispose(): void }[] = []
        buildFields(worldKit(lined, group, owned), new THREE.MeshBasicMaterial(), new THREE.Texture())
        const glows = new Set<number>()
        group.traverse(o => o instanceof THREE.Mesh && o.material.blending === THREE.AdditiveBlending && glows.add(o.material.color.getHex()))
        expect(glows).toContain(LINE_COLORS.start)
        expect(glows).toContain(LINE_COLORS.finish)

        const mats = new CourseMaterials()
        const course = new THREE.Group()
        layCourse(worldKit(lined, course, owned), { lines: [], ends: [], originY: null }, mats)
        for (const kind of ['start', 'finish'] as const) {
            const line = lined.lapLines.find(l => l.kind === kind)!
            const frame = course.children.find(g => g instanceof THREE.Group && Math.hypot(g.position.x - line.x, g.position.z - line.z) < 1e-6)!
            expect(frame.children.every(m => (m as THREE.Mesh).material === mats.lines[kind])).toBe(true)
        }
        for (const o of owned) o.dispose()
        mats.dispose()
    })

    it('stands the road checkpoint arch over the gate, its feet on the posts', () => {
        const group = new THREE.Group()
        const owned: { dispose(): void }[] = []
        buildGantries(worldKit(track, group, owned), new THREE.MeshBasicMaterial())
        const gate = track.lapLines.find(l => l.field === 0)!
        const arch = group.children.find(g => Math.hypot(g.position.x - gate.x, g.position.z - gate.z) < 1e-6)!
        expect(arch).toBeDefined()
        expect(arch.position.y).toBe(gate.y)
        const tube = (arch.children[0] as THREE.Mesh).geometry
        tube.computeBoundingBox()
        expect(tube.boundingBox!.max.x).toBeCloseTo(GATE_SPAN + 0.35, 1)
        // Built by the same arch maker as the road's lines, not a field copy.
        const road = group.children.find(g => g !== arch)!
        expect((road.children[0] as THREE.Mesh).material).toBe((arch.children[0] as THREE.Mesh).material)
        for (const o of owned) o.dispose()
    })

    it('keeps scenery off the field', () => {
        const { billboards, hoardings, flags } = tracksideLayout(track)
        for (const b of billboards) expect(fieldClearance(track.fields, b.x, b.z)).toBeGreaterThan(1)
        for (const f of [...hoardings.flat(), ...flags.flat()]) expect(fieldClearance(track.fields, f.x, f.z)).toBeGreaterThan(1)
    })

    it('draws the field on the minimap and breaks the road across it', () => {
        const plan = minimapPlan(track)
        expect(plan.fields).toHaveLength(1)
        const [f] = plan.fields
        expect(f!.floor.split(' ')).toHaveLength(4)
        expect(f!.rim.match(/M/g)).toHaveLength(4)
        expect(f!.blocks).toHaveLength(2)
        expect(f!.pads).toHaveLength(1)
        expect(f!.gates).toHaveLength(1)
        expect(plan.road.match(/M/g)!.length).toBe(2)
    })

    it('rims two joined fields as one, with no line where they meet', () => {
        const course = growField({ id: 'custom-test', name: 'Test', closed: false, sections: ROAD, fields: [{ at: { branch: 0, at: 3 }, ...defaultFieldPlan() }] }, { branch: 0, at: 3 }, 'exit').track!
        const plan = minimapPlan(new Track(compileCustomTrack(course).def!))
        expect(plan.fields).toHaveLength(2)
        expect(plan.fields.map(f => f.rim.match(/M/g)!.length)).toEqual([3, 3])
    })
})

describe('pillars round a field', () => {
    const compiled = (sections: SectionId[], at = -1) => {
        const fields = at < 0 ? undefined : [{ at: { branch: 0, at }, ...defaultFieldPlan() }]
        const { def, error } = compileCustomTrack({ id: 'custom-test', name: 'Test', closed: false, sections, fields })
        expect(error).toBeNull()
        return new Track(def!)
    }
    // A ramp up to a raised field, over the same ground as a flat road and a flat field laid from the same grid.
    const raised = compiled(['straight-20', 'start', 'ramp-up', 'straight-20', 'field', 'finish', 'straight-200'], 4)
    const flatRoad = compiled(['straight-20', 'start', 'straight-200', 'straight-200', 'straight-200', 'finish', 'straight-200'])
    const flatField = compiled(['straight-20', 'start', 'straight-200', 'field', 'finish', 'straight-200'], 3)

    it('keeps a raised field\'s pillars off a road below it', () => {
        const field = raised.fields[0]!
        const onRoad = ([u, v]: [number, number]) => { const [x, z] = field.world(u, v); return Math.abs(x) <= 10 && z < -40 }
        expect(field.y).toBeGreaterThan(0)
        expect(deckPillars(field, [], []).some(onRoad)).toBe(true)
        expect(deckPillars(field, flatRoad.branches, []).some(onRoad)).toBe(false)
    })

    it('keeps a raised road\'s pillars off a field below it', () => {
        const line = raised.branches[0]!
        const ground = flatField.fields[0]!
        const onField = (m: THREE.Matrix4) => { const p = new THREE.Vector3().setFromMatrixPosition(m); return fieldClearance([ground], p.x, p.z) < 0.5 }
        expect(pillarsUnder(line, []).some(onField)).toBe(true)
        expect(pillarsUnder(line, [], [ground]).some(onField)).toBe(false)
    })
})

describe('hazard stripes on a field', () => {
    /** Each field's hazard stripes, in its own (u, v, height): the one mesh lit amber. */
    function stripes(sections: SectionId[], fields: Parameters<typeof compileCustomTrack>[0]['fields'], grow = false) {
        let course: Parameters<typeof compileCustomTrack>[0] = { id: 'custom-test', name: 'Test', closed: false, sections, fields }
        if (grow) course = growField(course, { branch: 0, at: 3 }, 'exit').track!
        const { def, error } = compileCustomTrack(course)
        expect(error).toBeNull()
        const group = new THREE.Group()
        const owned: { dispose(): void }[] = []
        buildFields(worldKit(new Track(def!), group, owned), new THREE.MeshBasicMaterial(), new THREE.Texture())
        const out = group.children.map((g) => {
            const mesh = g.children.find(m => m instanceof THREE.Mesh && (m.material as THREE.MeshStandardMaterial).emissive?.getHex() === 0x332a08) as THREE.Mesh | undefined
            const pos = mesh?.geometry.getAttribute('position')
            return pos ? Array.from({ length: pos.count }, (_, i) => ({ u: pos.getX(i), y: pos.getY(i), v: -pos.getZ(i) })) : []
        })
        for (const o of owned) o.dispose()
        return out
    }

    it('stands none where two fields meet, as no wall does', () => {
        const [first, second] = stripes(ROAD, [{ at: { branch: 0, at: 3 }, ...defaultFieldPlan() }], true)
        // The first's way out and the second's way in are on the edge they share; only the road in and out get panels.
        expect(first!.length).toBeGreaterThan(0)
        expect(first!.every(p => p.v < 1)).toBe(true)
        expect(second!.every(p => p.v > 99)).toBe(true)
    })

    it('runs round a block\'s faces onto the open field', () => {
        const blocks: FieldTile[] = [{ col: 1, row: 2, kind: 'block' }, { col: 2, row: 2, kind: 'block' }]
        const [field] = stripes(ROAD, [{ at: { branch: 0, at: 3 }, ...defaultFieldPlan(), tiles: blocks }])
        const onBlock = field!.filter(p => p.u > 19 && p.u < 61 && p.v > 39 && p.v < 61)
        // Four faces round the merged pair, none on the seam between them.
        expect(onBlock).toHaveLength(16)
        expect(onBlock.some(p => Math.abs(p.u - 40) < 0.1)).toBe(false)
    })
})

describe('ads on a field', () => {
    it('postered every pillar, boards one block in three and spaces boards along the walls', () => {
        const blocks: FieldTile[] = [0, 1, 2, 3].map(col => ({ col, row: 2, kind: 'block' }))
        const pillars: FieldTile[] = [{ col: 1, row: 1, kind: 'pillar' }, { col: 3, row: 3, kind: 'pillar' }]
        const { def } = compileCustomTrack({ id: 'custom-test', name: 'Test', closed: false, sections: ROAD, fields: [{ at: { branch: 0, at: 3 }, ...defaultFieldPlan(), tiles: [...blocks, ...pillars] }] })
        const field = def!.fields![0]!
        const spots = fieldAdSpots(field, def!.fields!)
        expect(spots.pillars).toHaveLength(2)
        expect(spots.pillars[0]!.turn).not.toBe(spots.pillars[1]!.turn)
        expect(spots.blocks).toEqual([{ u: 10, v: 50 }, { u: 70, v: 50 }])
        // A 100 m edge has a board or two, none in a road's mouth.
        expect(spots.walls.length).toBeGreaterThanOrEqual(4)
        for (const w of spots.walls) {
            const on = edgeAt(field.plan, w.u, w.v)!
            expect(field.mouths.some(m => m.edge === on.edge && Math.abs(on.at - m.at) < m.half)).toBe(false)
        }
    })

    it('stands no board where two fields meet', () => {
        const course = growField({ id: 'custom-test', name: 'Test', closed: false, sections: ROAD, fields: [{ at: { branch: 0, at: 3 }, ...defaultFieldPlan() }] }, { branch: 0, at: 3 }, 'exit').track!
        const { fields } = compileCustomTrack(course).def!
        expect(fieldAdSpots(fields![0]!, fields!).walls.some(w => w.v > 99)).toBe(false)
    })
})
