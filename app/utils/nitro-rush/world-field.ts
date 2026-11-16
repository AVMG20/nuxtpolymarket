import * as THREE from 'three'
import { NEON_PINK } from './config'
import { DECK_DEPTH, fieldClearance, roadBelow } from './road-geometry'
import { JERSEY, wallMaterial } from './world-road'
import { BOOST_TILE_LENGTH, chevronTexture, concreteTexture } from './textures'
import { jumpArrowTexture } from './signs'
import type { WorldKit } from './world-kit'
import { edgeLength, edgePoint, edgeWalls, FIELD_TILE, PILLAR_RADIUS, sharedEdges, type FieldDef, type WallSegment } from '#shared/utils/nitro-rush/field'
import { WALL_BASE_HALF, type CourseField, type TrackLine } from '#shared/utils/nitro-rush/track'

/** Fields in the world, each in its own frame where field (u, v) is local (u, y, -v); gate arches are the venue's. */

/** A block stands a touch over the walls, so it reads as solid from across the field. */
const BLOCK_HEIGHT = 1.1
const BOLLARD_HEIGHT = 1.2
const JERSEY_BASE = JERSEY[1]![0]
/** Hazard panels run this far along the wall either side of a mouth. */
const MOUTH_PANEL = 4
/** Pads and arrows stop short of their tile's edges, so neighbours read apart. */
const TILE_INSET = 1
const ARROW_SIZE = 8
const PILLAR_SPACING = FIELD_TILE * 2

type Vec3 = [number, number, number]
type UV = [number, number]

/** Quads gathered into one geometry, each wound to face `normal`. */
class Quads {
    private readonly pos: number[] = []
    private readonly uv: number[] = []
    private readonly index: number[] = []

    add(corners: [Vec3, Vec3, Vec3, Vec3], uvs: [UV, UV, UV, UV], normal: Vec3) {
        const [a, b, c] = corners
        const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
        const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
        const facing = (e1[1]! * e2[2]! - e1[2]! * e2[1]!) * normal[0] + (e1[2]! * e2[0]! - e1[0]! * e2[2]!) * normal[1] + (e1[0]! * e2[1]! - e1[1]! * e2[0]!) * normal[2]
        const k = this.pos.length / 3
        for (const p of corners) this.pos.push(...p)
        for (const t of uvs) this.uv.push(...t)
        if (facing >= 0) this.index.push(k, k + 1, k + 2, k, k + 2, k + 3)
        else this.index.push(k, k + 2, k + 1, k, k + 3, k + 2)
    }

    get empty() {
        return this.index.length === 0
    }

    build() {
        const g = new THREE.BufferGeometry()
        g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
        g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2))
        g.setIndex(this.index)
        g.computeVertexNormals()
        return g
    }
}

/** A field's (u, v) and height as a local point. */
const at = (u: number, v: number, y = 0): Vec3 => [u, y, -v]
/** A field's direction (du, dv) as a local vector. */
const dirOf = (du: number, dv: number): Vec3 => [du, 0, -dv]
/** The unit (du, dv) a quarter turn count points, clockwise from forward seen from above. */
const quarter = (dir: number): [number, number] => [[0, 1], [1, 0], [0, -1], [-1, 0]][((dir % 4) + 4) % 4] as [number, number]

const GridShader = {
    uniforms: { uColor: { value: new THREE.Color(0xc8d2ff) }, uOpacity: { value: 0.16 } },
    vertexShader: /* glsl */`
        #include <fog_pars_vertex>
        varying vec2 vField;
        void main() {
            vField = uv;
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mvPosition;
            #include <fog_vertex>
        }`,
    fragmentShader: /* glsl */`
        #include <fog_pars_fragment>
        uniform vec3 uColor;
        uniform float uOpacity;
        varying vec2 vField;
        // A grid line every tile, never under about 1.5 px wide, dimmed by the width it gained so it doesn't flicker far off.
        float gridLine(float x, float fw) {
            float d = abs(fract(x / ${FIELD_TILE.toFixed(1)} + 0.5) - 0.5) * ${FIELD_TILE.toFixed(1)};
            float w = max(0.12, fw * 0.75);
            return (1.0 - smoothstep(w - fw * 0.5, w + fw * 0.5, d)) * (0.12 / w);
        }
        void main() {
            vec2 fw = max(fwidth(vField), vec2(1e-4));
            float g = max(gridLine(vField.x, fw.x), gridLine(vField.y, fw.y));
            gl_FragColor = vec4(uColor, clamp(g, 0.0, 1.0) * uOpacity);
            #include <fog_fragment>
        }`
}

/** Every field of the course; `padMaterial` is the road pads' scrolling material, shared so field pads run with them. */
export function buildFields(kit: WorldKit, padMaterial: THREE.Material, concrete: THREE.Texture) {
    const { track, own } = kit
    if (!track.fields.length) return
    const floorTex = own(concreteTexture(70))
    floorTex.repeat.set(1 / 8, 1 / 8)
    const mats = {
        floor: own(new THREE.MeshStandardMaterial({ map: floorTex, color: 0x4a4a50, roughness: 0.88, metalness: 0.05 })),
        grid: own(new THREE.ShaderMaterial({
            uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, GridShader.uniforms]),
            vertexShader: GridShader.vertexShader,
            fragmentShader: GridShader.fragmentShader,
            transparent: true,
            depthWrite: false,
            fog: true,
            polygonOffset: true,
            polygonOffsetFactor: -1
        })),
        wall: own(wallMaterial(concrete)),
        bollard: own(new THREE.MeshStandardMaterial({ map: own(chevronTexture()), roughness: 0.55 })),
        band: own(new THREE.MeshBasicMaterial({ color: NEON_PINK, side: THREE.DoubleSide })),
        hazard: own(new THREE.MeshStandardMaterial({ map: own(chevronTexture()), roughness: 0.55, emissive: 0x332a08, polygonOffset: true, polygonOffsetFactor: -2 })),
        pad: padMaterial,
        arrow: own(new THREE.MeshStandardMaterial({ map: own(jumpArrowTexture()), emissive: 0xffffff, emissiveIntensity: 0.3, roughness: 0.6, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }))
    }
    const defs = track.fields.map(f => f.def)
    for (const field of track.fields) buildField(kit, field, defs, mats)
}

type FieldMats = Record<'floor' | 'grid' | 'wall' | 'bollard' | 'band' | 'hazard' | 'pad' | 'arrow', THREE.Material>

function buildField(kit: WorldKit, field: CourseField, defs: readonly FieldDef[], mats: FieldMats) {
    const { own } = kit
    const group = new THREE.Group()
    group.position.set(field.x, field.y, field.z)
    group.rotation.y = -field.heading
    kit.group.add(group)
    const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
        const m = new THREE.Mesh(own(geo), mat)
        group.add(m)
        return m
    }
    const { width: w, length: l } = field

    const floor = new Quads()
    floor.add([at(0, 0), at(w, 0), at(w, l), at(0, l)], [[0, 0], [w, 0], [w, l], [0, l]], [0, 1, 0])
    mesh(floor.build(), mats.floor)
    const grid = new Quads()
    grid.add([at(0, 0, 0.01), at(w, 0, 0.01), at(w, l, 0.01), at(0, l, 0.01)], [[0, 0], [w, 0], [w, l], [0, l]], [0, 1, 0])
    mesh(grid.build(), mats.grid).renderOrder = 1

    const walls = edgeWalls(field.def.plan, field.def.mouths, sharedEdges(field.def, defs))
    const jersey = new Quads()
    const band = new Quads()
    for (const s of walls) sweepWall(jersey, band, s)
    if (!jersey.empty) {
        mesh(jersey.build(), mats.wall)
        mesh(band.build(), mats.band)
    }
    const hazard = mouthPanels(field)
    if (!hazard.empty) mesh(hazard.build(), mats.hazard)
    tiles(kit, group, field, mats)
    if (field.y > 0.3) deck(kit, group, field, mats.wall)
}

/** The jersey wall along a straight face, its body behind the face, and the neon band on its inner slope. */
function sweepWall(jersey: Quads, band: Quads, s: WallSegment) {
    const len = Math.hypot(s.x1 - s.x0, s.z1 - s.z0)
    const point = (t: number, a: number, y: number): Vec3 => {
        const off = a - JERSEY_BASE
        return at(s.x0 + (s.x1 - s.x0) * t + s.nx * off, s.z0 + (s.z1 - s.z0) * t + s.nz * off, y)
    }
    let u0 = 0
    for (let e = 0; e < JERSEY.length - 1; e++) {
        const [a0, y0] = JERSEY[e]!
        const [a1, y1] = JERSEY[e + 1]!
        const edge = Math.hypot(a1 - a0, y1 - y0)
        if (edge < 1e-6) continue
        // The profile runs anticlockwise, so its edge turned a quarter clockwise points out of the wall.
        const na = y1 - y0
        const ny = -(a1 - a0)
        jersey.add([point(0, a0, y0), point(1, a0, y0), point(1, a1, y1), point(0, a1, y1)], [[u0, 0], [u0, len / 4], [u0 + edge, len / 4], [u0 + edge, 0]], at(s.nx * na, s.nz * na, ny))
        u0 += edge
    }
    const inner = (t: number, a: number, y: number) => point(t, JERSEY_BASE + a, y)
    band.add([inner(0, 0.16, 0.46), inner(1, 0.16, 0.46), inner(1, 0.19, 0.72), inner(0, 0.19, 0.72)], [[0, 0], [1, 0], [1, 1], [0, 1]], dirOf(s.nx, s.nz))
}

/** Hazard stripes on the walls either side of each mouth, so a way out reads from across the field. */
function mouthPanels(field: CourseField) {
    const q = new Quads()
    const plan = field.def.plan
    for (const m of field.mouths) {
        const len = edgeLength(plan, m.edge)
        for (const [a, b] of [[m.at - m.half - MOUTH_PANEL, m.at - m.half], [m.at + m.half, m.at + m.half + MOUTH_PANEL]] as const) {
            const from = Math.max(0, a)
            const to = Math.min(len, b)
            if (to - from < 0.5) continue
            const p = edgePoint(plan, m.edge, from)
            const r = edgePoint(plan, m.edge, to)
            const inward = edgeInward(m.edge)
            const off = (pt: { u: number, v: number }, y: number) => at(pt.u + inward[0] * 0.03, pt.v + inward[1] * 0.03, y)
            q.add([off(p, 0.1), off(r, 0.1), off(r, 0.8), off(p, 0.8)], [[0, 0], [to - from, 0], [to - from, 0.7], [0, 0.7]], dirOf(...inward))
        }
    }
    return q
}

/** The unit (du, dv) from an edge into its field. */
const edgeInward = (edge: string): [number, number] => edge === 'entry' ? [0, 1] : edge === 'exit' ? [0, -1] : edge === 'left' ? [1, 0] : [-1, 0]

/** Blocks, bollards, pads and gate arrows on their tiles. */
function tiles(kit: WorldKit, group: THREE.Group, field: CourseField, mats: FieldMats) {
    const { own } = kit
    const plan = field.def.plan
    const centre = (col: number, row: number): [number, number] => [(col + 0.5) * FIELD_TILE, (row + 0.5) * FIELD_TILE]
    const m = new THREE.Matrix4()
    const instanced = (geo: THREE.BufferGeometry, mat: THREE.Material, spots: readonly [number, number][], y = 0) => {
        if (!spots.length) return
        const mesh = own(new THREE.InstancedMesh(own(geo), mat, spots.length))
        spots.forEach(([u, v], i) => mesh.setMatrixAt(i, m.makeTranslation(...at(u, v, y))))
        group.add(mesh)
    }
    const blocks = plan.tiles.filter(t => t.kind === 'block').map(t => centre(t.col, t.row))
    instanced(new THREE.BoxGeometry(FIELD_TILE, BLOCK_HEIGHT, FIELD_TILE).translate(0, BLOCK_HEIGHT / 2, 0), mats.wall, blocks)
    const pillars = plan.tiles.filter(t => t.kind === 'pillar').map(t => centre(t.col, t.row))
    instanced(bollard(), mats.bollard, pillars)

    const pads = new Quads()
    const arrows = new Quads()
    const half = FIELD_TILE / 2 - TILE_INSET
    for (const t of plan.tiles) {
        if (t.kind !== 'boost' && t.kind !== 'checkpoint') continue
        const [cu, cv] = centre(t.col, t.row)
        const [du, dv] = quarter(t.dir)
        // Across the way it points, to its right.
        const [ru, rv] = [dv, -du]
        const corner = (along: number, across: number, y: number) => at(cu + du * along + ru * across, cv + dv * along + rv * across, y)
        if (t.kind === 'boost') {
            const tiles = (half * 2) / BOOST_TILE_LENGTH
            pads.add([corner(-half, -half, 0.03), corner(-half, half, 0.03), corner(half, half, 0.03), corner(half, -half, 0.03)], [[0, 0], [1, 0], [1, tiles], [0, tiles]], [0, 1, 0])
            continue
        }
        const a = ARROW_SIZE / 2
        // Leading up to the arch, pointing through it.
        arrows.add([corner(-a - 2, -a, 0.03), corner(-a - 2, a, 0.03), corner(a - 2, a, 0.03), corner(a - 2, -a, 0.03)], [[0, 0], [1, 0], [1, 1], [0, 1]], [0, 1, 0])
    }
    const add = (q: Quads, mat: THREE.Material) => {
        if (q.empty) return
        const mesh = new THREE.Mesh(own(q.build()), mat)
        group.add(mesh)
    }
    add(pads, mats.pad)
    add(arrows, mats.arrow)
}

/** A striped bollard, its stripes a metre apart round it. */
function bollard() {
    const geo = new THREE.CylinderGeometry(PILLAR_RADIUS, PILLAR_RADIUS, BOLLARD_HEIGHT, 24).translate(0, BOLLARD_HEIGHT / 2, 0)
    const uv = geo.getAttribute('uv')
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.PI * 2 * PILLAR_RADIUS, uv.getY(i) * BOLLARD_HEIGHT)
    return geo
}

/** A raised field's slab under its floor, on pillars across it. */
function deck(kit: WorldKit, group: THREE.Group, field: CourseField, wallMat: THREE.Material) {
    const { own } = kit
    const slab = new THREE.Mesh(own(new THREE.BoxGeometry(field.width, DECK_DEPTH, field.length)), wallMat)
    slab.position.set(...at(field.width / 2, field.length / 2, -DECK_DEPTH / 2))
    group.add(slab)
    const tall = field.y - DECK_DEPTH
    if (tall <= 0) return
    const spots = deckPillars(field, kit.track.branches, kit.track.fields).map(([u, v]) => at(u, v, -field.y))
    const pillars = own(new THREE.InstancedMesh(own(new THREE.BoxGeometry(0.8, 1, 0.8).translate(0, 0.5, 0)), wallMat, spots.length))
    const m = new THREE.Matrix4()
    spots.forEach((p, i) => pillars.setMatrixAt(i, m.compose(new THREE.Vector3(...p), new THREE.Quaternion(), new THREE.Vector3(1, tall, 1))))
    group.add(pillars)
}

/** Where a raised field's deck stands, in field metres: on a grid across it, but never on a road or a field below it. */
export function deckPillars(field: CourseField, lines: readonly TrackLine[], fields: readonly CourseField[]) {
    const under = field.y - DECK_DEPTH
    const lower = fields.filter(f => f !== field && f.y < under)
    const spots: [number, number][] = []
    for (let u = PILLAR_SPACING / 2; u < field.width; u += PILLAR_SPACING) {
        for (let v = PILLAR_SPACING / 2; v < field.length; v += PILLAR_SPACING) {
            const [x, z] = field.world(u, v)
            if (roadBelow(lines, x, z, WALL_BASE_HALF * 2, under) || fieldClearance(lower, x, z) < 1) continue
            spots.push([u, v])
        }
    }
    return spots
}
