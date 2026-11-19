import * as THREE from 'three'
import type { AdMaterial } from './ad-materials'
import type { AdDeck } from './ads'
import { BLOCK_HEIGHT, PILLAR_BAND, PILLAR_HEIGHT } from './world-field'
import type { WorldKit } from './world-kit'
import { fieldEdgeWalls, FIELD_TILE, PILLAR_RADIUS, type FieldDef, type LevelField } from '#shared/utils/nitro-rush/field'
import { WALL_BASE_HALF, WALL_HEIGHT } from '#shared/utils/nitro-rush/track'

/** Ads on the fields: posters round each pillar's tower, a board on some blocks and boards along some walls. */

/** Posters round a pillar, spread evenly, between its hazard band and its neon ring. */
const POSTERS_PER_PILLAR = 3
const POSTER_BOTTOM = PILLAR_BAND + 0.6
const POSTER_TOP = PILLAR_HEIGHT - 1.2
/** One block in this many carries a board, so a wall of blocks isn't a wall of ads. */
const BLOCKS_PER_BOARD = 3
const BLOCK_BOARD_WIDTH = FIELD_TILE * 0.6
const BLOCK_BOARD_LIFT = 0.6
/** Metres of wall to a board, and the shortest run of wall that takes one. */
const WALL_BOARD_SPACING = 50
const WALL_BOARD_WIDTH = 9.2
const WALL_BOARD_LIFT = 1.2

/** A board along a wall in the field's (u, v): its middle, and the unit way into the field it faces. */
export interface WallBoardSpot {
    u: number
    v: number
    nu: number
    nv: number
}

export interface FieldAdSpots {
    /** Each pillar's centre, and the turn its first poster faces, so neighbours don't line up. */
    pillars: { u: number, v: number, turn: number }[]
    blocks: { u: number, v: number }[]
    walls: WallBoardSpot[]
}

/** Where a field's ads stand; `all` is every field of the course, as no wall stands where two meet. */
export function fieldAdSpots(def: FieldDef, all: readonly LevelField[]): FieldAdSpots {
    const { tiles } = def.plan
    const centre = (t: { col: number, row: number }) => ({ u: (t.col + 0.5) * FIELD_TILE, v: (t.row + 0.5) * FIELD_TILE })
    const byPlace = (a: { col: number, row: number }, b: { col: number, row: number }) => a.row - b.row || a.col - b.col
    const pillars = tiles.filter(t => t.kind === 'pillar').sort(byPlace).map((t, i) => ({ ...centre(t), turn: i * 0.7 }))
    const blocks = tiles.filter(t => t.kind === 'block').sort(byPlace).filter((_, i) => i % BLOCKS_PER_BOARD === 0).map(centre)
    const walls = fieldEdgeWalls(def, all).flatMap((w) => {
        const length = Math.hypot(w.x1 - w.x0, w.z1 - w.z0)
        if (length < WALL_BOARD_WIDTH + 4) return []
        const count = Math.max(1, Math.floor(length / WALL_BOARD_SPACING))
        return Array.from({ length: count }, (_, k) => {
            const f = (k + 0.5) / count
            return { u: w.x0 + (w.x1 - w.x0) * f, v: w.z0 + (w.z1 - w.z0) * f, nu: w.nx, nv: w.nz }
        })
    })
    return { pillars, blocks, walls }
}

/** Every field's ads, dealt from the course's `deck`. */
export function buildFieldAds(kit: WorldKit, steel: THREE.Material, ad: AdMaterial, deck: AdDeck) {
    const { track, own } = kit
    if (!track.fields.length) return
    const defs = track.fields.map(f => f.def)
    const posterHeight = POSTER_TOP - POSTER_BOTTOM
    const posterArc = (posterHeight * 0.75) / PILLAR_RADIUS
    const poster = own(new THREE.CylinderGeometry(PILLAR_RADIUS + 0.06, PILLAR_RADIUS + 0.06, posterHeight, 12, 1, true, -posterArc / 2, posterArc).translate(0, POSTER_BOTTOM + posterHeight / 2, 0))
    const blockBoard = boardParts(kit, BLOCK_BOARD_WIDTH, BLOCK_BOARD_LIFT, true)
    const wallBoard = boardParts(kit, WALL_BOARD_WIDTH, WALL_BOARD_LIFT, false)
    for (const field of track.fields) {
        const spots = fieldAdSpots(field.def, defs)
        const group = new THREE.Group()
        group.position.set(field.x, field.y, field.z)
        group.rotation.y = -field.heading
        for (const p of spots.pillars) {
            for (let k = 0; k < POSTERS_PER_PILLAR; k++) {
                const m = new THREE.Mesh(poster, ad('poster', deck()))
                m.position.set(p.u, 0, -p.v)
                m.rotation.y = p.turn + k * Math.PI * 2 / POSTERS_PER_PILLAR
                group.add(m)
            }
        }
        // Across the field's length, so it reads to cars driving along it either way.
        for (const b of spots.blocks) group.add(blockBoard(ad('board', deck()), steel, b.u, BLOCK_HEIGHT, b.v, 0))
        for (const w of spots.walls) {
            // On the wall's top, facing into the field.
            const u = w.u - w.nu * WALL_BASE_HALF
            const v = w.v - w.nv * WALL_BASE_HALF
            group.add(wallBoard(ad('board', deck()), steel, u, WALL_HEIGHT, v, Math.atan2(w.nu, w.nv)))
        }
        kit.group.add(group)
    }
}

/** A 2:1 board on two legs, `lift` metres over the surface it stands on; `both` prints its back too. Its front faces +v at turn 0. */
function boardParts({ own }: WorldKit, width: number, lift: number, both: boolean) {
    const height = width / 2
    const faceGeo = own(new THREE.PlaneGeometry(width, height))
    const backGeo = own(new THREE.BoxGeometry(width + 0.2, height + 0.2, 0.25))
    const legGeo = own(new THREE.BoxGeometry(0.3, 1, 0.25).translate(0, 0.5, 0))
    return (print: THREE.Material, steel: THREE.Material, u: number, surface: number, v: number, turn: number) => {
        const g = new THREE.Group()
        g.position.set(u, 0, -v)
        // A field's +v is local -z, which a plane faces at a half turn.
        g.rotation.y = Math.PI - turn
        const mid = surface + lift + height / 2
        const back = new THREE.Mesh(backGeo, steel)
        back.position.y = mid
        g.add(back)
        for (const side of both ? [1, -1] : [1]) {
            const face = new THREE.Mesh(faceGeo, print)
            face.position.set(0, mid, side * 0.14)
            if (side < 0) face.rotation.y = Math.PI
            g.add(face)
        }
        // Legs stop under the board, in line with its frame, so its back stays clean.
        for (const x of [-width / 3, width / 3]) {
            const leg = new THREE.Mesh(legGeo, steel)
            leg.position.set(x, surface, 0)
            leg.scale.y = lift
            g.add(leg)
        }
        return g
    }
}
