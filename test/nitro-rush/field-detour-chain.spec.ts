import { describe, expect, it } from 'vitest'
import { compileCustomTrack, sanitizeCustomTrack, type CustomTrack, type SectionId } from '#shared/utils/nitro-rush/custom'
import { ghostDrivesTrack } from '#shared/utils/nitro-rush/drive-check'
import { LapTimer, type LapEvent } from '#shared/utils/nitro-rush/timing'
import { Track, type Route } from '#shared/utils/nitro-rush/track'
import { findTrack } from '#shared/utils/nitro-rush/tracks'
import { PHYSICS_HZ } from '../../app/utils/nitro-rush/config'
import { botInput, crossesLines, gridCar, stepCar } from '../../app/utils/nitro-rush/physics'
import { drive } from './bot-lap'

/** Several detours off one field: a lap can drive them one after another, crossing back onto the field between them. */

const HUB = { branch: 0, at: 0 }
const loop = (checkpoint: SectionId): SectionId[] => ['right-medium', 'boost-pad-left', 'right-medium', checkpoint, 'right-medium']

/** A loop with one field on its road and a little loop off three of the field's edges, each back into the same field. */
const clover = (checkpoints: [SectionId, SectionId, SectionId]) => sanitizeCustomTrack({
    id: 'custom-test',
    name: 'Clover',
    closed: true,
    sections: ['field', 'right-medium', 'boost-pad-left', 'right-medium', 'start', 'right-medium'],
    branches: [
        { sections: loop(checkpoints[0]), from: { ...HUB, port: { edge: 'exit', tile: 5.5 } }, to: HUB },
        { sections: loop(checkpoints[1]), from: { ...HUB, port: { edge: 'left', tile: 5.5 } }, to: HUB },
        { sections: loop(checkpoints[2]), from: { ...HUB, port: { edge: 'entry', tile: 3.5 } }, to: HUB }
    ],
    fields: [{ at: HUB, width: 200, length: 200, entry: 5.5, exit: { edge: 'right', tile: 3.5 }, tiles: [] }]
}) as CustomTrack

function trackOf(t: CustomTrack) {
    const { def, error } = compileCustomTrack(t)
    expect(error).toBeNull()
    return new Track(def!)
}

/** The order a route drives the detours in, by branch. */
const detourOrder = (route: Route) => route.legs.filter(l => l.branch > 0).map(l => l.branch)

/** `route` with the detour on `branch` driven straight after the one on `after`. */
function withDetour(track: Track, route: Route, branch: number, after: number): Route {
    const i = route.legs.findIndex(l => l.branch === after)
    const legs = [...route.legs.slice(0, i + 1), { branch, from: 0, to: track.branches[branch]!.length }, ...route.legs.slice(i + 1)]
    return { ...route, legs }
}

/** The bot's run down `route` from the grid until a lap counts or one is missed, with the events it saw. */
function botRun(track: Track, route: Route) {
    const car = gridCar(track)
    const timer = new LapTimer(track, car.x, car.y, car.z)
    const events: LapEvent[] = []
    for (let i = 0; i < PHYSICS_HZ * 240; i++) {
        expect(stepCar(car, botInput(car, track, 1, route), track, 1 / PHYSICS_HZ).fell).toBe(false)
        events.push(...timer.update(car.x, car.y, car.z, 1 / PHYSICS_HZ, crossesLines(car, track)))
        if (events.some(e => e.type === 'lap' || e.type === 'missed')) return events
    }
    throw new Error('the run never reached the line')
}

describe('detours chained off one field', () => {
    const required = clover(['checkpoint-required', 'checkpoint-required', 'checkpoint-required'])

    it('gives a route through every required detour in every order', () => {
        const track = trackOf(required)
        expect(track.requiredIds).toHaveLength(3)
        expect(track.routes).toHaveLength(6)
        for (const route of track.routes) expect(track.requiredIds.every(id => route.checkpoints.includes(id))).toBe(true)
        const orders = track.routes.map(r => detourOrder(r).join(''))
        expect(new Set(orders)).toEqual(new Set(['123', '132', '213', '231', '312', '321']))
        expect(track.k).toBe(3)
    })

    it('counts the bot\'s lap down every order as a lap, ghost and all', () => {
        const track = trackOf(required)
        for (const route of track.routes) {
            expect(botRun(track, route).filter(e => e.type === 'split')).toHaveLength(3)
            expect(ghostDrivesTrack(track, drive(track, 0, route))).toBe(true)
        }
    })

    it('misses the lap on a route that leaves a required detour out', () => {
        const track = trackOf(required)
        const route = track.routes[0]!
        const skip = { ...route, legs: route.legs.filter(l => l.branch !== detourOrder(route)[1]) }
        expect(botRun(track, skip).find(e => e.type === 'missed')).toMatchObject({ required: true })
    })

    it('keeps one route through a single required detour, and a lap that also drives the optional ones still counts', () => {
        const track = trackOf(clover(['checkpoint', 'checkpoint-required', 'checkpoint']))
        expect(track.routes).toHaveLength(1)
        const [route] = track.routes
        expect(detourOrder(route!)).toEqual([2])
        // The player drives the optional loops too, either side of the required one.
        const longer = withDetour(track, withDetour(track, route!, 1, 0), 3, 2)
        expect(detourOrder(longer)).toEqual([1, 2, 3])
        expect(botRun(track, longer).some(e => e.type === 'lap')).toBe(true)
        expect(ghostDrivesTrack(track, drive(track, 0, longer))).toBe(true)
    })

    it('still offers one detour or none when no detour is required', () => {
        const track = trackOf(clover(['checkpoint', 'checkpoint', 'checkpoint']))
        expect(track.routes.map(detourOrder)).toEqual([[], [1], [2], [3]])
    })

    it('laps Cloverfield, the built-in, down every order of its petals', () => {
        const track = new Track(findTrack('cloverfield')!)
        expect(track.routes).toHaveLength(6)
        for (const route of track.routes) {
            const events = botRun(track, route)
            expect(events.some(e => e.type === 'missed')).toBe(false)
            expect(events.filter(e => e.type === 'split')).toHaveLength(3)
        }
    })
})
