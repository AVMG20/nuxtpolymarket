import { Track, TrackLine, type BranchDef, type TrackDef } from '#shared/utils/nitro-rush/track'

/** Courses drawn point by point for the timer and fork specs: test fixtures only, never in the player's list. */

const ROAD = { halfWidth: 9, wallOffset: 10.6 }
const EIGHTH = Math.PI / 4

/** A centreline drawn from a start pose, sampled every 2 m or less. */
export class Path {
    readonly pts: [number, number][] = []
    readonly ys: number[] = []
    x: number
    z: number
    tx: number
    tz: number
    y: number

    constructor(x: number, z: number, tx = 0, tz = -1, y = 0) {
        this.x = x
        this.z = z
        this.tx = tx
        this.tz = tz
        this.y = y
        this.push()
    }

    private push() {
        this.pts.push([this.x, this.z])
        this.ys.push(this.y)
    }

    straight(length: number, rise = 0) {
        const n = Math.max(1, Math.ceil(length / 2))
        for (let i = 0; i < n; i++) {
            this.x += this.tx * length / n
            this.z += this.tz * length / n
            this.y += rise / n
            this.push()
        }
        return this
    }

    /** A bend of `angle` radians, 1 to the right or -1 to the left. */
    arc(dir: 1 | -1, radius: number, angle: number) {
        const n = Math.max(1, Math.ceil(radius * angle / 2))
        const { x, z, tx, tz } = this
        // Right of the driving direction.
        const rx = -tz
        const rz = tx
        for (let i = 1; i <= n; i++) {
            const a = angle * i / n
            this.x = x + radius * (tx * Math.sin(a) + dir * rx * (1 - Math.cos(a)))
            this.z = z + radius * (tz * Math.sin(a) + dir * rz * (1 - Math.cos(a)))
            this.tx = tx * Math.cos(a) + dir * rx * Math.sin(a)
            this.tz = tz * Math.cos(a) + dir * rz * Math.sin(a)
            this.push()
        }
        return this
    }

    /** Turns on the spot to face (tx, tz), for courses whose corners are kinks. */
    face(tx: number, tz: number) {
        this.tx = tx
        this.tz = tz
        return this
    }

    /** Two eighth bends that move the road `shift` metres across, 1 to the right or -1 to the left, heading the same way after. */
    shift(dir: 1 | -1, shift: number) {
        const radius = shift / (2 * (1 - Math.cos(EIGHTH)))
        return this.arc(dir, radius, EIGHTH).arc(dir === 1 ? -1 : 1, radius, EIGHTH)
    }

    /** The points of a loop, which closes back on its first point by itself. */
    loop() {
        return { points: this.pts.slice(0, -1), ys: this.ys.slice(0, -1) }
    }
}

/** How far along a sampled open line the point nearest (x, z) is. */
export function sAt(points: [number, number][], x: number, z: number) {
    return new TrackLine({ points, ...ROAD, closed: false }).project(x, z).s
}

/** The spot `s` along line `branch`, `lateral` across it. */
export function at(track: Track, s: number, branch = 0, lateral = 0): [number, number, number] {
    const p = (track.branches[branch] ?? track).pointAt(s)
    return [p.x - p.tz * lateral, p.y, p.z + p.tx * lateral]
}

/** A rectangle 460 by 40 m round, exactly 1000 m, with its start line halfway up a long side; `checkpoints` in metres from it. */
export function rectangleLoop(checkpoints: number[] = []): Track {
    const { points } = new Path(0, 0).straight(230).face(1, 0).straight(40).face(0, 1).straight(460).face(-1, 0).straight(40).face(0, -1).straight(230).loop()
    return new Track({ id: 'rectangle', name: 'Rectangle', group: 'circuits', points, ...ROAD, checkpoints })
}

/** A straight sprint with `lap` metres from start to finish; `checkpoints` in metres from the start line. */
export function straightSprint(lap: number, checkpoints: number[] = []): Track {
    const runUp = 30
    const runOff = 150
    const { pts } = new Path(0, 0).straight(runUp + lap + runOff)
    return new Track({ id: 'straight', name: 'Straight', group: 'sprints', points: pts, ...ROAD, closed: false, runUp, runOff, checkpoints: checkpoints.map(s => runUp + s) })
}

/**
 * A loop with a fork inside a fork and a cross-join: branch 1 leaves the main straight and rejoins it, branch 2
 * leaves branch 1 and rejoins it, and branch 3 crosses from branch 1 back to the main line. Five routes; the
 * fewest checkpoints on any is two.
 */
export function forkLoopDef(): TrackDef {
    const { points } = new Path(0, 0).straight(1000).arc(1, 50, Math.PI / 2).straight(400).arc(1, 50, Math.PI / 2)
        .straight(1000).arc(1, 50, Math.PI / 2).straight(400).arc(1, 50, Math.PI / 2).loop()
    const loop = new TrackLine({ points, ...ROAD })
    // The main straight runs up -z from the start line, so distance along it is -z.
    const one = new Path(0, -40).straight(2).shift(-1, 60)
    one.straight(760 + one.z).shift(1, 60)
    const two = new Path(-60, -220).straight(2).shift(-1, 60)
    two.straight(420 + two.z).shift(1, 60)
    const radius = 60 / (2 * (1 - Math.cos(EIGHTH)))
    const three = new Path(-60, -600).straight(2).arc(1, radius, EIGHTH)
    const across = [three.x, three.z] as const
    three.arc(-1, radius, EIGHTH)
    const onOne = (x: number, z: number) => sAt(one.pts, x, z)
    return {
        id: 'fork-loop', name: 'Fork Loop', group: 'circuits', points, ...ROAD,
        checkpoints: [300, loop.project(500, -500).s],
        branches: [
            { points: one.pts, checkpoints: [onOne(-60, -700)], from: { branch: 0, at: 40 }, to: { branch: 0, at: -one.z } },
            { points: two.pts, checkpoints: [sAt(two.pts, -120, -400)], from: { branch: 1, at: onOne(-60, -220) }, to: { branch: 1, at: onOne(two.x, two.z) } },
            { points: three.pts, checkpoints: [sAt(three.pts, ...across)], from: { branch: 1, at: onOne(-60, -600) }, to: { branch: 0, at: -three.z } }
        ]
    }
}

/** A sprint that forks into two finishes, each with its own run-off and barrier; two checkpoints on each route. */
export function forkSprintDef(): TrackDef {
    const runUp = 30
    const runOff = 150
    const { pts } = new Path(0, 0).straight(760)
    const branch = new Path(0, -100).straight(2).shift(-1, 60)
    branch.straight(560)
    return {
        id: 'fork-sprint', name: 'Fork Sprint', group: 'sprints', points: pts, ...ROAD, closed: false, runUp, runOff, checkpoints: [60, 400],
        branches: [{ points: branch.pts, checkpoints: [sAt(branch.pts, -60, -450)], from: { branch: 0, at: 100 }, to: 'finish', runOff }]
    }
}

/** A sprint whose branch climbs and bends back over the main line on a bridge 12 m up. */
export function bridgeSprintDef(): TrackDef {
    const { pts } = new Path(0, 0).straight(1000)
    const bridge = new Path(0, -100).straight(2).shift(1, 60)
    bridge.straight(20).straight(100, 12).arc(-1, 50, Math.PI / 2).straight(400)
    return {
        id: 'bridge-sprint', name: 'Bridge Sprint', group: 'sprints', points: pts, ...ROAD, closed: false, runUp: 30, runOff: 150,
        branches: [{ points: bridge.pts, heights: bridge.ys, from: { branch: 0, at: 100 }, to: 'finish', runOff: 150 }]
    }
}
