import { bankTo, boostPad, buildTrack, checkpoint, corkscrew, corner, finish, gap, kicker, landing, LINE_BLOCK_LENGTH, looping, MIN_HALF_WIDTH, ramp, spiral, start, straight, widthTo, type TrackLayout, type TrackPiece } from './layout'
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
const splitLeft: TrackPiece = { type: 'split', shape: 'left' }
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

/** A figure eight: up over a bridge across its own road, a looping after a boost pad, then a chicane or a narrow shortcut past it. */
export const CROSSOVER: TrackLayout = {
    id: 'crossover',
    name: 'Crossover',
    group: 'circuits',
    ...ROAD,
    origin: { x: 0, z: 0, heading: 0 },
    pieces: [
        start,
        ramp(150, 12),
        corner('right', 80, 45),
        straight(200),
        corner('left', 80, 45),
        boostPad('full'),
        looping('left', 22),
        straight(120),
        bankTo(-BANK),
        corner('left', 80),
        corner('left', 80),
        bankTo(0),
        ramp(150, -12),
        corner('left', 80, 45),
        straight(200),
        corner('right', 80, 45),
        splitRight,
        straight(20),
        corner('left', 40, 45),
        corner('right', 40, 45),
        corner('right', 40, 45),
        corner('left', 40, 45),
        straight(60),
        corner('right', 40),
        straight(20),
        joinRight,
        straight(40),
        corner('right', 40),
        straight(100)
    ],
    branches: [
        {
            pieces: [
                corner('right', 60, 45),
                corner('left', 60, 45),
                widthTo(MIN_HALF_WIDTH),
                straight(20),
                widthTo(ROAD.halfWidth),
                corner('right', 60, 45),
                straight(10 * Math.SQRT2),
                mergeBend('right', 60)
            ],
            from: { branch: 0, at: 16 },
            to: { branch: 0, at: 26 }
        }
    ]
}

/** Hairpins up a hill to a corkscrew between banks, a big jump off the top, and a dive back down over the start straight. */
export const SWITCHBACK: TrackLayout = {
    id: 'switchback',
    name: 'Switchback',
    group: 'circuits',
    ...ROAD,
    origin: { x: 0, z: 0, heading: 0 },
    pieces: [
        start,
        straight(60),
        ramp(80, 12),
        corner('left', 30, 180),
        ramp(80, 12),
        corner('right', 60, 180),
        straight(60),
        bankTo(BANK),
        corner('right', 60),
        corkscrew('right', 200),
        corner('right', 60),
        bankTo(0),
        boostPad('full'),
        kicker(BIG_KICKER),
        gap(140),
        landing,
        corner('right', 60),
        ramp(80, -12),
        ramp(80, -12),
        corner('left', 30, 180),
        straight(20),
        corner('left', 60),
        straight(20),
        kicker(KICKER),
        gap(60),
        landing,
        straight(20)
    ]
}

/** A nearly straight sprint over three jumps that grow, the last off a raised road, each sized to land on its ramp at full speed. */
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
        straight(200),
        boostPad('full'),
        kicker(KICKER),
        gap(130),
        landing,
        straight(100),
        corner('right', 80, 45),
        straight(100),
        corner('left', 80, 45),
        checkpoint,
        straight(100),
        boostPad('full'),
        kicker(BIG_KICKER),
        gap(160),
        landing,
        straight(100),
        corner('left', 80, 45),
        straight(60),
        corner('right', 80, 45),
        checkpoint,
        ramp(150, 12),
        boostPad('full'),
        straight(60),
        boostPad('full'),
        kicker(BIG_KICKER),
        gap(180),
        landing,
        ramp(150, -12),
        straight(100),
        finish,
        straight(200)
    ]
}

/** A sprint that splits for good into three finishes: a narrow road over a jump, a wide road with boost pads, or a hill over both. */
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
        splitLeft,
        straight(60),
        corner('left', 60),
        checkpoint,
        straight(20),
        splitY,
        corner('right', 60, 45),
        widthTo(MIN_HALF_WIDTH),
        straight(160),
        boostPad('full'),
        kicker(KICKER),
        gap(140),
        landing,
        checkpoint,
        widthTo(ROAD.halfWidth),
        straight(60),
        finish,
        straight(170)
    ],
    branches: [
        {
            pieces: [
                corner('left', 60, 45),
                corner('left', 60, 45),
                straight(60),
                ramp(150, 12),
                corner('right', 60, 45),
                straight(60),
                ramp(150, 12),
                straight(100),
                corner('left', 60, 45),
                checkpoint,
                ramp(80, -12),
                straight(20),
                ramp(80, -12),
                straight(100),
                finish,
                straight(170)
            ],
            from: { branch: 0, at: 4 },
            to: null
        },
        {
            pieces: [
                corner('right', 60, 45),
                corner('left', 60, 45),
                widthTo(WIDE),
                boostPad('full'),
                straight(300),
                checkpoint,
                corner('right', 80, 45),
                corner('left', 80, 45),
                boostPad('full'),
                straight(200),
                finish,
                straight(170)
            ],
            from: { branch: 0, at: 9 },
            to: null
        }
    ]
}

/** The courses players can pick, in menu order. Ids are leaderboard keys: never rename one. */
export const TRACKS: readonly TrackDef[] = [
    buildTrack(POLYTOWN_OVAL),
    buildTrack(TWIN_HELIX),
    buildTrack(CROSSOVER),
    buildTrack(SWITCHBACK),
    buildTrack(S_BEND_SPRINT),
    buildTrack(ZIGZAG_SPRINT),
    buildTrack(DOUBLE_FORK),
    buildTrack(LONG_JUMP_SPRINT),
    buildTrack(SPLIT_FINISH)
]

export function findTrack(id: string) {
    return TRACKS.find(t => t.id === id) ?? null
}
