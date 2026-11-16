import { describe, expect, it } from 'vitest'
import { compileCustomTrack, type CustomTrack, type SectionId } from '#shared/utils/nitro-rush/custom'
import { ghostDrivesTrack } from '#shared/utils/nitro-rush/drive-check'
import { defaultFieldPlan, FIELD_TILE, GATE_POST_RADIUS, gatePosts, type FieldTile } from '#shared/utils/nitro-rush/field'
import { routeCrossings, routeFieldPaths, type FieldPath } from '#shared/utils/nitro-rush/field-plan'
import { LapTimer } from '#shared/utils/nitro-rush/timing'
import { Track } from '#shared/utils/nitro-rush/track'
import { findTrack } from '#shared/utils/nitro-rush/tracks'
import { PHYSICS_HZ } from '../../app/utils/nitro-rush/config'
import { botLapTime, medalTimes } from '../../app/utils/nitro-rush/medals'
import { botInput, createCar, crossesLines, stepCar } from '../../app/utils/nitro-rush/physics'
import { drive, trackOf } from './bot-lap'

const ROAD: SectionId[] = ['straight-20', 'start', 'field', 'finish', 'straight-200']

/** A sprint across a 100 m square field with `tiles` on it. */
function fieldTrack(tiles: FieldTile[] = []) {
    const t: CustomTrack = { id: 'custom-test', name: 'Test', closed: false, sections: ROAD, fields: [{ at: { branch: 0, at: 2 }, ...defaultFieldPlan(), tiles }] }
    const { def, error } = compileCustomTrack(t)
    expect(error).toBeNull()
    return new Track(def!)
}

const pathOf = (t: Track): FieldPath => {
    const [path] = routeFieldPaths(t.fields, t.routes[0]!)
    expect(path).toBeDefined()
    return path!
}

/** The path's points in field metres, sampled every metre along it. */
function samples(t: Track, path: FieldPath) {
    const field = t.fields[path.field]!
    const out: { u: number, v: number }[] = []
    for (let i = 0; i + 1 < path.points.length; i++) {
        const [ax, az] = path.points[i]!
        const [bx, bz] = path.points[i + 1]!
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az)))
        for (let k = 0; k < n; k++) out.push(field.local(ax + (bx - ax) * k / n, az + (bz - az) * k / n))
    }
    return out
}
const onTile = (p: { u: number, v: number }, col: number, row: number) => Math.floor(p.u / FIELD_TILE) === col && Math.floor(p.v / FIELD_TILE) === row

describe('the field planner', () => {
    it('crosses an empty field straight from mouth to mouth', () => {
        const t = fieldTrack()
        const crossings = routeCrossings(t.fields, t.routes[0]!)
        expect(crossings).toHaveLength(1)
        expect(crossings[0]!.into.edge).toBe('entry')
        expect(crossings[0]!.out.edge).toBe('exit')
        for (const p of samples(t, pathOf(t)).filter(p => p.v > 0 && p.v < 100)) expect(Math.abs(p.u - 50)).toBeLessThan(0.5)
    })

    it('goes round a row of blocks through the one gap', () => {
        const wall: FieldTile[] = [1, 2, 3, 4].map(col => ({ col, row: 2, kind: 'block' }))
        const t = fieldTrack(wall)
        const points = samples(t, pathOf(t)).filter(p => p.v > 0 && p.v < 100)
        expect(points.some(p => onTile(p, 0, 2))).toBe(true)
        for (const p of points) expect(wall.some(w => onTile(p, w.col, w.row))).toBe(false)
    })

    it('drives through every gate the way it is crossed', () => {
        const t = fieldTrack([{ col: 0, row: 1, kind: 'checkpoint', dir: 0 }, { col: 4, row: 3, kind: 'checkpoint', dir: 0 }])
        const points = samples(t, pathOf(t))
        for (const [col, row] of [[0, 1], [4, 3]] as const) {
            const i = points.findIndex(p => onTile(p, col, row))
            expect(i).toBeGreaterThan(0)
            // Forward through the gate: v grows across its tile.
            expect(points[i + 5]!.v).toBeGreaterThan(points[i]!.v)
        }
    })

    it('goes through each gate between its posts and never near one', () => {
        const tiles: FieldTile[] = [{ col: 0, row: 1, kind: 'checkpoint', dir: 0 }, { col: 1, row: 4, kind: 'checkpoint', dir: 1 }, { col: 4, row: 2, kind: 'checkpoint', dir: 2 }]
        const t = fieldTrack(tiles)
        const posts = tiles.flatMap(g => g.kind === 'checkpoint' ? gatePosts(g) : [])
        for (const p of samples(t, pathOf(t))) {
            for (const [u, v] of posts) expect(Math.hypot(p.u - u, p.v - v)).toBeGreaterThan(GATE_POST_RADIUS + 2)
        }
        expect(ghostDrivesTrack(t, drive(t))).toBe(true)
    })

    it('works a route out once', () => {
        const t = fieldTrack([{ col: 2, row: 2, kind: 'pillar' }])
        expect(routeFieldPaths(t.fields, t.routes[0]!)).toBe(routeFieldPaths(t.fields, t.routes[0]!))
    })

    it('takes the bot round blocks and through the gates to a lap that counts', () => {
        const t = fieldTrack([
            { col: 0, row: 1, kind: 'checkpoint', dir: 0 },
            { col: 4, row: 3, kind: 'checkpoint', dir: 0 },
            { col: 2, row: 2, kind: 'block' },
            { col: 3, row: 2, kind: 'block' },
            { col: 1, row: 4, kind: 'pillar' },
            { col: 2, row: 0, kind: 'boost', dir: 0 }
        ])
        const ghost = drive(t)
        expect(ghostDrivesTrack(t, ghost)).toBe(true)
    })

    it('drives The Open Field to the finish without touching a wall', () => {
        const t = new Track(findTrack('open-field')!)
        expect(t.fields).toHaveLength(1)
        expect(t.checkpointCount).toBe(2)
        const car = createCar(t, t.startS - 14)
        for (let i = 0; i < PHYSICS_HZ * 20; i++) {
            const ev = stepCar(car, botInput(car, t), t, 1 / PHYSICS_HZ)
            expect(ev.fell).toBe(false)
            expect(ev.wallImpact).toBe(0)
        }
        expect(botLapTime(t)).not.toBeNull()
        expect(ghostDrivesTrack(t, drive(t))).toBe(true)
    })

    it('drives straight through a gate that faces back down the road', () => {
        const t = fieldTrack([{ col: 2, row: 3, kind: 'checkpoint', dir: 2 }])
        expect(ghostDrivesTrack(t, drive(t))).toBe(true)
    })

    it('takes every gate again on each lap of a loop, which then gets medals', () => {
        const loop: SectionId[] = ['start', 'field', 'straight-20', 'right-tight', 'right-tight', 'straight-100', 'straight-20', 'straight-20', 'right-tight', 'right-tight']
        const gates: FieldTile[] = [{ col: 0, row: 2, kind: 'checkpoint', dir: 0 }, { col: 4, row: 3, kind: 'checkpoint', dir: 0 }]
        const t = trackOf(true, loop, [{ at: { branch: 0, at: 1 }, ...defaultFieldPlan(), tiles: gates }])
        const car = createCar(t, t.startS - 14)
        const timer = new LapTimer(t, car.x, car.y, car.z)
        let laps = 0
        for (let i = 0; i < PHYSICS_HZ * 120 && laps < 3; i++) {
            expect(stepCar(car, botInput(car, t), t, 1 / PHYSICS_HZ).fell).toBe(false)
            laps += timer.update(car.x, car.y, car.z, 1 / PHYSICS_HZ, crossesLines(car, t)).filter(e => e.type === 'lap').length
        }
        expect(laps).toBe(3)
        expect(medalTimes(t.def)).not.toBeNull()
    })
})
