import { describe, expect, it } from 'vitest'
import { compileCustomTrack, importCustomTrack, isArena, sanitizeCustomTrack, type CustomTrack } from '#shared/utils/nitro-rush/custom'
import { ghostDrivesTrack } from '#shared/utils/nitro-rush/drive-check'
import { addFieldExit, growField, useFieldTool, type FieldEdit } from '#shared/utils/nitro-rush/field-edit'
import { LapTimer, type LapEvent } from '#shared/utils/nitro-rush/timing'
import { Track } from '#shared/utils/nitro-rush/track'
import { botLapTime } from '../../app/utils/nitro-rush/medals'
import { drive } from './bot-lap'

/** Arenas: loops laid only of fields, lapped from the start through every checkpoint with no road to close. */

const ARENA_JSON = '{"name":"My Track","closed":true,"sections":["field"],"fields":[{"at":{"branch":0,"at":0},"width":200,"length":60,"entry":5,"exit":{"edge":"exit","tile":5},"tiles":[{"col":1,"row":1,"kind":"checkpoint","dir":1},{"col":5,"row":1,"kind":"start","dir":1},{"col":8,"row":1,"kind":"checkpoint","dir":1}]}]}'
const SPOT = { branch: 0, at: 0 }

const arena = () => importCustomTrack(ARENA_JSON, 'custom-test').track!

/** Four 100 m fields laid round a square, each leaving by its right edge into the next. */
const SQUARE = sanitizeCustomTrack({
    id: 'custom-test',
    name: 'Square',
    closed: true,
    sections: ['field', 'field', 'field', 'field'],
    fields: [
        { at: { branch: 0, at: 0 }, width: 100, length: 100, entry: 2, exit: { edge: 'right', tile: 2 }, tiles: [{ col: 2, row: 2, kind: 'start', dir: 0 }] },
        { at: { branch: 0, at: 1 }, width: 100, length: 100, entry: 2, exit: { edge: 'right', tile: 2 }, tiles: [{ col: 2, row: 2, kind: 'checkpoint', dir: 0 }] },
        { at: { branch: 0, at: 2 }, width: 100, length: 100, entry: 2, exit: { edge: 'right', tile: 2 }, tiles: [] },
        { at: { branch: 0, at: 3 }, width: 100, length: 100, entry: 2, exit: { edge: 'right', tile: 2 }, tiles: [{ col: 1, row: 1, kind: 'checkpoint', dir: 1 }] }
    ]
}) as CustomTrack

const built = (t: CustomTrack) => {
    const { def, error } = compileCustomTrack(t)
    expect(error).toBeNull()
    return new Track(def!)
}
const done = (e: FieldEdit) => {
    expect(e.error).toBeNull()
    return e.track!
}

/** Moves the car in 2 m steps through each of `points`, 1/20 s a step, collecting the timer's events. */
function driveThrough(timer: LapTimer, from: [number, number], points: [number, number][]) {
    const events: LapEvent[] = []
    let [x, z] = from
    for (const [tx, tz] of points) {
        const steps = Math.ceil(Math.hypot(tx - x, tz - z) / 2)
        for (let k = 1; k <= steps; k++) events.push(...timer.update(x + (tx - x) * k / steps, 0, z + (tz - z) * k / steps, 0.05))
        x = tx
        z = tz
    }
    return events
}

describe('a loop of only fields', () => {
    it('compiles from the pasted course, walled all round, and the bot laps it', () => {
        const t = arena()
        expect(isArena(t)).toBe(true)
        const track = built(t)
        expect(track.arena).toBe(true)
        expect(track.k).toBe(track.checkpointCount)
        expect(track.k).toBe(2)
        // No mouths, so walls run the whole way round the field.
        const field = track.fields[0]!
        expect(field.mouths).toHaveLength(0)
        expect(field.walls.reduce((n, w) => n + w.length, 0)).toBeCloseTo(2 * (200 + 60), 6)
        expect(track.minLapSeconds).toBeGreaterThan(0)
        // A flying lap, so the bot comes round through the start onto its second.
        expect(ghostDrivesTrack(track, drive(track, 1))).toBe(true)
        expect(botLapTime(track)).not.toBeNull()
    })

    it('needs every checkpoint each lap, in any order, and says when one was missed', () => {
        const track = built(arena())
        // Start at (0, -30) facing +x; checkpoints at x = 60 and x = -80; row 2 runs along z = -50, clear of every gate.
        const timer = new LapTimer(track, -14, 0, -30)
        const missed = driveThrough(timer, [-14, -30], [[70, -30], [70, -50], [-20, -50], [-20, -30], [10, -30]])
        expect(missed.filter(e => e.type === 'split')).toHaveLength(1)
        expect(missed.filter(e => e.type !== 'split')).toEqual([{ type: 'missed', lap: 0, required: false }])
        const lapped = driveThrough(timer, [10, -30], [[30, -30], [30, -50], [-100, -50], [-100, -30], [10, -30]])
        expect(lapped.filter(e => e.type === 'split')).toHaveLength(1)
        expect(lapped.find(e => e.type === 'lap')).toMatchObject({ type: 'lap', lap: 0 })
    })

    it('needs a checkpoint, and refuses branches', () => {
        const bare = { ...arena(), fields: arena().fields!.map(f => ({ ...f, tiles: f.tiles.filter(k => k.kind !== 'checkpoint') })) }
        expect(compileCustomTrack(bare).error).toBe('add a checkpoint to a field')
        expect(addFieldExit(arena(), SPOT, { edge: 'left', tile: 1 }).error).toBe('fields-only loops can\'t have branches yet')
    })

    it('lets blocks stand where the road would come in, but not wall a checkpoint off', () => {
        const t = arena()
        // The entry tile, which a road loop has to keep clear.
        done(useFieldTool(t, SPOT, 5, 0, 'block'))
        const walling = done(useFieldTool(done(useFieldTool(t, SPOT, 3, 0, 'block')), SPOT, 3, 1, 'block'))
        expect(useFieldTool(walling, SPOT, 3, 2, 'block').error).toBe('that blocks part of the field')
    })

    it('laps four fields laid round a square as one arena', () => {
        expect(isArena(SQUARE)).toBe(true)
        const track = built(SQUARE)
        expect(track.arena).toBe(true)
        expect(track.k).toBe(track.checkpointCount)
        expect(track.k).toBe(2)
        // Each field walls only its two outer edges; the other two open onto its neighbours.
        for (const f of track.fields) expect(f.walls.reduce((n, w) => n + w.length, 0)).toBeCloseTo(200, 6)
        expect(ghostDrivesTrack(track, drive(track, 1))).toBe(true)
    })

    it('laps fields grown off the arena with the rest', () => {
        const grown = done(growField(arena(), SPOT, 'right'))
        expect(grown.sections).toEqual(['field', 'field'])
        expect(isArena(grown)).toBe(true)
        const track = built(grown)
        expect(track.arena).toBe(true)
        expect(ghostDrivesTrack(track, drive(track, 1))).toBe(true)
    })

    it('turns back into a road loop, which has to close, once a road section goes in', () => {
        const road = { ...arena(), sections: [...arena().sections, 'straight-100' as const] }
        expect(isArena(road)).toBe(false)
        expect(compileCustomTrack(road).error).toMatch(/instead of closing the loop/)
    })
})
