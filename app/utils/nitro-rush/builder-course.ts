import * as THREE from 'three'
import { LINE_COLORS, NEON_PINK } from './config'
import { ribbon, roadLeft, roadRight, wallLeft, wallRight } from './road-geometry'
import { boostPadTexture, concreteTexture, gridTexture, ROAD_TILE_LENGTH } from './textures'
import { addBoostPads, boostPadMaterial, buildBarriers } from './world-road'
import type { WorldKit } from './world-kit'
import type { LineBlock } from '#shared/utils/nitro-rush/layout'
import { newTrackFrame, type TrackDef, type TrackLine } from '#shared/utils/nitro-rush/track'

/** Where a road ends, heading as layouts give it. */
export interface RoadEnd {
    x: number
    y: number
    z: number
    heading: number
}

/** The road as the builder has it, to draw in a 3D view: one line, or a whole forked course. */
export interface PreviewCourse {
    def: TrackDef
    /** Each line block, the point its line crosses, and on a forked course the line it's on. */
    lines: readonly { type: LineBlock, at: number, branch?: number }[]
    /** Where the next section attaches on each line still open. */
    ends: readonly RoadEnd[]
    /** The height of the start a loop still open has to come back to; null when there's nothing to show. */
    originY: number | null
    /** A line drawn without the road it leaves from, which has no wall across its start. */
    openStart?: boolean
}

/** How far the end marker floats above the road. */
export const MARKER_LIFT = 4

const GROUND_SIZE = 6000
const GRID_CELL = 10
/** Metres between the points of an empty stretch's outline, and its dashes and spaces. */
const OUTLINE_STEP = 2
export const DASH = 3
export const DASH_GAP = 2

/** What a builder course is drawn with; lives as long as its view, across rebuilds of the road. */
export class CourseMaterials {
    readonly concrete = concreteTexture(150)
    readonly deck = new THREE.MeshStandardMaterial({ color: 0x2a2d3c, roughness: 0.85 })
    readonly marker = new THREE.MeshBasicMaterial({ color: NEON_PINK })
    readonly origin = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true })
    readonly empty = new THREE.LineDashedMaterial({ color: 0x3df2ff, dashSize: DASH, gapSize: DASH_GAP })
    readonly lines = Object.fromEntries(Object.entries(LINE_COLORS).map(([k, c]) => [k, new THREE.MeshBasicMaterial({ color: c, polygonOffset: true, polygonOffsetFactor: -1 })])) as Record<LineBlock, THREE.MeshBasicMaterial>
    readonly markerGeo = new THREE.ConeGeometry(3, 8, 4).rotateX(-Math.PI / 2)
    readonly boostPads = boostPadTexture()
    readonly boostPad = boostPadMaterial(this.boostPads)

    constructor() {
        this.concrete.repeat.set(0.5, 0.5)
    }

    dispose() {
        for (const m of [this.concrete, this.deck, this.marker, this.origin, this.empty, this.markerGeo, this.boostPads, this.boostPad, ...Object.values(this.lines)]) m.dispose()
    }
}

/** A marker over where a road ends. */
export function endMarker(end: RoadEnd, geometry: THREE.BufferGeometry, material: THREE.Material) {
    const marker = new THREE.Mesh(geometry, material)
    marker.position.set(end.x, end.y + MARKER_LIFT, end.z)
    // Layout headings turn right with +; three's y rotation turns left.
    marker.rotation.y = -end.heading
    return marker
}

/** Each stretch of empty road between `start` and `stop` as a dashed loop round where its deck would be, so a jump's gap still reads as part of the course. */
export function emptyOutlines(track: TrackLine, start = 0, stop = track.length): THREE.BufferGeometry[] {
    const f = newTrackFrame()
    const within = track.gaps.map(([a, b]) => [Math.max(a, start), Math.min(b, stop)] as const).filter(([a, b]) => b > a)
    return within.map(([from, to]) => {
        const steps = Math.max(1, Math.round((to - from) / OUTLINE_STEP))
        const edge = (side: number) => Array.from({ length: steps + 1 }, (_, k) => {
            const s = from + (to - from) * k / steps
            track.frameAt(s, f)
            const lat = side * track.wallAt(s)
            return new THREE.Vector3(f.x + f.rx * lat, f.y + f.ry * lat, f.z + f.rz * lat)
        })
        // Up one edge and back down the other; the loop closes across the start.
        return new THREE.BufferGeometry().setFromPoints([...edge(-1), ...edge(1).reverse()])
    })
}

/** The road with its real walls, deck and pillars, its lines and markers; returns each line's deck, which is what picking hits. */
export function layCourse(kit: WorldKit, course: Pick<PreviewCourse, 'lines' | 'ends' | 'originY'>, mats: CourseMaterials, { endWalls = true } = {}) {
    const { track, group } = kit
    // Wall to wall: the game fills the run-off between road and walls with aprons.
    const decks = track.branches.map(line => kit.add(ribbon(line, 0, line.length, wallLeft, wallRight, 0, ROAD_TILE_LENGTH), mats.deck))
    buildBarriers(kit, mats.concrete, { endWalls })
    addBoostPads(kit, mats.boostPad)
    for (const line of track.branches) {
        for (const geo of emptyOutlines(line)) group.add(new THREE.LineLoop(kit.own(geo), mats.empty).computeLineDistances())
    }
    for (const block of course.lines) {
        const line = track.branches[block.branch ?? 0]!
        const s = line.cum[Math.min(block.at, line.n - 1)]!
        kit.add(ribbon(line, s - 1.2, s + 1.2, roadLeft, roadRight, 0.02, 2.4), mats.lines[block.type])
    }
    for (const end of course.ends) group.add(endMarker(end, mats.markerGeo, mats.marker))
    if (course.originY !== null) {
        const origin = new THREE.Mesh(mats.markerGeo, mats.origin)
        origin.position.set(0, course.originY + MARKER_LIFT, 0)
        group.add(origin)
    }
    return decks
}

/** The backdrop every builder view shares: night sky colour, lights and the grid ground. */
export function buildStage(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    scene.background = new THREE.Color(0x0b0221)
    const sun = new THREE.DirectionalLight(0xffffff, 1.6)
    sun.position.set(120, 260, 80)
    scene.add(new THREE.HemisphereLight(0x9aa6ff, 0x1a1030, 1.4), sun)

    const grid = gridTexture()
    grid.repeat.set(GROUND_SIZE / GRID_CELL, GROUND_SIZE / GRID_CELL)
    grid.anisotropy = renderer.capabilities.getMaxAnisotropy()
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: grid }))
    ground.position.y = -0.05
    scene.add(ground)
    return {
        dispose() {
            ground.geometry.dispose()
            grid.dispose()
            ground.material.dispose()
        }
    }
}
