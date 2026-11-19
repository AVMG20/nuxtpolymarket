// How the bot crosses sample fields (plan time, run time, wall hits); the #shared alias needs the app tsconfig.
// bun --tsconfig-override .nuxt/tsconfig.app.json scripts/nitro-rush-fields.ts
import { PHYSICS_HZ } from '../app/utils/nitro-rush/config'
import { botInput, createCar, crossesLines, stepCar } from '../app/utils/nitro-rush/physics'
import { compileCustomTrack, type SectionId } from '../shared/utils/nitro-rush/custom'
import { defaultFieldPlan, type FieldTile } from '../shared/utils/nitro-rush/field'
import { routeFieldPaths } from '../shared/utils/nitro-rush/field-plan'
import { buildTrack } from '../shared/utils/nitro-rush/layout'
import { LapTimer } from '../shared/utils/nitro-rush/timing'
import { Track } from '../shared/utils/nitro-rush/track'
import { CLOVERFIELD, FIELD_OBSTACLES } from '../shared/utils/nitro-rush/tracks'

const DT = 1 / PHYSICS_HZ
const ROAD: SectionId[] = ['straight-20', 'start', 'straight-100', 'field', 'straight-100', 'finish', 'straight-200']

const gate = (col: number, row: number, dir: 0 | 1 | 2 | 3 = 0): FieldTile => ({ col, row, kind: 'checkpoint', dir })
const block = (col: number, row: number): FieldTile => ({ col, row, kind: 'block' })
const pillar = (col: number, row: number): FieldTile => ({ col, row, kind: 'pillar' })
const pad = (col: number, row: number, dir: 0 | 1 | 2 | 3 = 0): FieldTile => ({ col, row, kind: 'boost', dir })

const SAMPLES: { name: string, size: [number, number], tiles: FieldTile[] }[] = [
    { name: 'empty 100x100', size: [100, 100], tiles: [] },
    { name: 'empty 20x20', size: [20, 20], tiles: [] },
    { name: 'zigzag gates', size: [100, 100], tiles: [gate(0, 1), gate(4, 3)] },
    { name: 'gate crossed back', size: [100, 100], tiles: [gate(2, 3, 2)] },
    { name: 'wall with a gap', size: [100, 100], tiles: [1, 2, 3, 4].map(c => block(c, 2)) },
    { name: 'pillar slalom', size: [100, 200], tiles: [pillar(2, 2), pillar(1, 4), pillar(3, 6), pillar(2, 8)] },
    { name: 'pads and gates', size: [200, 200], tiles: [pad(5, 0), gate(1, 3, 3), gate(8, 6, 1), gate(4, 8), pad(4, 5)] },
    { name: 'six gates, maze', size: [200, 200], tiles: [gate(0, 2), gate(9, 2), gate(0, 6), gate(9, 6), gate(3, 8, 1), gate(6, 3, 2), ...[2, 3, 4, 5, 6, 7].map(c => block(c, 5))] }
]

function run(track: Track) {
    const car = createCar(track, track.startS - 14)
    const timer = new LapTimer(track, car.x, car.y, car.z)
    let hits = 0
    for (let i = 0; i < PHYSICS_HZ * 120; i++) {
        const ev = stepCar(car, botInput(car, track), track, DT)
        if (ev.fell) return { time: NaN, hits, why: 'fell' }
        if (ev.wallImpact > 0) hits++
        for (const e of timer.update(car.x, car.y, car.z, DT, crossesLines(car, track))) {
            if (e.type === 'lap') return { time: e.time, hits, why: '' }
        }
    }
    return { time: NaN, hits, why: 'no finish' }
}

function report(name: string, track: Track) {
    const t0 = performance.now()
    const [path] = routeFieldPaths(track.fields, track.routes[0]!)
    const ms = performance.now() - t0
    const r = run(track)
    console.log(`${name.padEnd(17)} | ${ms.toFixed(1).padStart(7)} | ${String(path?.points.length ?? 0).padStart(6)} | ${(r.why || r.time.toFixed(2)).padStart(6)} | ${r.hits}`)
}

console.log('field             | plan ms | points | time s | wall hits')
for (const s of SAMPLES) {
    const { def, error } = compileCustomTrack({ id: 'custom-balance', name: 'Fields', closed: false, sections: ROAD, fields: [{ at: { branch: 0, at: 3 }, ...defaultFieldPlan(...s.size), tiles: s.tiles }] })
    if (def) report(s.name, new Track(def))
    else console.log(`${s.name.padEnd(17)} | ${error}`)
}
for (const layout of [FIELD_OBSTACLES, CLOVERFIELD]) report(layout.name, new Track(buildTrack(layout)))
