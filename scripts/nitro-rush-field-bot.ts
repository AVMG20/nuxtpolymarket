/**
 * How close the demo bot drives fields to what the car can do: per course, its time on the fields (a flying lap on an arena),
 * its wall hits, and the time a perfect driver would take along the planned line with full grip and braking.
 * Medal times come from the bot driving in the player's browser, so every course runs under Node (V8, as in Chrome) and
 * Bun (JavaScriptCore, as in Safari): the table is V8's, with JSC's lap beside it, and the two must agree.
 * Extra courses are published track JSON files; `--seeds` adds random courses. The road courses at the end give the road
 * bot's gap to the same estimate, for comparison.
 *
 *   bun scripts/nitro-rush-field-bot.ts [course.json ...] [--seeds 1,7]
 */
import { execFile, execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
    AERO_DRAG, BOOST_DURATION, BOOST_KICK, BRAKE_DECEL, ENGINE_ACCEL, ENGINE_TOP_SPEED, GRIP_LATERAL, MAX_STEER_ANGLE, NITRO_ACCEL, NITRO_TOP_SPEED_MULT,
    PHYSICS_HZ, ROLLING_DRAG, STEER_FALLOFF_SPEED, WHEELBASE
} from '../app/utils/nitro-rush/config'
import { botLapTime } from '../app/utils/nitro-rush/medals'
import { botInput, crossesLines, gridCar, stepCar } from '../app/utils/nitro-rush/physics'
import { createSeededRandom, type SeededRandom } from '../shared/utils/random'
import { compileCustomTrack, sanitizeCustomTrack, type CustomTrack, type SectionId } from '../shared/utils/nitro-rush/custom'
import type { CustomField } from '../shared/utils/nitro-rush/custom-fields'
import { defaultFieldPlan, type FieldDir, type FieldTile } from '../shared/utils/nitro-rush/field'
import { routeFieldPaths, type FieldPath } from '../shared/utils/nitro-rush/field-plan'
import { buildTrack } from '../shared/utils/nitro-rush/layout'
import { LapTimer } from '../shared/utils/nitro-rush/timing'
import { Track, type Route } from '../shared/utils/nitro-rush/track'
import { FIELD_OBSTACLES, TRACKS } from '../shared/utils/nitro-rush/tracks'

const DT = 1 / PHYSICS_HZ
const ROAD: SectionId[] = ['straight-20', 'start', 'straight-100', 'field', 'straight-100', 'finish', 'straight-200']

const gate = (col: number, row: number, dir: 0 | 1 | 2 | 3 = 0): FieldTile => ({ col, row, kind: 'checkpoint', dir })
const block = (col: number, row: number): FieldTile => ({ col, row, kind: 'block' })
const pillar = (col: number, row: number): FieldTile => ({ col, row, kind: 'pillar' })
const pad = (col: number, row: number, dir: 0 | 1 | 2 | 3 = 0): FieldTile => ({ col, row, kind: 'boost', dir })

/** A sprint down the road across one field of `size` with `tiles` on it. */
function crossing(size: [number, number], tiles: FieldTile[]): CustomTrack {
    return { id: 'custom-bot', name: 'Fields', closed: false, sections: ROAD, fields: [{ at: { branch: 0, at: 3 }, ...defaultFieldPlan(...size), tiles }] }
}

/** Four 200 m fields round a 400 m square, each leaving by its right edge into the next: one arena. */
function square(tiles: FieldTile[][]): CustomTrack {
    const fields: CustomField[] = tiles.map((t, i) => ({ at: { branch: 0, at: i }, width: 200, length: 200, entry: 4.5, exit: { edge: 'right', tile: 4.5 }, tiles: t }))
    return sanitizeCustomTrack({ id: 'custom-bot', name: 'Square', closed: true, sections: ['field', 'field', 'field', 'field'], fields }) as CustomTrack
}

/** A sprint across four joined 200 m fields, entering the first and leaving the last. */
const JOINED: CustomTrack = sanitizeCustomTrack({
    id: 'custom-bot',
    name: 'Joined',
    closed: false,
    sections: ['straight-20', 'start', 'straight-100', 'field', 'field', 'field', 'field', 'straight-100', 'finish', 'straight-200'],
    fields: [
        { at: { branch: 0, at: 3 }, width: 200, length: 200, entry: 5, exit: { edge: 'exit', tile: 4 }, tiles: [gate(6, 6, 1)] },
        { at: { branch: 0, at: 4 }, width: 200, length: 200, entry: 4, exit: { edge: 'right', tile: 4 }, tiles: [gate(2, 5), pillar(5, 5)] },
        { at: { branch: 0, at: 5 }, width: 200, length: 200, entry: 5, exit: { edge: 'right', tile: 4 }, tiles: [] },
        { at: { branch: 0, at: 6 }, width: 200, length: 200, entry: 5, exit: { edge: 'exit', tile: 5 }, tiles: [gate(7, 3, 1)] }
    ]
}) as CustomTrack

/** Four joined fields with no road start: the grid sits on the second's start gate, a branch loops off the third through a required checkpoint. */
const FIELD_START: CustomTrack = sanitizeCustomTrack({
    id: 'custom-bot',
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
}) as CustomTrack

const SAMPLES: { name: string, track: CustomTrack }[] = [
    { name: 'empty 100x100', track: crossing([100, 100], []) },
    { name: 'empty 20x20', track: crossing([20, 20], []) },
    { name: 'zigzag gates', track: crossing([100, 100], [gate(0, 1), gate(4, 3)]) },
    { name: 'gate crossed back', track: crossing([100, 100], [gate(2, 3, 2)]) },
    { name: 'wall with a gap', track: crossing([100, 100], [1, 2, 3, 4].map(c => block(c, 2))) },
    { name: 'pillar slalom', track: crossing([100, 200], [pillar(2, 2), pillar(1, 4), pillar(3, 6), pillar(2, 8)]) },
    { name: 'pillar forest', track: crossing([200, 200], [pillar(2, 2), pillar(5, 2), pillar(8, 3), pillar(3, 5), pillar(6, 5), pillar(1, 7), pillar(4, 8), pillar(7, 7), gate(8, 8, 1), gate(1, 1, 3)]) },
    { name: 'pads and gates', track: crossing([200, 200], [pad(5, 0), gate(1, 3, 3), gate(8, 6, 1), gate(4, 8), pad(4, 5)]) },
    { name: 'six gates, maze', track: crossing([200, 200], [gate(0, 2), gate(9, 2), gate(0, 6), gate(9, 6), gate(3, 8, 1), gate(6, 3, 2), ...[2, 3, 4, 5, 6, 7].map(c => block(c, 5))]) },
    { name: 'arena 200x60', track: { id: 'custom-bot', name: 'Arena', closed: true, sections: ['field'], fields: [{ at: { branch: 0, at: 0 }, width: 200, length: 60, entry: 5, exit: { edge: 'exit', tile: 5 }, tiles: [gate(1, 1, 1), { col: 5, row: 1, kind: 'start', dir: 1 }, gate(8, 1, 1)] }] } },
    { name: 'square 400x400', track: square([[{ col: 4, row: 4, kind: 'start', dir: 0 }], [gate(2, 7, 1)], [gate(5, 5), pillar(7, 2)], [gate(1, 1, 1), block(4, 4), block(5, 4)]]) },
    { name: 'joined sprint', track: JOINED },
    { name: 'field start, detour', track: FIELD_START }
]

const SIZES = [60, 80, 100, 120, 140, 160, 180, 200]

/** Up to `count` random checkpoints, pads, blocks and pillars on a `cols` x `rows` field, one per tile and off `taken`. */
function randomTiles(rng: SeededRandom, cols: number, rows: number, count: number, taken: FieldTile[] = []): FieldTile[] {
    const out = [...taken]
    for (let k = 0; k < count; k++) {
        const col = rng.randomInt(0, cols - 1)
        const row = rng.randomInt(0, rows - 1)
        if (out.some(t => t.col === col && t.row === row)) continue
        const dir = rng.randomInt(0, 3) as FieldDir
        out.push(rng.randomPick<FieldTile>([{ col, row, kind: 'checkpoint', dir }, { col, row, kind: 'boost', dir }, { col, row, kind: 'pillar' }, { col, row, kind: 'block' }]))
    }
    return out
}

/** A random course: a road sprint across one field, or two or three joined fields with the start gate on the first and the finish on the last. */
function randomCourse(rng: SeededRandom): CustomTrack {
    if (rng.randomChance(0.5)) {
        const [width, length] = [rng.randomPick(SIZES), rng.randomPick(SIZES)]
        return crossing([width, length], randomTiles(rng, width / 20, length / 20, rng.randomInt(1, 8)))
    }
    const n = rng.randomInt(2, 3)
    const fields: CustomField[] = Array.from({ length: n }, (_, i) => {
        const tiles: FieldTile[] = []
        if (i === 0) tiles.push({ col: rng.randomInt(1, 8), row: rng.randomInt(1, 6), kind: 'start', dir: rng.randomPick<FieldDir>([0, 1, 3]) })
        if (i === n - 1) tiles.push({ col: rng.randomInt(1, 8), row: rng.randomInt(1, 5), kind: 'finish', dir: 0 })
        return { at: { branch: 0, at: i }, ...defaultFieldPlan(200, 200), tiles: randomTiles(rng, 10, 10, rng.randomInt(0, 5), tiles) }
    })
    return { id: 'custom-bot', name: 'Random', closed: false, sections: fields.map(() => 'field'), fields }
}

/** The next random course that compiles. */
function nextCourse(rng: SeededRandom): CustomTrack {
    for (;;) {
        const course = randomCourse(rng)
        if (compileCustomTrack(course).def) return course
    }
}

interface Run {
    /** Seconds on fields, or the flying lap on an arena. */
    time: number
    /** The lap the medals are set from: a sprint's run, a loop's first flying lap. */
    lap: number
    /** Speed driving onto the first field. */
    entry: number
    hits: number
    hardest: number
    why: string
}

/** The bot's run from the grid: its time on fields on a sprint, a flying lap on a loop. */
function run(track: Track, route: Route | null): Run {
    const car = gridCar(track)
    const timer = new LapTimer(track, car.x, car.y, car.z)
    const lap = track.closed ? 1 : 0
    let onField = 0
    let entry = NaN
    let hits = 0
    let hardest = 0
    for (let i = 0; i < PHYSICS_HZ * 240; i++) {
        const ev = stepCar(car, botInput(car, track, 1, route), track, DT)
        if (ev.fell) return { time: NaN, lap: NaN, entry, hits, hardest, why: 'fell' }
        if (ev.wallImpact > 0) {
            hits++
            hardest = Math.max(hardest, ev.wallImpact)
        }
        if (car.proj.field >= 0) {
            if (Number.isNaN(entry)) entry = car.speed
            onField += DT
        }
        for (const e of timer.update(car.x, car.y, car.z, DT, crossesLines(car, track))) {
            if (e.type === 'missed') return { time: NaN, lap: NaN, entry, hits, hardest, why: 'missed' }
            if (e.type === 'lap' && e.lap === lap) return { time: track.arena ? e.time : onField, lap: e.time, entry, hits, hardest, why: '' }
        }
    }
    return { time: NaN, lap: NaN, entry, hits, hardest, why: 'stuck' }
}

/** The most a car can corner at on a bend of curvature `k`: the tyres' grip, and at low speed the front wheels' lock. */
function cornerLimit(k: number) {
    if (k < 1e-6) return Infinity
    let lo = 0
    let hi = 120
    for (let i = 0; i < 40; i++) {
        const v = (lo + hi) / 2
        const reach = Math.min(GRIP_LATERAL / (v * v), Math.tan(MAX_STEER_ANGLE / (1 + v / STEER_FALLOFF_SPEED)) / WHEELBASE)
        if (reach >= k) lo = v
        else hi = v
    }
    return lo
}

/**
 * Time to drive points `xs`, `zs` (curvature `ks`) flat out: full grip in the bends, full brakes before them, the engine and any pad's
 * kick and surge between; `v0` into the first point. A loop is driven round twice and timed the second time.
 */
function perfectTime(xs: ArrayLike<number>, zs: ArrayLike<number>, ks: ArrayLike<number>, opts: { v0: number, loop: boolean, counts?: (i: number) => boolean, padAt?: (i: number) => boolean }) {
    const n = xs.length
    const laps = opts.loop ? 2 : 1
    const m = opts.loop ? n * laps + 1 : n
    const at = (j: number) => j % n
    const ds = (j: number) => Math.hypot(xs[at(j + 1)]! - xs[at(j)]!, zs[at(j + 1)]! - zs[at(j)]!)
    const cap = new Float64Array(m)
    for (let j = 0; j < m; j++) cap[j] = Math.min(cornerLimit(Math.abs(ks[at(j)]!)), ENGINE_TOP_SPEED * NITRO_TOP_SPEED_MULT)
    for (let j = m - 2; j >= 0; j--) {
        const v = cap[j + 1]!
        cap[j] = Math.min(cap[j]!, Math.sqrt(v * v + 2 * (BRAKE_DECEL + ROLLING_DRAG + AERO_DRAG * v * v) * ds(j)))
    }
    let v = Math.min(opts.v0, cap[0]!)
    let boost = 0
    let wasPad = false
    let time = 0
    for (let j = 0; j + 1 < m; j++) {
        const pad = opts.padAt?.(at(j)) ?? false
        if (pad && !wasPad) v = Math.max(v, Math.min(v + BOOST_KICK, ENGINE_TOP_SPEED * NITRO_TOP_SPEED_MULT))
        if (pad) boost = BOOST_DURATION
        wasPad = pad
        v = Math.min(v, cap[j]!)
        const d = ds(j)
        const top = ENGINE_TOP_SPEED * (boost > 0 ? NITRO_TOP_SPEED_MULT : 1)
        const accel = (ENGINE_ACCEL + (boost > 0 ? NITRO_ACCEL : 0)) * Math.max(0, 1 - v / top) - ROLLING_DRAG - AERO_DRAG * v * v
        const next = Math.min(cap[j + 1]!, Math.sqrt(Math.max(0, v * v + 2 * accel * d)))
        const dt = 2 * d / Math.max(0.5, v + next)
        boost = Math.max(0, boost - dt)
        if ((!opts.loop || j >= n) && (opts.counts?.(at(j)) ?? true)) time += dt
        v = next
    }
    return { time, v }
}

/** Signed curvature of the circle through three points. */
function bend(ax: number, az: number, bx: number, bz: number, cx: number, cz: number) {
    const x1 = cx - bx
    const z1 = cz - bz
    const x2 = ax - bx
    const z2 = az - bz
    const x3 = cx - ax
    const z3 = cz - az
    const norms = Math.sqrt((x1 * x1 + z1 * z1) * (x2 * x2 + z2 * z2) * (x3 * x3 + z3 * z3))
    return norms > 0 ? 2 * (x1 * z2 - x2 * z1) / norms : 0
}

/** The planned line's points, each bend measured over two points either side. */
function lineOf(path: FieldPath, from = 0, to = path.points.length) {
    const pts = path.points.slice(from, to)
    const xs = pts.map(p => p[0])
    const zs = pts.map(p => p[1])
    const ks = xs.map((_, i) => {
        const a = Math.max(0, i - 2)
        const c = Math.min(xs.length - 1, i + 2)
        return a === i || c === i ? 0 : bend(xs[a]!, zs[a]!, xs[i]!, zs[i]!, xs[c]!, zs[c]!)
    })
    return { xs, zs, ks }
}

/** The perfect time across the route's fields along its plan, or a lap of an arena's. */
function estimate(track: Track, route: Route, entry: number) {
    const paths = routeFieldPaths(track.fields, route)
    if (!paths.length) return NaN
    const onField = (field: number, x: number, z: number) => {
        const f = track.fields[field]!
        const p = f.local(x, z)
        return f.contains(p.u, p.v)
    }
    const padAt = (x: number, z: number, dx: number, dz: number) => track.fields.some((f) => {
        const p = f.local(x, z)
        const pad = f.padUnder(p.u, p.v)
        return !!pad && pad.dx * dx + pad.dz * dz > 0
    })
    const arena = paths[0]!.cycle
    if (arena) {
        const { xs, zs, ks } = lineOf(paths[0]!, arena.from, arena.from + arena.length)
        return perfectTime(xs, zs, ks, { v0: 0, loop: true, padAt: i => padAt(xs[i]!, zs[i]!, xs[(i + 1) % xs.length]! - xs[i]!, zs[(i + 1) % xs.length]! - zs[i]!) }).time
    }
    let total = 0
    let v0 = entry
    for (const path of paths) {
        const { xs, zs, ks } = lineOf(path)
        // Each path counts only its own field, as a joined field's run-in lies on the one before.
        const counts = (i: number) => i + 1 < xs.length && (path.fields ?? [path.field]).some(f => onField(f, (xs[i]! + xs[i + 1]!) / 2, (zs[i]! + zs[i + 1]!) / 2))
        const drive = perfectTime(xs, zs, ks, { v0, loop: false, counts, padAt: i => i + 1 < xs.length && padAt(xs[i]!, zs[i]!, xs[i + 1]! - xs[i]!, zs[i + 1]! - zs[i]!) })
        total += drive.time
        v0 = drive.v
    }
    return total
}

const pct = (bot: number, best: number) => Number.isFinite(bot) && Number.isFinite(best) ? `${((bot / best - 1) * 100).toFixed(1)}%` : '-'

/** One course's result on one route, as either engine reports it. */
interface Row {
    name: string
    ms: number
    lap: number | null
    field: number | null
    best: number | null
    hits: number
    hardest: number
    why: string
}

const num = (v: number) => Number.isFinite(v) ? v : null

/** Every route of `custom` driven from the grid, or why it doesn't compile. */
function drive(name: string, custom: CustomTrack): Row[] {
    const { def, error } = compileCustomTrack(custom)
    if (!def) return [{ name, ms: 0, lap: null, field: null, best: null, hits: 0, hardest: 0, why: error ?? 'no track' }]
    const track = new Track(def)
    return track.routes.map((route, i) => {
        const t0 = performance.now()
        routeFieldPaths(track.fields, route)
        const ms = performance.now() - t0
        const r = run(track, track.routes.length > 1 ? route : null)
        const best = estimate(track, route, Number.isNaN(r.entry) ? 0 : r.entry)
        return { name: track.routes.length > 1 ? `${name} r${i}` : name, ms, lap: num(r.lap), field: num(r.time), best: num(best), hits: r.hits, hardest: r.hardest, why: r.why }
    })
}

/** Every course this run covers: the samples, the course files, the random courses and the road courses, in this engine. */
function results(files: string[], seeds: number[]) {
    const fields: Row[] = SAMPLES.flatMap(s => drive(s.name, s.track))
    for (const file of files) {
        const custom = sanitizeCustomTrack({ ...JSON.parse(readFileSync(file, 'utf8')), id: 'custom-bot' })
        fields.push(...custom ? drive(basename(file, '.json'), custom) : [{ name: basename(file), ms: 0, lap: null, field: null, best: null, hits: 0, hardest: 0, why: 'not a course' }])
    }
    {
        const track = new Track(buildTrack(FIELD_OBSTACLES))
        const r = run(track, null)
        fields.push({ name: FIELD_OBSTACLES.name, ms: 0, lap: num(r.lap), field: num(r.time), best: num(estimate(track, track.routes[0]!, r.entry)), hits: r.hits, hardest: r.hardest, why: r.why })
    }
    const random: Row[] = []
    for (const seed of seeds) {
        const rng = createSeededRandom(seed)
        for (let k = 0; k < RANDOM_COURSES; k++) random.push(...drive(`seed ${seed} #${k}`, nextCourse(rng)))
    }
    const roads: Row[] = []
    const neonRing = compileCustomTrack({ id: 'neon-ring', name: 'Neon Ring', closed: true, sections: ['start', 'straight-100', 'right-tight', 'right-tight', 'straight-100', 'straight-20', 'right-tight', 'right-tight'] }).def!
    for (const def of [neonRing, ...TRACKS]) {
        const track = new Track(def)
        if (track.forked || track.fields.length || track.rails.length || track.gaps.length) continue
        roads.push({ name: def.name, ms: 0, lap: botLapTime(track), field: null, best: roadEstimate(track), hits: 0, hardest: 0, why: '' })
    }
    return { fields, random, roads }
}

/** Random courses per seed. */
const RANDOM_COURSES = 30
/** Share two engines' laps may differ by: rounding in the last digit only, as any real split moves a lap far more. */
const ENGINE_SLACK = 1e-6

/** The perfect lap along the road's racing line, standing from the grid. */
function roadEstimate(track: Track) {
    const xs: number[] = []
    const zs: number[] = []
    for (let i = 0; i < track.n; i++) {
        const off = track.racingOffsetAt(track.cum[i]!)
        xs.push(track.xs[i]! - track.tzs[i]! * off)
        zs.push(track.zs[i]! + track.txs[i]! * off)
    }
    const ks = Array.from(track.racingCurvature)
    if (track.closed) return perfectTime(xs, zs, ks, { v0: 0, loop: true }).time
    const from = track.segmentAt(track.startS - 14)
    const to = track.segmentAt(track.lapLines.find(l => l.kind === 'finish')!.s)
    return perfectTime(xs.slice(from, to + 1), zs.slice(from, to + 1), ks.slice(from, to + 1), { v0: 0, loop: false }).time
}

type Results = ReturnType<typeof results>

const args = process.argv.slice(2)
const flag = (name: string) => {
    const i = args.indexOf(name)
    return i >= 0 ? args.splice(i, 2)[1] : undefined
}
const seeds = (flag('--seeds') ?? '1,7').split(',').filter(Boolean).map(Number)
const worker = args.includes('--worker')
const files = args.filter(a => a !== '--worker')

if (worker) console.log(JSON.stringify(results(files, seeds)))
else {
    // One bundle, so both engines run the very same code.
    const dir = mkdtempSync(join(tmpdir(), 'field-bot-'))
    const bundle = join(dir, 'field-bot.mjs')
    const root = fileURLToPath(new URL('..', import.meta.url))
    execFileSync('bun', ['build', fileURLToPath(import.meta.url), '--target=node', `--outfile=${bundle}`, '--tsconfig-override', join(root, '.nuxt/tsconfig.app.json')], { stdio: 'ignore' })
    const runIn = (engine: string) => new Promise<Results>((done, fail) => execFile(engine, [bundle, '--worker', '--seeds', seeds.join(','), ...files], { maxBuffer: 1 << 26 }, (err, out) => err ? fail(err) : done(JSON.parse(out.slice(out.indexOf('{'))))))
    const [v8, jsc] = await Promise.all([runIn('node'), runIn('bun')])
    rmSync(dir, { recursive: true })
    const s2 = (v: number | null) => (v === null ? '-' : v.toFixed(2)).padStart(6)
    const off = (a: number | null, b: number | null) => a === null || b === null ? (a === b ? 0 : Infinity) : Math.abs(a / b - 1)
    const outOf: string[] = []
    const table = (rows: Row[], other: Row[]) => rows.forEach((r, i) => {
        const o = other[i]!
        const apart = off(r.lap, o.lap)
        if (apart > ENGINE_SLACK || r.why !== o.why) outOf.push(`${r.name}: V8 ${r.why || r.lap?.toFixed(2)} s, JSC ${o.why || o.lap?.toFixed(2)} s`)
        console.log(`${r.name.padEnd(20)} | ${r.ms.toFixed(1).padStart(7)} | ${(r.why || s2(r.lap)).padStart(6)} | ${(o.why || s2(o.lap)).padStart(6)} | ${s2(r.field)} | ${s2(r.best)} | ${pct(r.field ?? NaN, r.best ?? NaN).padStart(6)} | ${String(r.hits).padStart(4)} | ${r.hardest.toFixed(1)}`)
    })
    console.log('course               | plan ms | V8 lap | JSC    | field  | best s | gap    | hits | hardest')
    table(v8.fields, jsc.fields)
    if (v8.random.length) {
        console.log('\nrandom               | plan ms | V8 lap | JSC    | field  | best s | gap    | hits | hardest')
        table(v8.random, jsc.random)
        const failed = v8.random.filter(r => r.why).length
        console.log(`${v8.random.length} random runs, ${failed} without a lap in V8`)
    }
    console.log('\nroad                 | V8 lap | JSC    | best s | gap')
    v8.roads.forEach((r, i) => console.log(`${r.name.padEnd(20)} | ${s2(r.lap)} | ${s2(jsc.roads[i]!.lap)} | ${s2(r.best)} | ${pct(r.lap ?? NaN, r.best ?? NaN).padStart(6)}`))
    console.log(outOf.length ? `\nV8 and JSC split on ${outOf.length}:\n${outOf.join('\n')}` : '\nV8 and JSC laps agree everywhere.')
}
