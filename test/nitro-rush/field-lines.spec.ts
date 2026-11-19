import { describe, expect, it, vi } from 'vitest'
import { compileCustomTrack, NO_GRID_ROOM, sanitizeCustomTrack, type CustomTrack, type SectionId } from '#shared/utils/nitro-rush/custom'
import type { CustomField } from '#shared/utils/nitro-rush/custom-fields'
import { ghostDrivesTrack } from '#shared/utils/nitro-rush/drive-check'
import { routeCrossings } from '#shared/utils/nitro-rush/field-plan'
import { entryLocked, fieldLinesOff, fieldPlanAt, growField, setFieldEntry, setFieldExit, turnPlan, useFieldTool, type FieldEdit } from '#shared/utils/nitro-rush/field-edit'
import { defaultFieldPlan, dirHeading, FIELD_EDGES, FIELD_TILE, fieldPoint, placeField, portPose, type FieldPlan, type FieldTile } from '#shared/utils/nitro-rush/field'
import { LapTimer, type LapEvent } from '#shared/utils/nitro-rush/timing'
import { SPEED_CEILING, Track } from '#shared/utils/nitro-rush/track'
import { PHYSICS_HZ } from '../../app/utils/nitro-rush/config'
import { gridCar } from '../../app/utils/nitro-rush/physics'
import { drive, RECTANGLE } from './bot-lap'

/** Fields with a start or finish gate on them: placing one, laying and timing it, and moving a field's way in. */

const SPRINT: SectionId[] = ['straight-20', 'start', 'straight-20', 'field', 'straight-100', 'finish', 'straight-200']
const SPOT = { branch: 0, at: 3 }
const course = (extra: Partial<CustomTrack> = {}): CustomTrack => ({ id: 'custom-test', name: 'Test', closed: false, sections: SPRINT, ...extra })
const field = (tiles: FieldTile[], at = SPOT, plan: Partial<FieldPlan> = {}): CustomField => ({ at, ...defaultFieldPlan(), ...plan, tiles })
const done = (e: FieldEdit) => {
    expect(e.error).toBeNull()
    return e.track!
}
const built = (t: CustomTrack) => {
    const { def, error } = compileCustomTrack(t)
    expect(error).toBeNull()
    return new Track(def!)
}
/** A loop round the rectangle whose start block and first 20 m are a 100 m field instead. */
const LOOP: SectionId[] = ['field', 'straight-20', ...RECTANGLE.slice(2)]
const loopWith = (tiles: FieldTile[]) => course({ closed: true, sections: LOOP, fields: [field(tiles, { branch: 0, at: 0 })] })

describe('placing a start or finish on a field', () => {
    it('moves the start off the road block and off any other field', () => {
        const two = course({ sections: ['straight-20', 'start', 'field', 'straight-20', 'field', 'straight-100', 'finish', 'straight-200'] })
        const first = done(useFieldTool(two, { branch: 0, at: 2 }, 2, 2, 'start'))
        expect(first.sections).not.toContain('start')
        expect(first.sections[1]).toBe('straight-20')
        expect(fieldPlanAt(first, { branch: 0, at: 2 }).tiles).toEqual([{ col: 2, row: 2, kind: 'start', dir: 0 }])
        const moved = done(useFieldTool(first, { branch: 0, at: 4 }, 1, 3, 'start'))
        expect(fieldPlanAt(moved, { branch: 0, at: 2 }).tiles).toEqual([])
        expect(fieldPlanAt(moved, { branch: 0, at: 4 }).tiles).toEqual([{ col: 1, row: 3, kind: 'start', dir: 0 }])
        // A start block laid again takes it back off the field.
        expect(fieldLinesOff(moved, 'start').fields!.every(f => !f.tiles.length)).toBe(true)
    })

    it('moves the finish the same way and turns it between along and across', () => {
        const t = done(useFieldTool(course(), SPOT, 2, 2, 'finish'))
        expect(t.sections).not.toContain('finish')
        let at = t
        for (const dir of [1, 0, 1, 0]) {
            at = done(useFieldTool(at, SPOT, 2, 2, 'finish'))
            expect(fieldPlanAt(at, SPOT).tiles[0]).toMatchObject({ kind: 'finish', dir })
        }
    })

    it('moves a line to another tile of its own field, and turns it where it stands', () => {
        const lines = (t: CustomTrack) => fieldPlanAt(t, SPOT).tiles.filter(k => k.kind === 'start' || k.kind === 'finish')
        let t = done(useFieldTool(course(), SPOT, 2, 1, 'start'))
        t = done(useFieldTool(t, SPOT, 2, 4, 'finish'))
        expect(lines(t)).toEqual([{ col: 2, row: 1, kind: 'start', dir: 0 }, { col: 2, row: 4, kind: 'finish', dir: 0 }])
        t = done(useFieldTool(t, SPOT, 1, 2, 'start'))
        t = done(useFieldTool(t, SPOT, 3, 3, 'finish'))
        expect(lines(t)).toEqual([{ col: 1, row: 2, kind: 'start', dir: 0 }, { col: 3, row: 3, kind: 'finish', dir: 0 }])
        t = done(useFieldTool(t, SPOT, 1, 2, 'start'))
        expect(lines(t)).toEqual([{ col: 1, row: 2, kind: 'start', dir: 1 }, { col: 3, row: 3, kind: 'finish', dir: 0 }])
        expect(t.sections.filter(id => id === 'start' || id === 'finish')).toEqual([])
        expect(t.fields).toHaveLength(1)
        // One line never takes the other's tile.
        expect(useFieldTool(t, SPOT, 1, 2, 'finish').error).toBe('the start is on that tile')
    })

    it('puts the finish on the part of a joined field the road crosses last', () => {
        const grown = done(growField(course(), SPOT, 'exit'))
        const later = { branch: 0, at: 4 }
        const started = done(useFieldTool(grown, SPOT, 2, 1, 'start'))
        expect(useFieldTool(started, SPOT, 2, 4, 'finish').error).toBe('put the finish where the road leaves the field')
        const t = built(done(useFieldTool(started, later, 2, 3, 'finish')))
        expect(t.lapLines.filter(l => l.kind !== 'checkpoint').map(l => [l.kind, l.field])).toEqual([['start', 0], ['finish', 1]])
        expect(ghostDrivesTrack(t, drive(t))).toBe(true)
    })

    it('keeps the finish after the start along the main road', () => {
        const two = course({ sections: ['straight-20', 'start', 'field', 'straight-20', 'field', 'straight-100', 'straight-20'] })
        const finished = done(useFieldTool(two, { branch: 0, at: 2 }, 2, 2, 'finish'))
        expect(useFieldTool(finished, { branch: 0, at: 4 }, 2, 2, 'start').error).toBe('the finish must come after the start')
        const started = done(useFieldTool(two, { branch: 0, at: 4 }, 2, 2, 'start'))
        expect(useFieldTool(started, { branch: 0, at: 2 }, 2, 2, 'finish').error).toBe('the finish must come after the start')
    })

    it('has no finish on a loop and keeps both off a branch\'s fields', () => {
        expect(useFieldTool(loopWith([]), { branch: 0, at: 0 }, 2, 2, 'finish').error).toBe('a loop has no finish')
        const branched = course({
            sections: ['straight-20', 'start', 'straight-20', 'field', 'straight-100', 'finish', 'straight-200'],
            branches: [{ sections: ['straight-20', 'field', 'straight-20'], from: { branch: 0, at: 3, port: { edge: 'left', tile: 2 } }, to: null }],
            fields: [field([], SPOT), field([], { branch: 1, at: 1 })]
        })
        expect(useFieldTool(branched, { branch: 1, at: 1 }, 2, 2, 'start').error).toBe('the start must be on a main-road field')
    })
})

describe('a course with its start or finish on a field', () => {
    it('lays a sprint from a field start, and the bot\'s run passes the ghost check', () => {
        const t = built(course({ sections: ['straight-20', 'straight-20', 'straight-20', 'field', 'straight-100', 'finish', 'straight-200'], fields: [field([{ col: 2, row: 2, kind: 'start', dir: 0 }])] }))
        const [start] = t.lapLines
        expect(start).toMatchObject({ kind: 'start', field: 0, branch: 0, s: t.startS })
        expect(t.lapLines.filter(l => l.kind === 'start')).toHaveLength(1)
        expect(t.minLapSeconds).toBeGreaterThan(0)
        expect(ghostDrivesTrack(t, drive(t))).toBe(true)
    })

    it('lays a sprint to a field finish', () => {
        const t = built(course({ sections: ['straight-20', 'start', 'straight-100', 'field', 'straight-100', 'straight-20'], fields: [field([{ col: 2, row: 2, kind: 'finish', dir: 0 }])] }))
        expect(t.lapLines.find(l => l.kind === 'finish')).toMatchObject({ field: 0, s: t.finishS })
        expect(ghostDrivesTrack(t, drive(t))).toBe(true)
    })

    it('lays a loop from a field start, its laps timed from the gate', () => {
        const t = built(loopWith([{ col: 2, row: 2, kind: 'start', dir: 0 }, { col: 4, row: 1, kind: 'checkpoint', dir: 0 }]))
        expect(t.lapLines[0]).toMatchObject({ kind: 'start', field: 0, s: 0 })
        expect(t.k).toBe(1)
        expect(ghostDrivesTrack(t, drive(t))).toBe(true)
        expect(ghostDrivesTrack(t, drive(t, 1))).toBe(true)
    })

    it('lays a sprint from a start to a finish on one field, through its gates', () => {
        const tiles: FieldTile[] = [{ col: 2, row: 1, kind: 'start', dir: 0 }, { col: 0, row: 2, kind: 'checkpoint', dir: 0 }, { col: 2, row: 3, kind: 'block' }, { col: 3, row: 4, kind: 'finish', dir: 0 }]
        const t = built(course({ sections: ['straight-20', 'straight-20', 'straight-20', 'field', 'straight-100', 'straight-20'], fields: [field(tiles)] }))
        expect(t.lapLines.filter(l => l.field === 0).map(l => l.kind).sort()).toEqual(['checkpoint', 'finish', 'start'])
        expect(t.startS).toBeLessThan(t.finishS)
        expect(t.k).toBe(1)
        expect(routeCrossings(t.fields, t.routes[0]!)).toMatchObject([{ into: null, out: null }])
        expect(t.minLapSeconds).toBeGreaterThan(0)
        expect(ghostDrivesTrack(t, drive(t))).toBe(true)
    })

    it('refuses a start or finish laid on a branch\'s field', () => {
        const raw = course({
            branches: [{ sections: ['straight-20', 'field', 'straight-20'], from: { branch: 0, at: 3, port: { edge: 'left', tile: 2 } }, to: null }],
            fields: [field([], SPOT), field([{ col: 2, row: 2, kind: 'finish', dir: 0 }], { branch: 1, at: 1 })]
        })
        expect(compileCustomTrack(raw).error).not.toBeNull()
    })
})

describe('timing a field start', () => {
    const t = built(loopWith([{ col: 2, row: 2, kind: 'start', dir: 0 }]))
    const start = t.lapLines[0]!
    /** Steps a timer straight through the start gate, `way` 1 along it and -1 back. */
    const through = (timer: LapTimer, way: 1 | -1) => {
        const events = []
        for (let d = -10; d <= 10; d++) {
            const along = d * way
            events.push(...timer.update(start.x + start.tx * along, start.y, start.z + start.tz * along, 1 / PHYSICS_HZ))
        }
        return events
    }

    it('ends no lap over the line either way before the car leaves its field', () => {
        const timer = new LapTimer(t, start.x - start.tx * 10, start.y, start.z - start.tz * 10, false)
        expect(through(timer, -1)).toEqual([])
        expect(through(timer, 1)).toEqual([])
    })

    /** Drives the main road from `from` to `to` metres, either way, 40 m/s in physics steps. */
    const drive = (timer: LapTimer, from: number, to: number) => {
        const step = 40 / PHYSICS_HZ * Math.sign(to - from)
        for (let i = 1; i <= Math.floor((to - from) / step); i++) {
            const p = t.pointAt(t.wrapS(from + step * i))
            timer.update(p.x, p.y, p.z, 1 / PHYSICS_HZ)
        }
    }

    it('won\'t end a lap for circling the gate, nor for driving out and back, only for going round', () => {
        const timer = new LapTimer(t, start.x - start.tx * 10, start.y, start.z - start.tz * 10, false)
        expect(through(timer, 1).some(e => e.type === 'lap')).toBe(false)
        expect(through(timer, 1).some(e => e.type === 'lap')).toBe(false)
        // Out past the far side of the course and back the way it went is no lap.
        drive(timer, 60, t.length * 0.7)
        drive(timer, t.length * 0.7, 60)
        expect(through(timer, -1).some(e => e.type === 'lap')).toBe(false)
        drive(timer, 60, t.length - 60)
        expect(through(timer, 1).some(e => e.type === 'lap')).toBe(true)
    })
})

describe('going round a loop that starts on a field', () => {
    const t = built(loopWith([{ col: 2, row: 2, kind: 'start', dir: 0 }]))
    const f = t.fields[0]!
    /** The road off the field, from just past its way out to just short of its way in. */
    const road: [number, number][] = []
    for (let s = 52; s <= t.length - 52; s += 2) road.push([t.pointAt(s).x, t.pointAt(s).z])
    /** Drives a car from the grid through each of `points` in turn, 36 m/s in physics steps. */
    const run = (track: Track, points: [number, number][]) => {
        const car = gridCar(track)
        const timer = new LapTimer(track, car.x, car.y, car.z)
        const events: LapEvent[] = []
        let [x, z] = [car.x, car.z]
        for (const [tx, tz] of points) {
            const n = Math.ceil(Math.hypot(tx - x, tz - z) / 0.3)
            const [x0, z0] = [x, z]
            for (let i = 1; i <= n; i++) {
                x = x0 + (tx - x0) * i / n
                z = z0 + (tz - z0) * i / n
                events.push(...timer.update(x, track.fields[0]!.y, z, 1 / PHYSICS_HZ))
            }
        }
        return events
    }
    const laps = (events: LapEvent[]) => events.filter(e => e.type === 'lap').length

    it('ends no lap for poking out of the field and coming back over the gate', () => {
        const gated = built(loopWith([{ col: 2, row: 2, kind: 'start', dir: 0 }, { col: 2, row: 3, kind: 'checkpoint', dir: 0 }]))
        const g = gated.fields[0]!
        expect(laps(run(gated, [g.world(50, 60), g.world(50, 80), g.world(50, 108), g.world(50, 60), g.world(50, 40)]))).toBe(0)
    })

    it('ends no lap for driving most of the way round and turning back', () => {
        expect(laps(run(t, [f.world(50, 60), f.world(50, 99), ...road.slice(0, -10), ...road.slice(0, -10).reverse(), f.world(50, 99), f.world(50, 40)]))).toBe(0)
    })

    it('ends a lap for going round, either way', () => {
        expect(laps(run(t, [f.world(50, 60), f.world(50, 99), ...road, f.world(50, 1), f.world(50, 60)]))).toBe(1)
        expect(laps(run(t, [f.world(50, 30), f.world(50, 1), ...[...road].reverse(), f.world(50, 99), f.world(50, 40)]))).toBe(1)
    })

    it('won\'t accept a lap much shorter than the way round', () => {
        expect(t.minLapSeconds * SPEED_CEILING).toBeGreaterThan(t.length / 2)
    })

    it('follows the car along the road instead of searching the whole course each step', () => {
        const nearest = vi.spyOn(t, 'nearest')
        run(t, [f.world(50, 60), f.world(50, 99), ...road, f.world(50, 1), f.world(50, 60)])
        // Once as it leaves the field, not once a step.
        expect(nearest.mock.calls.length).toBeLessThan(5)
        nearest.mockRestore()
    })
})

describe('the grid on a field start', () => {
    it('sits behind the gate, facing through it, on the field', () => {
        const t = built(loopWith([{ col: 2, row: 2, kind: 'start', dir: 1 }]))
        const start = t.lapLines[0]!
        const car = gridCar(t)
        expect((start.x - car.x) * start.tx + (start.z - car.z) * start.tz).toBeCloseTo(14)
        expect(Math.abs((car.x - start.x) * -start.tz + (car.z - start.z) * start.tx)).toBeLessThan(1e-6)
        expect(-Math.sin(car.heading) * start.tx - Math.cos(car.heading) * start.tz).toBeCloseTo(1)
        expect(car.proj.field).toBe(0)
        expect(car.y).toBe(start.y)
    })

    it('turns a start that would have its grid off the field to face a way it fits, and won\'t lay one facing in off an edge', () => {
        const spot = { branch: 0, at: 0 }
        for (const [col, row, facing] of [[0, 0, 0], [4, 4, 2]] as const) {
            const placed = done(useFieldTool(loopWith([]), spot, col, row, 'start', true, facing))
            expect(fieldPlanAt(placed, spot).tiles[0]).not.toMatchObject({ dir: facing })
            expect(gridCar(built(placed)).proj.field).toBe(0)
        }
        expect(compileCustomTrack(loopWith([{ col: 0, row: 0, kind: 'start', dir: 0 }])).error).toBe(NO_GRID_ROOM)
    })
})

describe('moving a field\'s way in', () => {
    const plan: FieldPlan = {
        ...defaultFieldPlan(100, 60),
        entry: 1,
        exit: { edge: 'exit', tile: 3 },
        tiles: [{ col: 0, row: 1, kind: 'boost', dir: 1 }, { col: 3, row: 0, kind: 'checkpoint', dir: 1 }, { col: 4, row: 2, kind: 'start', dir: 2 }, { col: 2, row: 1, kind: 'pillar' }]
    }

    it('turns the plan so every tile, its way and the exit stay where they were', () => {
        const pose = { x: 12, z: -40, heading: 0.3 }
        const before = placeField(plan, pose)
        const world = (p: ReturnType<typeof placeField>, k: FieldTile) => fieldPoint(p, (k.col + 0.5) * FIELD_TILE, (k.row + 0.5) * FIELD_TILE)
        for (const edge of FIELD_EDGES) {
            const way = { edge, tile: 1 }
            const turned = turnPlan(plan, edge)
            const into = portPose(before, way)
            const after = placeField({ ...turned.plan, entry: turned.port(way).tile }, { ...into, heading: into.heading + Math.PI })
            expect(turned.port(way).edge).toBe('entry')
            expect(after.plan.width * after.plan.length).toBe(plan.width * plan.length)
            plan.tiles.forEach((k, i) => {
                const moved = turned.plan.tiles.find(m => m.kind === k.kind && Math.hypot(world(after, m)[0] - world(before, k)[0], world(after, m)[1] - world(before, k)[1]) < 1e-6)
                expect(moved, `${edge} tile ${i}`).toBeDefined()
                if (!('dir' in k) || !moved || !('dir' in moved)) return
                const turn = dirHeading(after.heading, moved.dir) - dirHeading(before.heading, k.dir)
                expect(Math.abs(Math.sin(turn))).toBeLessThan(1e-9)
                // A checkpoint is the same gate turned half round; anything else points the same way.
                if (k.kind !== 'checkpoint') expect(Math.cos(turn)).toBeCloseTo(1)
            })
            const exitBefore = portPose(before, plan.exit)
            const exitAfter = portPose(after, turned.plan.exit)
            expect(Math.hypot(exitBefore.x - exitAfter.x, exitBefore.z - exitAfter.z)).toBeLessThan(1e-6)
        }
    })

    it('moves the way in along its edge, or turns the plan for another edge with the branch ports', () => {
        const t = course({
            fields: [field([{ col: 4, row: 4, kind: 'boost', dir: 0 }])],
            branches: [{ sections: ['straight-20'], from: { branch: 0, at: 3, port: { edge: 'right', tile: 1 } }, to: null }]
        })
        expect(fieldPlanAt(done(setFieldEntry(t, SPOT, { edge: 'entry', tile: 0 })), SPOT).entry).toBe(0)
        const left = done(setFieldEntry(t, SPOT, { edge: 'left', tile: 3 }))
        const next = fieldPlanAt(left, SPOT)
        expect(next.entry).toBe(1)
        expect(next.exit).toEqual({ edge: 'left', tile: 2 })
        expect(next.tiles).toEqual([{ col: 0, row: 4, kind: 'boost', dir: 3 }])
        expect(left.branches![0]!.from.port).toEqual({ edge: 'exit', tile: 3 })
        expect(compileCustomTrack(done(setFieldEntry(course({ fields: [field([])] }), SPOT, { edge: 'left', tile: 2 }))).error).toBeNull()
    })

    it('keeps the way in off the exit and every other road', () => {
        const t = course({ fields: [field([])], branches: [{ sections: ['straight-20'], from: { branch: 0, at: 3, port: { edge: 'entry', tile: 4 } }, to: null }] })
        expect(setFieldEntry(t, SPOT, { edge: 'exit', tile: 2 }).error).toBe('a road is already there')
        expect(setFieldEntry(t, SPOT, { edge: 'entry', tile: 4 }).error).toBe('a road is already there')
        expect(setFieldEntry(t, SPOT, { edge: 'entry', tile: 3 }).error).toBe('leave a tile between roads')
        expect(setFieldExit(t, SPOT, { edge: 'entry', tile: 2 }).error).not.toBeNull()
    })

    it('won\'t move the way in of a field entered from the field before it', () => {
        const grown = done(growField(course({ fields: [field([])] }), SPOT, 'exit'))
        const second = { branch: 0, at: SPOT.at + 1 }
        expect(entryLocked(grown, second)).toBe('the field before it sets its way in')
        expect(setFieldEntry(grown, second, { edge: 'left', tile: 1 }).error).toBe('the field before it sets its way in')
        expect(entryLocked(grown, SPOT)).toBeNull()
    })
})

describe('a stored field with a start or finish', () => {
    it('reads back with its gates, but never two of one line on a field', () => {
        const raw = course({ sections: ['straight-20', 'straight-20', 'straight-20', 'field', 'straight-100', 'finish', 'straight-200'], fields: [field([{ col: 2, row: 2, kind: 'start', dir: 3 }])] })
        expect(sanitizeCustomTrack(raw)?.fields?.[0]?.tiles).toEqual([{ col: 2, row: 2, kind: 'start', dir: 3 }])
        const both = field([{ col: 1, row: 1, kind: 'finish', dir: 0 }, { col: 2, row: 2, kind: 'start', dir: 0 }])
        expect(sanitizeCustomTrack({ ...raw, fields: [both] })?.fields?.[0]?.tiles).toEqual(both.tiles)
        const twice = { ...raw, fields: [field([{ col: 2, row: 2, kind: 'start', dir: 0 }, { col: 1, row: 1, kind: 'start', dir: 0 }])] }
        expect(sanitizeCustomTrack(twice)).toBeNull()
        const noWay = { ...raw, fields: [{ ...field([]), tiles: [{ col: 2, row: 2, kind: 'finish' }] }] }
        expect(sanitizeCustomTrack(noWay)).toBeNull()
    })
})
