import * as THREE from 'three'
import { LINE_COLORS, NEON_PINK } from './config'
import { DECK_DEPTH, fieldClearance, roadBelow } from './road-geometry'
import { JERSEY, wallMaterial } from './world-road'
import { BOOST_TILE_LENGTH, checkerTexture, chevronTexture, concreteTexture, obstacleGlowTexture, radialTexture } from './textures'
import type { WorldKit } from './world-kit'
import { blockWalls, edgeLength, edgePoint, fieldEdgeWalls, FIELD_TILE, GATE_SPAN, isBlocking, isFieldLine, PILLAR_RADIUS, wallSpans, type FieldDef, type WallSegment } from '#shared/utils/nitro-rush/field'
import { WALL_BASE_HALF, type CourseField, type TrackLine } from '#shared/utils/nitro-rush/track'

/** Fields in the world, each in its own frame where field (u, v) is local (u, y, -v); gate arches are the venue's. */

/** A block stands a touch over the walls, so it reads as solid from across the field. */
export const BLOCK_HEIGHT = 1.1
/** A pillar's tower, and the hazard band round its foot that its ads keep clear of. */
export const PILLAR_HEIGHT = 12
export const PILLAR_BAND = 1.2
/** The pink neon ring round a pillar's top: how far under the top it starts, and how tall. */
const PILLAR_RING: [number, number] = [0.6, 0.25]
const JERSEY_BASE = JERSEY[1]![0]
/** Hazard panels run this far along the wall either side of a mouth. */
const MOUTH_PANEL = 4
/** Pads stop short of their tile's edges, so neighbours read apart. */
const TILE_INSET = 1
/** The glowing line across the floor between a gate's posts, its width along the way through. */
const GATE_LINE = 0.6
/** A start or finish line's chequered band: two rows of square checks right across the tile, to read from across a big field. */
const CHECKER_DEPTH = (FIELD_TILE / 2 - TILE_INSET) / 2
/** The chevrons past a start that show the way its grid faces: tip, arm length and stroke. */
const ARROW_TIP = 7
const ARROW_ARM = 3
const ARROW_STROKE = 0.7
/** Hazard stripes along a block's faces: their foot and top, under the block's own top edge. */
const BLOCK_STRIPE: [number, number] = [0.25, 0.95]
const PILLAR_SPACING = FIELD_TILE * 2
/** The glow round blocks and pillars: a warning red, kept faint so it doesn't pass for a pad or a gate. */
const OBSTACLE_GLOW = 0xff2b3a

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
        gateLine: own(new THREE.MeshBasicMaterial({ color: LINE_COLORS.checkpoint, polygonOffset: true, polygonOffsetFactor: -2 })),
        // A soft pool of the gate's colour over its tile, so it reads against the floor from across the field.
        gateGlow: own(glowMaterial(own(radialTexture()), LINE_COLORS.checkpoint, 0.45)),
        requiredLine: own(new THREE.MeshBasicMaterial({ color: LINE_COLORS.required, polygonOffset: true, polygonOffsetFactor: -2 })),
        requiredGlow: own(glowMaterial(own(radialTexture()), LINE_COLORS.required, 0.5)),
        // A start or finish glows in its line's colour, apart from the cyan gates and green pads.
        startGlow: own(glowMaterial(own(radialTexture()), LINE_COLORS.start, 0.5)),
        finishGlow: own(glowMaterial(own(radialTexture()), LINE_COLORS.finish, 0.6)),
        checker: own(new THREE.MeshStandardMaterial({ map: own(checkerTexture()), roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 })),
        arrow: own(new THREE.MeshBasicMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -2 }))
    }
    const defs = track.fields.map(f => f.def)
    for (const field of track.fields) buildField(kit, field, defs, mats)
}

const glowMaterial = (map: THREE.Texture, color: number, opacity: number) => new THREE.MeshBasicMaterial({ map, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })

type FieldMats = Record<'floor' | 'grid' | 'wall' | 'bollard' | 'band' | 'hazard' | 'pad' | 'gateLine' | 'gateGlow' | 'requiredLine' | 'requiredGlow' | 'startGlow' | 'finishGlow' | 'checker' | 'arrow', THREE.Material>

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
    obstacleGlow(kit, group, field)

    const walls = fieldEdgeWalls(field.def, defs)
    const jersey = new Quads()
    const band = new Quads()
    for (const s of walls) sweepWall(jersey, band, s)
    if (!jersey.empty) {
        mesh(jersey.build(), mats.wall)
        mesh(band.build(), mats.band)
    }
    const hazard = mouthPanels(field, walls)
    blockStripes(hazard, field)
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

/** A faint red glow on the floor round the blocks and pillars, one texture over the field so joined blocks glow as one. */
function obstacleGlow({ own }: WorldKit, group: THREE.Group, field: CourseField) {
    const plan = field.def.plan
    if (!plan.tiles.some(t => isBlocking(t.kind))) return
    const map = own(obstacleGlowTexture(plan, PILLAR_RADIUS, FIELD_TILE))
    const mat = own(new THREE.MeshBasicMaterial({ map, color: OBSTACLE_GLOW, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }))
    const q = new Quads()
    const { width: w, length: l } = field
    q.add([at(0, 0, 0.02), at(w, 0, 0.02), at(w, l, 0.02), at(0, l, 0.02)], [[0, 0], [1, 0], [1, 1], [0, 1]], [0, 1, 0])
    const mesh = new THREE.Mesh(own(q.build()), mat)
    mesh.renderOrder = 1
    group.add(mesh)
}

/** Hazard stripes on the walls either side of each mouth, so a way out reads from across the field; none where fields meet and no wall stands. */
function mouthPanels(field: CourseField, walls: readonly WallSegment[]) {
    const q = new Quads()
    const plan = field.def.plan
    for (const m of field.mouths) {
        const len = edgeLength(plan, m.edge)
        const spans = wallSpans(plan, walls, m.edge)
        const inward = edgeInward(m.edge)
        const off = (pt: { u: number, v: number }, y: number) => at(pt.u + inward[0] * 0.03, pt.v + inward[1] * 0.03, y)
        for (const [a, b] of [[m.at - m.half - MOUTH_PANEL, m.at - m.half], [m.at + m.half, m.at + m.half + MOUTH_PANEL]] as const) {
            for (const [wa, wb] of spans) {
                const from = Math.max(0, a, wa)
                const to = Math.min(len, b, wb)
                if (to - from < 0.5) continue
                const p = edgePoint(plan, m.edge, from)
                const r = edgePoint(plan, m.edge, to)
                q.add([off(p, 0.1), off(r, 0.1), off(r, 0.8), off(p, 0.8)], [[0, 0], [to - from, 0], [to - from, 0.7], [0, 0.7]], dirOf(...inward))
            }
        }
    }
    return q
}

/** Hazard stripes round every block's outline, facing the open field, so blocks stand out from the floor. */
function blockStripes(q: Quads, field: CourseField) {
    const [lo, hi] = BLOCK_STRIPE
    for (const s of blockWalls(field.def.plan)) {
        const len = Math.hypot(s.x1 - s.x0, s.z1 - s.z0)
        const off = (u: number, v: number, y: number) => at(u + s.nx * 0.03, v + s.nz * 0.03, y)
        q.add([off(s.x0, s.z0, lo), off(s.x1, s.z1, lo), off(s.x1, s.z1, hi), off(s.x0, s.z0, hi)], [[0, 0], [len, 0], [len, hi - lo], [0, hi - lo]], dirOf(s.nx, s.nz))
    }
}

/** The unit (du, dv) from an edge into its field. */
const edgeInward = (edge: string): [number, number] => edge === 'entry' ? [0, 1] : edge === 'exit' ? [0, -1] : edge === 'left' ? [1, 0] : [-1, 0]

/** Blocks, pillar towers, pads, and the line and glow under each gate, on their tiles. */
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
    const [ringDrop, ringHeight] = PILLAR_RING
    instanced(pillarBand(), mats.bollard, pillars)
    instanced(new THREE.CylinderGeometry(PILLAR_RADIUS, PILLAR_RADIUS, PILLAR_HEIGHT - PILLAR_BAND, 48).translate(0, (PILLAR_HEIGHT + PILLAR_BAND) / 2, 0), mats.wall, pillars)
    instanced(new THREE.CylinderGeometry(PILLAR_RADIUS + 0.04, PILLAR_RADIUS + 0.04, ringHeight, 48, 1, true).translate(0, PILLAR_HEIGHT - ringDrop, 0), mats.band, pillars)

    const pads = new Quads()
    const gateLines = new Quads()
    const gateGlows = new Quads()
    const requiredLines = new Quads()
    const requiredGlows = new Quads()
    const lineGlows = { start: new Quads(), finish: new Quads() }
    const checkers = new Quads()
    const arrows = new Quads()
    const half = FIELD_TILE / 2 - TILE_INSET
    for (const t of plan.tiles) {
        if (!('dir' in t)) continue
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
        if (isFieldLine(t.kind)) {
            // Chequered like the road's; only a start gets chevrons, as only its way matters.
            const d = CHECKER_DEPTH / 2
            checkers.add([corner(-d, -half, 0.04), corner(-d, half, 0.04), corner(d, half, 0.04), corner(d, -half, 0.04)], [[0, 0], [1, 0], [1, 1], [0, 1]], [0, 1, 0])
            lineGlows[t.kind].add([corner(-half, -half, 0.035), corner(-half, half, 0.035), corner(half, half, 0.035), corner(half, -half, 0.035)], [[0, 0], [1, 0], [1, 1], [0, 1]], [0, 1, 0])
            const s = ARROW_STROKE / 2
            for (const side of t.kind === 'start' ? [-1, 1] : []) {
                arrows.add([corner(ARROW_TIP - ARROW_ARM, side * ARROW_ARM - s, 0.04), corner(ARROW_TIP - ARROW_ARM, side * ARROW_ARM + s, 0.04), corner(ARROW_TIP, s, 0.04), corner(ARROW_TIP, -s, 0.04)], [[0, 0], [1, 0], [1, 1], [0, 1]], [0, 1, 0])
            }
            continue
        }
        const w = GATE_LINE / 2
        const required = 'required' in t && t.required
        const lines = required ? requiredLines : gateLines
        const glows = required ? requiredGlows : gateGlows
        lines.add([corner(-w, -GATE_SPAN, 0.04), corner(-w, GATE_SPAN, 0.04), corner(w, GATE_SPAN, 0.04), corner(w, -GATE_SPAN, 0.04)], [[0, 0], [1, 0], [1, 1], [0, 1]], [0, 1, 0])
        glows.add([corner(-half, -half, 0.035), corner(-half, half, 0.035), corner(half, half, 0.035), corner(half, -half, 0.035)], [[0, 0], [1, 0], [1, 1], [0, 1]], [0, 1, 0])
    }
    const add = (q: Quads, mat: THREE.Material) => {
        if (q.empty) return
        const mesh = new THREE.Mesh(own(q.build()), mat)
        group.add(mesh)
    }
    add(pads, mats.pad)
    add(gateGlows, mats.gateGlow)
    add(requiredGlows, mats.requiredGlow)
    add(lineGlows.start, mats.startGlow)
    add(lineGlows.finish, mats.finishGlow)
    add(gateLines, mats.gateLine)
    add(requiredLines, mats.requiredLine)
    add(checkers, mats.checker)
    add(arrows, mats.arrow)
}

/** The striped hazard band round a pillar's foot, its stripes a metre apart round it. */
function pillarBand() {
    const geo = new THREE.CylinderGeometry(PILLAR_RADIUS + 0.02, PILLAR_RADIUS + 0.02, PILLAR_BAND, 48, 1, true).translate(0, PILLAR_BAND / 2, 0)
    const uv = geo.getAttribute('uv')
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.PI * 2 * PILLAR_RADIUS, uv.getY(i) * PILLAR_BAND)
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
