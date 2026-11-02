import * as THREE from 'three'
import { LINE_COLORS, NEON_PINK } from './config'
import { ribbon } from './road-geometry'
import { concreteTexture, gridTexture, ROAD_TILE_LENGTH } from './textures'
import { buildBarriers } from './world-road'
import type { WorldKit } from './world-kit'
import type { LineBlock } from '#shared/utils/nitro-rush/layout'
import type { TrackDef } from '#shared/utils/nitro-rush/track'

/** The road as the builder has it, to draw in a 3D view. */
export interface PreviewCourse {
    def: TrackDef
    /** Each line block and the point its line crosses. */
    lines: readonly { type: LineBlock, at: number }[]
    /** Where the next section attaches, unless the loop is closed; heading as layouts give it. */
    end: { x: number, y: number, z: number, heading: number } | null
    /** A loop still open shows where it has to come back to. */
    showOrigin: boolean
}

/** How far the end marker floats above the road. */
export const MARKER_LIFT = 4

const GROUND_SIZE = 6000
const GRID_CELL = 10

/** What a builder course is drawn with; lives as long as its view, across rebuilds of the road. */
export class CourseMaterials {
    readonly concrete = concreteTexture(150)
    readonly deck = new THREE.MeshStandardMaterial({ color: 0x2a2d3c, roughness: 0.85 })
    readonly marker = new THREE.MeshBasicMaterial({ color: NEON_PINK })
    readonly origin = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true })
    readonly lines = Object.fromEntries(Object.entries(LINE_COLORS).map(([k, c]) => [k, new THREE.MeshBasicMaterial({ color: c, polygonOffset: true, polygonOffsetFactor: -1 })])) as Record<LineBlock, THREE.MeshBasicMaterial>
    readonly markerGeo = new THREE.ConeGeometry(3, 8, 4).rotateX(-Math.PI / 2)

    constructor() {
        this.concrete.repeat.set(0.5, 0.5)
    }

    dispose() {
        for (const m of [this.concrete, this.deck, this.marker, this.origin, this.markerGeo, ...Object.values(this.lines)]) m.dispose()
    }
}

/** The road with its real walls, deck and pillars, its lines and markers; returns the deck, which is what picking hits. */
export function layCourse(kit: WorldKit, course: Pick<PreviewCourse, 'lines' | 'end' | 'showOrigin'>, mats: CourseMaterials, { endWalls = true } = {}) {
    const { track, group } = kit
    // Wall to wall: the game fills the run-off between road and walls with aprons.
    const deck = kit.add(ribbon(track, 0, track.length, -track.wallOffset, track.wallOffset, 0, ROAD_TILE_LENGTH), mats.deck)
    buildBarriers(kit, mats.concrete, { endWalls })
    for (const line of course.lines) {
        const s = track.cum[Math.min(line.at, track.n - 1)]!
        kit.add(ribbon(track, s - 1.2, s + 1.2, -track.halfWidth, track.halfWidth, 0.02, 2.4), mats.lines[line.type])
    }
    if (course.end) {
        const marker = new THREE.Mesh(mats.markerGeo, mats.marker)
        marker.position.set(course.end.x, course.end.y + MARKER_LIFT, course.end.z)
        // Layout headings turn right with +; three's y rotation turns left.
        marker.rotation.y = -course.end.heading
        group.add(marker)
    }
    if (course.showOrigin) {
        const origin = new THREE.Mesh(mats.markerGeo, mats.origin)
        origin.position.set(0, MARKER_LIFT, 0)
        group.add(origin)
    }
    return deck
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
