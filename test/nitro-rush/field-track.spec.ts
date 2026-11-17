import { describe, expect, it } from 'vitest'
import { compileCustomTrack, type CustomTrack, type SectionId } from '#shared/utils/nitro-rush/custom'
import { defaultFieldPlan, type FieldPlan, type FieldPort, type FieldTile } from '#shared/utils/nitro-rush/field'
import { ghostDrivesTrack } from '#shared/utils/nitro-rush/drive-check'
import { GHOST_POSE, type Ghost } from '#shared/utils/nitro-rush/ghost'
import { newProjection, SPEED_CEILING, Track } from '#shared/utils/nitro-rush/track'
import type { CustomBranch } from '#shared/utils/nitro-rush/custom'
import { drive } from './bot-lap'

const ROAD: SectionId[] = ['straight-20', 'start', 'field', 'finish', 'straight-200']
/** A 100 m square entered at (0, -40) heading -z, so its hub is at (0, -90); it leaves through `exit`. */
const trackWith = (exit: FieldPort = { edge: 'exit', tile: 2 }, branches?: CustomBranch[]) => {
    const t: CustomTrack = { id: 'custom-test', name: 'Test', closed: false, sections: ROAD, fields: [{ at: { branch: 0, at: 2 }, ...defaultFieldPlan(), exit }] }
    if (branches) t.branches = branches
    const { def, error } = compileCustomTrack(t)
    expect(error).toBeNull()
    return new Track(def!)
}
const out = (edge: 'left' | 'right'): CustomBranch => ({ sections: ['finish', 'straight-200'], from: { branch: 0, at: 2, port: { edge, tile: 2 } }, to: null })

describe('field hubs', () => {
    it('measures a route straight across the field from mouth to mouth', () => {
        expect(trackWith().routes[0]!.length).toBeCloseTo(120)
        // 10 m to the entry, 50√2 corner to corner, 10 m on to the finish.
        expect(trackWith({ edge: 'right', tile: 2 }).routes[0]!.length).toBeCloseTo(20 + 50 * Math.SQRT2)
        // In and back out of the entry edge, 40 m apart.
        expect(trackWith({ edge: 'entry', tile: 4 }).routes[0]!.length).toBeCloseTo(60)
    })

    it('gives a route per way out, and the shortest lap the straightest of them', () => {
        const t = trackWith(undefined, [out('left'), out('right')])
        expect(t.routes.map(r => r.length)).toEqual([expect.closeTo(120), expect.closeTo(20 + 50 * Math.SQRT2), expect.closeTo(20 + 50 * Math.SQRT2)])
        expect(t.minLapSeconds * SPEED_CEILING).toBeCloseTo(20 + 50 * Math.SQRT2)
    })

    it('never prices a lap across a field longer than the straight line', () => {
        const t = trackWith({ edge: 'right', tile: 2 })
        expect(t.minLapSeconds * SPEED_CEILING).toBeLessThan(t.lapLength)
        expect(t.minLapSeconds * SPEED_CEILING).toBeCloseTo(t.routes[0]!.length)
    })
})

describe('the shortest lap across fields', () => {
    const big = (entry: number, exit: number, tiles: FieldTile[] = []): FieldPlan => ({ ...defaultFieldPlan(), width: 200, length: 200, entry, exit: { edge: 'exit', tile: exit }, tiles })
    const compile = (sections: SectionId[], plans: FieldPlan[]) => {
        const fields = plans.map((p, i) => ({ at: { branch: 0, at: 2 + i }, ...p }))
        const { def, error } = compileCustomTrack({ id: 'custom-test', name: 'Test', closed: false, sections, fields })
        expect(error).toBeNull()
        return new Track(def!)
    }

    it('cuts straight across two fields that meet edge to edge, not through the mouth between them', () => {
        // In at one corner of the first, out at the same side of the second: 10 m, 400 m straight on, 10 m.
        const t = compile(['straight-20', 'start', 'field', 'field', 'finish', 'straight-200'], [big(0, 9), big(9, 0)])
        expect(t.routes[0]!.length).toBeGreaterThan(500)
        expect(t.minLapSeconds * SPEED_CEILING).toBeCloseTo(420)
    })

    it('still needs a gate for each checkpoint past twelve, and passes an honest lap', () => {
        const gates: FieldTile[] = Array.from({ length: 13 }, (_, i) => ({ col: 1 + (i % 4) * 2, row: 1 + Math.floor(i / 4) * 2, kind: 'checkpoint', dir: 0 }))
        const t = compile(['straight-20', 'start', 'field', 'finish', 'straight-200'], [big(5, 5, gates)])
        expect(t.k).toBe(13)
        // The gates stand 40 m apart at the nearest, so touching 13 takes at least 12 such runs.
        expect(t.minLapSeconds * SPEED_CEILING).toBeGreaterThan(12 * 40)
        expect(ghostDrivesTrack(t, drive(t))).toBe(true)
    })
})

describe('locating a car on a field', () => {
    const t = trackWith({ edge: 'right', tile: 2 })
    const drive = (path: [number, number][]) => {
        const p = newProjection()
        return path.map(([x, z]) => {
            t.locate(x, z, p.branch, p.seg, p)
            return { field: p.field, branch: p.branch, s: p.s, progress: t.progressAt(p.branch, p.s) }
        })
    }

    it('comes onto the field through its entry and leaves through its exit', () => {
        const [road, on, middle, corner, off] = drive([[0, -38], [0, -42], [20, -60], [48, -90], [52, -90]])
        expect(road!.field).toBe(-1)
        expect([on!.field, middle!.field, corner!.field]).toEqual([0, 0, 0])
        expect(off).toMatchObject({ field: -1, branch: 0 })
        expect(off!.s).toBeGreaterThan(140)
    })

    it('keeps a car pushed past a wall on the field, and lets one back out of the entry', () => {
        const [, , past, back, out] = drive([[0, -38], [0, -42], [-52, -60], [0, -42], [0, -38]])
        expect(past!.field).toBe(0)
        expect(back!.field).toBe(0)
        expect(out).toMatchObject({ field: -1, branch: 0 })
        expect(out!.s).toBeLessThan(40)
    })

    it('blends progress across the field from entry to exit', () => {
        const steps = drive([[0, -38], [0, -42], [10, -55], [25, -70], [40, -85], [48, -90], [52, -90]]).map(p => p.progress)
        for (let i = 1; i < steps.length; i++) expect(steps[i]!).toBeGreaterThan(steps[i - 1]!)
    })

    it('leaves through a port onto the branch and comes back in off it', () => {
        const forked = trackWith(undefined, [out('left')])
        const p = newProjection()
        const at = (x: number, z: number) => forked.locate(x, z, p.branch, p.seg, p)
        at(0, -38)
        at(0, -42)
        at(-30, -90)
        expect(at(-48, -90).field).toBe(0)
        expect(at(-52, -90)).toMatchObject({ field: -1, branch: 1 })
        expect(at(-48, -90).field).toBe(0)
    })

    it('finds the field under a falling car, and from anywhere on it', () => {
        const p = newProjection()
        expect(t.landing(30, 5, -100, p)).toBe(true)
        expect(p.field).toBe(0)
        expect(t.nearest(-40, -120, newProjection()).field).toBe(0)
        expect(t.nearest(-40, -160, newProjection()).field).toBe(-1)
    })
})

describe('ghost check across a field', () => {
    const t = trackWith({ edge: 'right', tile: 2 })
    /** A ghost at 25 m/s along straight legs through `points`. */
    const ghostAlong = (points: [number, number][]): Ghost => {
        const hz = 30
        const step = 25 / hz
        const poses: number[] = []
        for (let i = 0; i + 1 < points.length; i++) {
            const [ax, az] = points[i]!
            const [bx, bz] = points[i + 1]!
            const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / step))
            for (let k = 0; k < n; k++) poses.push(ax + (bx - ax) * k / n, 0, az + (bz - az) * k / n, 0, 0, 0, 1)
        }
        const [x, z] = points[points.length - 1]!
        poses.push(x, 0, z, 0, 0, 0, 1)
        const data = Float32Array.from(poses)
        return { hz, end: (data.length / GHOST_POSE - 1) / hz, data }
    }

    it('passes a lap cut straight across the field', () => {
        expect(ghostDrivesTrack(t, ghostAlong([[0, -25], [0, -40], [50, -90], [61, -90]]))).toBe(true)
    })

    it('fails a lap that drives round the field outside its walls', () => {
        expect(ghostDrivesTrack(t, ghostAlong([[0, -25], [0, -38], [60, -38], [61, -90]]))).toBe(false)
    })
})
