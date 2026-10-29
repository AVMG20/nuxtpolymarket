import { buildTrack, checkpoint, corner, finish, LINE_BLOCK_LENGTH, ramp, spiral, start, straight, type TrackLayout } from './layout'
import type { TrackDef, TrackGroup } from './track'

/** Menu categories, in menu order. */
export const TRACK_GROUPS: readonly { id: TrackGroup, name: string, blurb: string }[] = [
    { id: 'circuits', name: 'Circuits', blurb: 'Loops: lap as long as you like' },
    { id: 'sprints', name: 'Sprints', blurb: 'Point to point, start to finish' }
]

/** Every course runs on the same road, custom ones included. */
export const ROAD = { halfWidth: 9, wallOffset: 10.6 }

/** Two 360 m straights joined by 75 m bends, run anticlockwise seen from above, with the start mid main straight. */
export const POLYTOWN_OVAL: TrackLayout = {
    id: 'polytown-oval',
    name: 'Polytown Oval',
    group: 'circuits',
    ...ROAD,
    origin: { x: 75, z: LINE_BLOCK_LENGTH / 2, heading: 0 },
    pieces: [
        start,
        straight(170),
        corner('left', 75),
        corner('left', 75),
        straight(170),
        checkpoint,
        straight(170),
        corner('left', 75),
        corner('left', 75),
        straight(170)
    ]
}

/** A point-to-point sprint: two long straights joined by an S, a left then a right quarter. */
export const S_BEND_SPRINT: TrackLayout = {
    id: 's-bend-sprint',
    name: 'S-Bend Sprint',
    group: 'sprints',
    ...ROAD,
    closed: false,
    origin: { x: 50, z: 470, heading: 0 },
    pieces: [
        straight(30),
        start,
        straight(300),
        corner('left', 50),
        corner('right', 50),
        checkpoint,
        straight(300),
        finish,
        // Room to brake to a stop from nitro top speed before the end barrier.
        straight(170)
    ]
}

/**
 * A clockwise loop over two spirals: up a ramp, down a clockwise spiral, up an
 * anticlockwise one, down a second ramp, then back round on the ground.
 */
export const TWIN_HELIX: TrackLayout = {
    id: 'twin-helix',
    name: 'Twin Helix',
    group: 'circuits',
    ...ROAD,
    origin: { x: 0, z: LINE_BLOCK_LENGTH / 2, heading: 0 },
    pieces: [
        start,
        straight(120),
        ramp(150, 12),
        straight(40),
        spiral('right', 36, 450, -12),
        straight(120),
        spiral('left', 36, 450, 12),
        corner('right', 40),
        ramp(150, -12),
        straight(40),
        corner('right', 50),
        straight(270),
        checkpoint,
        straight(270),
        corner('right', 50),
        straight(372),
        corner('right', 50),
        straight(168)
    ]
}

/** A point-to-point sprint that zigzags up the diagonals: eighth turns out of and back onto the straights, quarters between. */
export const ZIGZAG_SPRINT: TrackLayout = {
    id: 'zigzag-sprint',
    name: 'Zigzag Sprint',
    group: 'sprints',
    ...ROAD,
    closed: false,
    origin: { x: -30, z: 580, heading: 0 },
    pieces: [
        straight(30),
        start,
        straight(150),
        corner('right', 60, 45),
        straight(150),
        corner('left', 60),
        straight(120),
        checkpoint,
        straight(120),
        corner('right', 60),
        straight(150),
        corner('left', 60, 45),
        straight(120),
        finish,
        // Room to brake to a stop from nitro top speed before the end barrier.
        straight(170)
    ]
}

/** The courses players can pick, in menu order. Ids are leaderboard keys: never rename one. */
export const TRACKS: readonly TrackDef[] = [buildTrack(POLYTOWN_OVAL), buildTrack(TWIN_HELIX), buildTrack(S_BEND_SPRINT), buildTrack(ZIGZAG_SPRINT)]

export function findTrack(id: string) {
    return TRACKS.find(t => t.id === id) ?? null
}
