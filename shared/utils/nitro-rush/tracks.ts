import { bankTo, boostPad, buildTrack, checkpoint, corkscrew, corner, finish, gap, kicker, landing, LINE_BLOCK_LENGTH, looping, MIN_HALF_WIDTH, ramp, slopeTo, spiral, start, straight, widthTo, type TrackLayout, type TrackPiece } from './layout'
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

const splitY: TrackPiece = { type: 'split', shape: 'y' }
const joinY: TrackPiece = { type: 'join', shape: 'y' }
const splitRight: TrackPiece = { type: 'split', shape: 'right' }
const joinRight: TrackPiece = { type: 'join', shape: 'right' }
/** The builder's bank, wide road and jump ramp heights, as its sections lay them. */
const BANK = 25
const WIDE = ROAD.halfWidth * 1.5
const KICKER = 4
const BIG_KICKER = 6
/** The 45° bend into a join, at the radius the builder solved for it. */
const mergeBend = (turn: 'left' | 'right', radius: number): TrackPiece => ({ type: 'corner', turn, radius, angle: 45, exact: true })

/**
 * A sprint that forks twice: the left branch rejoins the right one, which rejoins the main road before the finish.
 * Built in the track builder; the merge bends are frozen as solved then, so a solver change can't move the course under its records.
 */
export const DOUBLE_FORK: TrackLayout = {
    id: 'double-fork',
    name: 'The Double Fork',
    group: 'sprints',
    ...ROAD,
    closed: false,
    origin: { x: 0, z: 0, heading: 0 },
    pieces: [
        straight(20),
        start,
        straight(20),
        splitY,
        corner('right', 60, 45),
        checkpoint,
        splitY,
        corner('right', 60, 45),
        checkpoint,
        straight(10),
        corner('right', 60, 45),
        joinY,
        straight(30),
        finish,
        straight(60)
    ],
    branches: [
        {
            pieces: [
                corner('right', 60, 45),
                corner('left', 40, 45),
                straight(10),
                checkpoint,
                straight(20),
                corner('left', 40, 45),
                straight(30 * Math.SQRT2 - 40),
                mergeBend('right', 40 * Math.SQRT2)
            ],
            from: { branch: 0, at: 3 },
            to: { branch: 2, at: 2 }
        },
        {
            pieces: [
                corner('right', 60, 45),
                joinY,
                checkpoint,
                straight(10),
                corner('left', 60, 45),
                straight(40 * Math.SQRT2 - 50),
                mergeBend('right', 50 * Math.SQRT2 - 10)
            ],
            from: { branch: 0, at: 6 },
            to: { branch: 0, at: 12 }
        }
    ]
}

/** A fast oval on wide road with banked bowls at both ends, and a narrow bypass with a boost pad down the back straight. */
export const SPEEDBOWL: TrackLayout = {
    id: 'speedbowl',
    name: 'Speedbowl',
    group: 'circuits',
    ...ROAD,
    origin: { x: 0, z: 0, heading: 0 },
    pieces: [
        start,
        widthTo(WIDE),
        straight(200),
        boostPad('full'),
        straight(200),
        bankTo(-BANK),
        corner('left', 80),
        corner('left', 80),
        bankTo(0),
        widthTo(ROAD.halfWidth),
        splitRight,
        straight(300),
        joinRight,
        checkpoint,
        straight(30),
        bankTo(-BANK),
        corner('left', 80),
        corner('left', 80),
        bankTo(0)
    ],
    branches: [
        {
            pieces: [
                corner('right', 60, 45),
                corner('left', 60, 45),
                widthTo(MIN_HALF_WIDTH),
                boostPad('full'),
                straight(70),
                widthTo(ROAD.halfWidth),
                corner('left', 60, 45),
                straight(40 * Math.SQRT2 - 50),
                mergeBend('right', 50 * Math.SQRT2 - 10)
            ],
            from: { branch: 0, at: 10 },
            to: { branch: 0, at: 13 }
        }
    ]
}

/** A clockwise stunt loop: a looping, a corkscrew between banks, a climb and a spiral back down to the ground. */
export const CORKSCREW_HILL: TrackLayout = {
    id: 'corkscrew-hill',
    name: 'Corkscrew Hill',
    group: 'circuits',
    ...ROAD,
    origin: { x: 0, z: 0, heading: 0 },
    pieces: [
        start,
        straight(100),
        looping('right', 22),
        straight(100),
        corner('right', 60),
        bankTo(BANK),
        corkscrew('right', 200),
        bankTo(0),
        corner('right', 60),
        slopeTo(0.1),
        straight(80),
        slopeTo(0),
        straight(60),
        spiral('right', 40, 360, -12),
        corner('right', 60),
        checkpoint,
        straight(330),
        corner('right', 60)
    ]
}

/** A point-to-point sprint over two jumps: one on the ground, a bigger one off a raised road after a boost pad. */
export const LONG_JUMP_SPRINT: TrackLayout = {
    id: 'long-jump-sprint',
    name: 'Long Jump Sprint',
    group: 'sprints',
    ...ROAD,
    closed: false,
    origin: { x: 0, z: 0, heading: 0 },
    pieces: [
        straight(20),
        start,
        straight(100),
        kicker(KICKER),
        gap(60),
        landing,
        straight(100),
        corner('right', 60),
        checkpoint,
        ramp(150, 12),
        corner('left', 60),
        boostPad('full'),
        straight(60),
        kicker(BIG_KICKER),
        gap(60),
        landing,
        straight(160),
        corner('left', 60),
        ramp(80, -12),
        corner('right', 60),
        straight(60),
        finish,
        straight(200)
    ]
}

/** A sprint that splits for good: a narrow road over a hill to one finish, or a wide straight with a boost pad to another. */
export const SPLIT_FINISH: TrackLayout = {
    id: 'split-finish',
    name: 'The Split Finish',
    group: 'sprints',
    ...ROAD,
    closed: false,
    origin: { x: 0, z: 0, heading: 0 },
    pieces: [
        straight(20),
        start,
        straight(100),
        corner('right', 60),
        straight(60),
        corner('left', 60),
        checkpoint,
        straight(60),
        corner('right', 60),
        straight(60),
        splitY,
        widthTo(MIN_HALF_WIDTH),
        corner('right', 60, 45),
        boostPad('full'),
        ramp(80, 12),
        ramp(80, -12),
        checkpoint,
        widthTo(ROAD.halfWidth),
        straight(60),
        finish,
        straight(170)
    ],
    branches: [
        {
            pieces: [
                corner('right', 60, 45),
                corner('left', 60, 45),
                widthTo(WIDE),
                boostPad('full'),
                straight(200),
                checkpoint,
                straight(60),
                finish,
                straight(170)
            ],
            from: { branch: 0, at: 10 },
            to: null
        }
    ]
}

/** The courses players can pick, in menu order. Ids are leaderboard keys: never rename one. */
export const TRACKS: readonly TrackDef[] = [
    buildTrack(POLYTOWN_OVAL),
    buildTrack(TWIN_HELIX),
    buildTrack(SPEEDBOWL),
    buildTrack(CORKSCREW_HILL),
    buildTrack(S_BEND_SPRINT),
    buildTrack(ZIGZAG_SPRINT),
    buildTrack(DOUBLE_FORK),
    buildTrack(LONG_JUMP_SPRINT),
    buildTrack(SPLIT_FINISH)
]

export function findTrack(id: string) {
    return TRACKS.find(t => t.id === id) ?? null
}
