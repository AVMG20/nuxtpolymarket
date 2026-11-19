import { describe, expect, it } from 'vitest'
import { compileCustomTrack, sanitizeCustomTrack, type CustomTrack, type SectionId } from '#shared/utils/nitro-rush/custom'
import { ghostDrivesTrack } from '#shared/utils/nitro-rush/drive-check'
import { defaultFieldPlan, FIELD_TILE, GATE_POST_RADIUS, gatePosts, isGate, PILLAR_RADIUS, type FieldTile } from '#shared/utils/nitro-rush/field'
import { routeCrossings, routeFieldPaths, type FieldPath } from '#shared/utils/nitro-rush/field-plan'
import { GHOST_POSE } from '#shared/utils/nitro-rush/ghost'
import { LapTimer } from '#shared/utils/nitro-rush/timing'
import { headingOf, Track } from '#shared/utils/nitro-rush/track'
import { findTrack } from '#shared/utils/nitro-rush/tracks'
import { fieldBotInput, fieldPathFor, heldPath, leaveField } from '../../app/utils/nitro-rush/bot-field'
import { PHYSICS_HZ } from '../../app/utils/nitro-rush/config'
import { botLapTime, medalTimes } from '../../app/utils/nitro-rush/medals'
import { botInput, createCar, crossesLines, gridCar, stepCar } from '../../app/utils/nitro-rush/physics'
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

const gate = (col: number, row: number, dir: 0 | 1 | 2 | 3 = 0): FieldTile => ({ col, row, kind: 'checkpoint', dir })
const block = (col: number, row: number): FieldTile => ({ col, row, kind: 'block' })
const pillar = (col: number, row: number): FieldTile => ({ col, row, kind: 'pillar' })

/** Joined 200 m fields, `tiles` on each in turn, entered at their middle and left by their far edge's. */
function joinedTrack(tiles: FieldTile[][], road: boolean) {
    const fields = tiles.map((t, i) => ({ at: { branch: 0, at: i + (road ? 3 : 0) }, width: 200, length: 200, entry: 4.5, exit: { edge: 'exit' as const, tile: 4.5 }, tiles: t }))
    const sections: SectionId[] = road ? ['straight-20', 'start', 'straight-100', ...fields.map((): SectionId => 'field'), 'straight-100', 'finish', 'straight-200'] : fields.map(() => 'field')
    const { def, error } = compileCustomTrack(sanitizeCustomTrack({ id: 'custom-test', name: 'Joined', closed: false, sections, fields })!)
    expect(error).toBeNull()
    return new Track(def!)
}

/** The bot's run from the grid to its finish: the lap time, or null if it misses a gate, falls or runs out of time; and its longest standstill in steps. */
function botRun(t: Track, seconds: number) {
    const car = gridCar(t)
    const timer = new LapTimer(t, car.x, car.y, car.z)
    let still = 0
    let longest = 0
    for (let i = 0; i < PHYSICS_HZ * seconds; i++) {
        if (stepCar(car, botInput(car, t), t, 1 / PHYSICS_HZ).fell) return { lap: null, longest }
        still = Math.abs(car.speed) < 1 ? still + 1 : 0
        longest = Math.max(longest, still)
        for (const e of timer.update(car.x, car.y, car.z, 1 / PHYSICS_HZ, crossesLines(car, t))) {
            if (e.type === 'missed') return { lap: null, longest }
            if (e.type === 'lap') return { lap: e.time, longest }
        }
    }
    return { lap: null, longest }
}

describe('the field planner', () => {
    it('crosses an empty field straight from mouth to mouth', () => {
        const t = fieldTrack()
        const crossings = routeCrossings(t.fields, t.routes[0]!)
        expect(crossings).toHaveLength(1)
        expect(crossings[0]!.into?.edge).toBe('entry')
        expect(crossings[0]!.out?.edge).toBe('exit')
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

    it('drives straight through a gate that faces back down the road', () => {
        const t = fieldTrack([{ col: 2, row: 3, kind: 'checkpoint', dir: 2 }])
        expect(ghostDrivesTrack(t, drive(t))).toBe(true)
    })

    it('drives an arena, joined fields and a field of pillars clean, through every gate', () => {
        const courses: CustomTrack[] = [
            { id: 'custom-test', name: 'Arena', closed: true, sections: ['field'], fields: [{ at: { branch: 0, at: 0 }, width: 200, length: 60, entry: 5, exit: { edge: 'exit', tile: 5 }, tiles: [gate(1, 1, 1), { col: 5, row: 1, kind: 'start', dir: 1 }, gate(8, 1, 1)] }] },
            sanitizeCustomTrack({
                id: 'custom-test',
                name: 'Joined',
                closed: false,
                sections: ['straight-20', 'start', 'straight-100', 'field', 'field', 'field', 'field', 'straight-100', 'finish', 'straight-200'],
                fields: [
                    { at: { branch: 0, at: 3 }, width: 200, length: 200, entry: 5, exit: { edge: 'exit', tile: 4 }, tiles: [gate(6, 6, 1)] },
                    { at: { branch: 0, at: 4 }, width: 200, length: 200, entry: 4, exit: { edge: 'right', tile: 4 }, tiles: [gate(2, 5), pillar(5, 5)] },
                    { at: { branch: 0, at: 5 }, width: 200, length: 200, entry: 5, exit: { edge: 'right', tile: 4 }, tiles: [] },
                    { at: { branch: 0, at: 6 }, width: 200, length: 200, entry: 5, exit: { edge: 'exit', tile: 5 }, tiles: [gate(7, 3, 1)] }
                ]
            }) as CustomTrack,
            {
                id: 'custom-test',
                name: 'Pillars',
                closed: false,
                sections: ['straight-20', 'start', 'straight-100', 'field', 'straight-100', 'finish', 'straight-200'],
                fields: [{ at: { branch: 0, at: 3 }, ...defaultFieldPlan(200, 200), tiles: [pillar(2, 2), pillar(5, 2), pillar(8, 3), pillar(3, 5), pillar(6, 5), pillar(1, 7), pillar(4, 8), pillar(7, 7), gate(8, 8, 1), { col: 1, row: 1, kind: 'checkpoint', dir: 3 }] }]
            }
        ]
        for (const course of courses) {
            const { def, error } = compileCustomTrack(course)
            expect(error).toBeNull()
            const t = new Track(def!)
            const car = gridCar(t)
            const timer = new LapTimer(t, car.x, car.y, car.z)
            const want = t.closed ? 2 : 1
            let laps = 0
            for (let i = 0; i < PHYSICS_HZ * 90 && laps < want; i++) {
                const ev = stepCar(car, botInput(car, t), t, 1 / PHYSICS_HZ)
                expect(ev.fell).toBe(false)
                expect(ev.wallImpact).toBe(0)
                const events = timer.update(car.x, car.y, car.z, 1 / PHYSICS_HZ, crossesLines(car, t))
                expect(events.some(e => e.type === 'missed')).toBe(false)
                laps += events.filter(e => e.type === 'lap').length
            }
            expect(laps).toBe(want)
        }
    })

    it('sets off from a start gate on a field and drives a road detour off it to the finish', () => {
        // Engines once split here: a line that wobbled under V8 but not JSC took twice as long.
        const { def, error } = compileCustomTrack(sanitizeCustomTrack({
            id: 'custom-test',
            name: 'Field start',
            closed: false,
            sections: ['field', 'field', 'field', 'field'],
            branches: [{ from: { branch: 0, at: 2, port: { edge: 'left', tile: 4.5 } }, to: { branch: 0, at: 2 }, sections: ['right-wide', 'straight-20', 'right-wide', 'checkpoint-required', 'right-wide'] }],
            fields: [
                { at: { branch: 0, at: 0 }, width: 200, length: 200, entry: 5, exit: { edge: 'exit', tile: 4 }, tiles: [] },
                { at: { branch: 0, at: 1 }, width: 200, length: 200, entry: 4, exit: { edge: 'right', tile: 4 }, tiles: [{ col: 1, row: 8, kind: 'start', dir: 1 }] },
                { at: { branch: 0, at: 2 }, width: 200, length: 200, entry: 5, exit: { edge: 'right', tile: 4 }, tiles: [] },
                { at: { branch: 0, at: 3 }, width: 200, length: 200, entry: 5, exit: { edge: 'exit', tile: 5 }, tiles: [{ col: 1, row: 8, kind: 'finish', dir: 0 }] }
            ]
        })!)
        expect(error).toBeNull()
        const t = new Track(def!)
        const startField = t.fields.findIndex(f => f.start)
        const car = gridCar(t)
        const timer = new LapTimer(t, car.x, car.y, car.z)
        let left = false
        let lap: number | null = null
        for (let i = 0; i < PHYSICS_HZ * 90 && lap === null; i++) {
            const ev = stepCar(car, botInput(car, t), t, 1 / PHYSICS_HZ)
            expect(ev.fell).toBe(false)
            expect(ev.wallImpact).toBe(0)
            if (car.proj.field !== startField) left = true
            const events = timer.update(car.x, car.y, car.z, 1 / PHYSICS_HZ, crossesLines(car, t))
            expect(events.some(e => e.type === 'missed')).toBe(false)
            lap = events.find(e => e.type === 'lap')?.time ?? null
        }
        expect(left).toBe(true)
        expect(lap).not.toBeNull()
        // A bot lost on its line runs far below a racing car's 30 m/s.
        expect(lap!).toBeLessThan(t.routes[0]!.length / 30)
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

    it('lays one even line over a long run of joined fields, which the bot laps', () => {
        const t = joinedTrack(Array.from({ length: 12 }, (_, i) => [gate(1 + (i % 3), 2, 1), gate(8, 7 - (i % 3), 3), pillar(5, 5), pillar(3, 7)]), true)
        const paths = routeFieldPaths(t.fields, t.routes[0]!)
        expect(paths).toHaveLength(1)
        const { points } = paths[0]!
        for (let i = 0; i + 2 < points.length; i++) {
            const [ax, az] = points[i]!
            const [bx, bz] = points[i + 1]!
            const [cx, cz] = points[i + 2]!
            // A gap this long cuts past what the line keeps clear of, and a turn past square folds the line back on itself.
            expect(Math.hypot(bx - ax, bz - az)).toBeLessThan(FIELD_TILE / 2)
            expect((bx - ax) * (cx - bx) + (bz - az) * (cz - bz)).toBeGreaterThan(0)
        }
        expect(botLapTime(t)).not.toBeNull()
    })

    it('crosses from one joined field to the next clear of a block by the seam, and finishes', () => {
        const t = joinedTrack([
            [{ col: 4, row: 6, kind: 'start', dir: 0 }, gate(9, 6, 2), { col: 8, row: 3, kind: 'boost', dir: 3 }],
            [block(4, 8)],
            [{ col: 6, row: 3, kind: 'finish', dir: 0 }, block(6, 0), block(5, 1)]
        ], false)
        const [path] = routeFieldPaths(t.fields, t.routes[0]!)
        expect(path).toBeDefined()
        let blocked = 0
        for (let i = 0; i + 1 < path!.points.length; i++) {
            const [ax, az] = path!.points[i]!
            const [bx, bz] = path!.points[i + 1]!
            for (let k = 0; k < 4; k++) {
                const x = ax + (bx - ax) * k / 4
                const z = az + (bz - az) * k / 4
                for (const f of t.fields) {
                    const p = f.local(x, z)
                    if (f.contains(p.u, p.v) && f.def.plan.tiles.some(b => b.kind === 'block' && onTile(p, b.col, b.row))) blocked++
                }
            }
        }
        expect(blocked).toBe(0)
        expect(botRun(t, 60).lap).not.toBeNull()
    })

    it('keeps a field\'s plan over its run-in on the road, and moves on to the next plan only once through it', () => {
        const t = fieldTrack([pillar(2, 2)])
        const path = pathOf(t)
        // The same field crossed a second time, as a loop through it twice would.
        const again: FieldPath = { ...path }
        const paths = [path, again]
        const car = gridCar(t)
        const put = (i: number) => {
            const [x, z] = path.points[i]!
            const [nx, nz] = path.points[i + 1]!
            car.x = x
            car.z = z
            car.travel = car.heading = headingOf(nx - x, nz - z)
            fieldBotInput(car, path, 1)
        }
        expect(fieldPathFor(car, paths, path.field)).toBe(path)
        // On the road short of the field, where the road's own line would otherwise take over.
        put(1)
        const field = t.fields[path.field]!
        const at = field.local(car.x, car.z)
        expect(field.contains(at.u, at.v)).toBe(false)
        expect(heldPath(car)).toBe(path)
        leaveField(car)
        expect(fieldPathFor(car, paths, path.field, true)).toBe(path)
        for (let i = 2; i + 1 < path.points.length; i++) put(i)
        leaveField(car)
        expect(fieldPathFor(car, paths, path.field, true)).toBe(again)
    })

    it('never turns straight back out of a gate past its post, and the bot drives on without getting wedged', () => {
        const t = joinedTrack([
            [{ col: 8, row: 5, kind: 'start', dir: 1 }, block(2, 3), block(3, 1), gate(7, 3, 1), gate(8, 4, 1), { col: 0, row: 1, kind: 'boost', dir: 2 }],
            [{ col: 1, row: 5, kind: 'finish', dir: 0 }, block(4, 1), pillar(2, 4), block(5, 3), pillar(2, 8)]
        ], false)
        const field = t.fields[0]!
        const posts = field.def.plan.tiles.flatMap(g => isGate(g.kind) && 'dir' in g ? gatePosts(g) : [])
        for (const p of samples(t, pathOf(t)).filter(p => field.contains(p.u, p.v))) {
            for (const [u, v] of posts) expect(Math.hypot(p.u - u, p.v - v)).toBeGreaterThan(GATE_POST_RADIUS + 2)
        }
        const run = botRun(t, 60)
        expect(run.lap).not.toBeNull()
        // Off the grid it never stands still for a second, as a car wedged on a post does.
        expect(run.longest).toBeLessThan(PHYSICS_HZ)
    })

    it('backs off a pillar it is wedged on rather than pushing at it for good', () => {
        // The plan of an empty field, driven where a pillar stands on it.
        const path = pathOf(fieldTrack())
        const walled = fieldTrack([pillar(2, 2)])
        const car = gridCar(walled)
        for (let i = 0; i < PHYSICS_HZ * 10 && car.proj.field < 0; i++) stepCar(car, { throttle: 1, brake: 0, steer: 0, drift: false }, walled, 1 / PHYSICS_HZ)
        let slowest = 0
        for (let i = 0; i < PHYSICS_HZ * 4; i++) {
            stepCar(car, fieldBotInput(car, path, 1), walled, 1 / PHYSICS_HZ)
            slowest = Math.min(slowest, car.speed)
        }
        expect(slowest).toBeLessThan(-1)
    })

    it('squeezes between pillars where they wall off every tile path, and the bot laps Field Obstacles clean', () => {
        // Its X of pillars leaves no tile path across, only the room between them.
        const t = new Track(findTrack('field-obstacles')!)
        const crossed = new Set(routeFieldPaths(t.fields, t.routes[0]!).flatMap(p => p.fields ?? [p.field]))
        expect(crossed.size).toBe(t.fields.length)
        const car = gridCar(t)
        const timer = new LapTimer(t, car.x, car.y, car.z)
        let rolling = false
        let lap: number | null = null
        for (let i = 0; i < PHYSICS_HZ * 60 && lap === null; i++) {
            const ev = stepCar(car, botInput(car, t), t, 1 / PHYSICS_HZ)
            expect(ev.fell).toBe(false)
            // A graze is no crash; running into a pillar at speed is.
            expect(ev.wallImpact).toBeLessThan(2)
            rolling ||= car.speed > 10
            // Once under way it never stops dead against anything.
            if (rolling) expect(car.speed).toBeGreaterThan(5)
            const events = timer.update(car.x, car.y, car.z, 1 / PHYSICS_HZ, crossesLines(car, t))
            expect(events.some(e => e.type === 'missed')).toBe(false)
            lap = events.find(e => e.type === 'lap')?.time ?? null
        }
        expect(lap).not.toBeNull()
    })

    it('passes the bot\'s ghost on Field Obstacles on every route, but not one that skips the road between its fields', () => {
        const t = new Track(findTrack('field-obstacles')!)
        for (const route of t.routes) expect(ghostDrivesTrack(t, drive(t, 0, route))).toBe(true)
        const ghost = drive(t, 0, t.routes[0]!)
        const n = ghost.data.length / GHOST_POSE
        const onField = (k: number) => t.fields.some((f) => {
            const { u, v } = f.local(ghost.data[k * GHOST_POSE]!, ghost.data[k * GHOST_POSE + 2]!)
            return f.contains(u, v)
        })
        let from = 0
        while (!onField(from)) from++
        while (onField(from)) from++
        const data = ghost.data.slice()
        for (let k = from; k < n; k++) data.set(ghost.data.subarray(Math.min(n - 1, k + 60) * GHOST_POSE, (Math.min(n - 1, k + 60) + 1) * GHOST_POSE), k * GHOST_POSE)
        expect(ghostDrivesTrack(t, { ...ghost, data })).toBe(false)
    })

    it('drives between the pillars of a row that spans the field', () => {
        const t = fieldTrack([0, 1, 2, 3, 4].map(c => pillar(c, 2)))
        const path = pathOf(t)
        const field = t.fields[0]!
        for (const p of samples(t, path).filter(p => field.contains(p.u, p.v))) {
            for (let c = 0; c < 5; c++) expect(Math.hypot(p.u - (c + 0.5) * FIELD_TILE, p.v - 2.5 * FIELD_TILE)).toBeGreaterThan(PILLAR_RADIUS + 1)
        }
        const run = botRun(t, 30)
        expect(run.lap).not.toBeNull()
        expect(run.longest).toBeLessThan(PHYSICS_HZ)
    })

    it('goes round pillars rather than squeeze past one into a run back toward the entry', () => {
        // Squeezing here meant overshooting the exit to line up square, or taking the gate the far way and turning back.
        const fields = [
            [pillar(1, 2), pillar(1, 3), block(2, 1), pillar(3, 0), pillar(3, 1), block(3, 2), pillar(3, 4)],
            [pillar(0, 0), pillar(0, 1), pillar(0, 2), block(1, 1), pillar(1, 2), pillar(1, 3), pillar(1, 4), pillar(2, 1), gate(3, 3, 1), pillar(4, 1)]
        ]
        for (const tiles of fields) {
            const t = fieldTrack(tiles)
            const field = t.fields[0]!
            let furthest = -Infinity
            for (const [x, z] of pathOf(t).points) {
                const { v } = field.local(x, z)
                furthest = Math.max(furthest, v)
                expect(v).toBeGreaterThan(furthest - 1)
            }
        }
    })
})
