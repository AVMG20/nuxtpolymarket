import * as THREE from 'three'
import { buildStage, CourseMaterials, layCourse, MARKER_LIFT } from './builder-course'
import { worldKit } from './world-kit'
import { draftTrackDef, mapWalkHeights, sectionWalk, type SectionId } from '#shared/utils/nitro-rush/custom'
import { sectionPartner } from '#shared/utils/nitro-rush/custom-forks'
import type { LayoutWalk } from '#shared/utils/nitro-rush/layout'
import { Track, wallFoot } from '#shared/utils/nitro-rush/track'

const WIDTH = 320
const HEIGHT = 200
/** Above and to the road's right: a straight runs across the card, and a ramp shows its profile. */
export const VIEW_DIR = new THREE.Vector3().setFromSphericalCoords(1, 1, 1)
const WORLD_UP = new THREE.Vector3(0, 1, 0)
/** Back far enough that the grid ground in view never meets the near plane. */
const CAMERA_DISTANCE = 2000
/** Heights are tiny beside a section's length; stretched so a ramp or a spiral reads at card size. */
const HEIGHT_STRETCH = 2.5
/** Further than this from the end point, the end marker has nothing left to draw. */
const MARKER_REACH = 5
/** Paint for about this long, then rest: an occasional long frame, because a run of them reads as a slow machine to AdaptiveResolution, which then lowers the race's resolution for the session. */
export const PAINT_BUDGET_MS = 24
export const PAINT_REST_MS = 200

/** The orthographic window that holds `points` seen along `dir`, shaped to `aspect`, with `margin` of its size to spare. */
export function fitView(points: readonly THREE.Vector3[], dir: THREE.Vector3, aspect: number, margin = 0.1) {
    const right = new THREE.Vector3().crossVectors(WORLD_UP, dir).normalize()
    const up = new THREE.Vector3().crossVectors(dir, right).normalize()
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const p of points) {
        const x = p.dot(right)
        const y = p.dot(up)
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
    }
    const halfHeight = Math.max(maxY - minY, (maxX - minX) / aspect) / 2 * (1 + margin)
    const centre = right.multiplyScalar((minX + maxX) / 2).addScaledVector(up, (minY + maxY) / 2)
    return { centre, halfWidth: halfHeight * aspect, halfHeight }
}

/** A section as its card shows it; a looping keeps its true shape or its circle would come out an egg, and a bank or its low edge would float. */
export function cardWalk(id: SectionId): LayoutWalk {
    const walk = sectionWalk(id)
    return walk.rails.length || walk.lifts.some(Boolean) ? walk : mapWalkHeights(walk, y => y * HEIGHT_STRETCH)
}

/** The road's outer edges, the ground under them and the end marker: everything a card has to show. */
export function cardExtent(track: Track, end: LayoutWalk['end']) {
    const points: THREE.Vector3[] = []
    for (let i = 0; i < track.n; i++) {
        const edge = wallFoot(track.walls[i]!)
        const centre = new THREE.Vector3(track.xs[i], track.ys[i], track.zs[i])
        const right = new THREE.Vector3(track.right[i * 3], track.right[i * 3 + 1], track.right[i * 3 + 2])
        for (const side of [-edge, edge]) {
            const foot = centre.clone().addScaledVector(right, side)
            points.push(foot, new THREE.Vector3(foot.x, 0, foot.z))
        }
    }
    const marker = new THREE.Vector3(end.x, end.y + MARKER_LIFT, end.z)
    for (const axis of [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as const) {
        const offset = new THREE.Vector3(...axis).multiplyScalar(MARKER_REACH)
        points.push(marker.clone().add(offset), marker.clone().sub(offset))
    }
    return points
}

/** Draws sections one at a time on a single context: a live canvas per card would run past the browser's cap on WebGL contexts. */
export class SectionThumbPainter {
    private readonly renderer = new THREE.WebGLRenderer({ antialias: true })
    private readonly scene = new THREE.Scene()
    private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, CAMERA_DISTANCE * 2)
    private readonly mats = new CourseMaterials()
    private readonly stage: { dispose(): void }
    /** Kept until the painter is done: disposing a material deletes its shader, which the next card would recompile. */
    private readonly usedMats: THREE.Material[] = []

    constructor() {
        this.renderer.outputColorSpace = THREE.SRGBColorSpace
        this.renderer.setPixelRatio(1)
        this.renderer.setSize(WIDTH, HEIGHT, false)
        this.stage = buildStage(this.scene, this.renderer)
    }

    /** The section as an image URL, or null once the context is lost, when it could only draw a blank. */
    paint(id: SectionId) {
        if (this.renderer.getContext().isContextLost()) return null
        const walk = cardWalk(id)
        const track = new Track(draftTrackDef(walk, false)!)
        const group = new THREE.Group()
        const parts: { dispose(): void }[] = []
        // No end walls: on a card they'd read as a dead end, not a piece that joins on.
        layCourse(worldKit(track, group, parts), { lines: walk.lines, ends: [walk.end], originY: null }, this.mats, { endWalls: false })
        const extent = cardExtent(track, walk.end)
        // A split's arm, or a join's road in, laid as a course of its own beside it; flat, so no stretch.
        const partner = sectionPartner(id)
        if (partner) {
            const other = new Track(draftTrackDef(partner, false)!)
            // A join's road in ends where the section does, which already has its marker.
            const meets = Math.hypot(partner.end.x - walk.end.x, partner.end.z - walk.end.z) < 0.5
            layCourse(worldKit(other, group, parts), { lines: [], ends: meets ? [] : [partner.end], originY: null }, this.mats, { endWalls: false })
            extent.push(...cardExtent(other, partner.end))
        }
        this.scene.add(group)
        this.aim(fitView(extent, VIEW_DIR, WIDTH / HEIGHT))
        this.renderer.render(this.scene, this.camera)
        // Read before the frame ends: the drawing buffer isn't kept after that.
        const url = this.renderer.domElement.toDataURL('image/png')
        this.scene.remove(group)
        for (const part of parts) {
            if (part instanceof THREE.Material) this.usedMats.push(part)
            else part.dispose()
        }
        return url
    }

    dispose() {
        for (const m of this.usedMats) m.dispose()
        this.stage.dispose()
        this.mats.dispose()
        // Browsers cap contexts, so free this one now rather than at GC.
        this.renderer.forceContextLoss()
        this.renderer.dispose()
    }

    private aim({ centre, halfWidth, halfHeight }: ReturnType<typeof fitView>) {
        this.camera.left = -halfWidth
        this.camera.right = halfWidth
        this.camera.top = halfHeight
        this.camera.bottom = -halfHeight
        this.camera.position.copy(centre).addScaledVector(VIEW_DIR, CAMERA_DISTANCE)
        this.camera.lookAt(centre)
        this.camera.updateProjectionMatrix()
    }
}
