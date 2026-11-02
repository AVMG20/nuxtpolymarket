import { describe, expect, it } from 'vitest'
import { drive, driveFlatOut, LONG_RECTANGLE, RECTANGLE, STUNT_SPRINT, trackOf } from './bot-lap'
import { ENGINE_TOP_SPEED, NITRO_TOP_SPEED_MULT } from '../../app/utils/nitro-rush/config'
import type { SectionId } from '#shared/utils/nitro-rush/custom'
import { ghostDrivesTrack } from '#shared/utils/nitro-rush/drive-check'
import { GHOST_POSE, type Ghost } from '#shared/utils/nitro-rush/ghost'

/** `g` with the poses from `from` on replaced by `pose(k)`. */
function edit(g: Ghost, from: number, pose: (k: number, data: Float32Array) => [number, number, number]): Ghost {
    const data = g.data.slice()
    for (let k = from; k < data.length / GHOST_POSE; k++) data.set(pose(k, data), k * GHOST_POSE)
    return { ...g, data }
}
const at = (data: Float32Array, k: number): [number, number, number] => [data[k * GHOST_POSE]!, data[k * GHOST_POSE + 1]!, data[k * GHOST_POSE + 2]!]

describe('ghost drive check', () => {
    const loop = trackOf(true, RECTANGLE)
    const standing = drive(loop)
    const flying = drive(loop, 1)

    it('passes a real lap: standing and flying on a loop, and a sprint through jumps, loopings, a corkscrew and a spiral', () => {
        expect(ghostDrivesTrack(loop, standing)).toBe(true)
        expect(ghostDrivesTrack(loop, flying)).toBe(true)
        const stunts = trackOf(false, STUNT_SPRINT)
        expect(stunts.gaps.length).toBe(2)
        expect(ghostDrivesTrack(stunts, drive(stunts))).toBe(true)
    })

    it('passes a real lap round a bank, and a banked loop', () => {
        const sprint = trackOf(false, ['straight-20', 'start', 'straight-100', 'bank-left', 'straight-100', 'left-wide', 'straight-60', 'right-wide', 'bank-flat', 'finish', 'straight-200'])
        expect(ghostDrivesTrack(sprint, drive(sprint))).toBe(true)
        const banked = trackOf(true, ['start', 'straight-60', 'bank-right', 'right-tight', 'right-tight', 'bank-flat', 'straight-60', 'straight-20', 'right-tight', 'right-tight'])
        expect(ghostDrivesTrack(banked, drive(banked, 1))).toBe(true)
    })

    it('fails a ghost that stands still on the grid', () => {
        expect(ghostDrivesTrack(loop, edit(flying, 1, () => at(flying.data, 0)))).toBe(false)
    })

    it('fails a ghost that stops short of the finish', () => {
        const n = flying.data.length / GHOST_POSE
        const stop = Math.floor(n * 0.9)
        expect(ghostDrivesTrack(loop, edit(flying, stop, () => at(flying.data, stop)))).toBe(false)
    })

    it('fails a ghost that skips a stretch of road', () => {
        const n = flying.data.length / GHOST_POSE
        // A third of the way round it jumps ahead to two thirds, and drives on from there.
        const from = Math.floor(n / 3)
        const shift = Math.floor(n / 3)
        expect(ghostDrivesTrack(loop, edit(flying, from, k => at(flying.data, Math.min(n - 1, k + shift))))).toBe(false)
    })

    it('fails a ghost that cuts across the infield', () => {
        const n = flying.data.length / GHOST_POSE
        const from = Math.floor(n * 0.2)
        const to = Math.floor(n * 0.8)
        const [ax, ay, az] = at(flying.data, from)
        const [bx, by, bz] = at(flying.data, to)
        // A straight line between two points on the road, then the rest of the lap as driven.
        const cut = edit(flying, from, (k) => {
            if (k >= to) return at(flying.data, k)
            const f = (k - from) / (to - from)
            return [ax + (bx - ax) * f, ay + (by - ay) * f, az + (bz - az) * f]
        })
        expect(ghostDrivesTrack(loop, cut)).toBe(false)
    })

    it('fails a lap driven on another road, and a lap run backwards', () => {
        expect(ghostDrivesTrack(trackOf(true, LONG_RECTANGLE), flying)).toBe(false)
        const n = flying.data.length / GHOST_POSE
        expect(ghostDrivesTrack(loop, edit(flying, 0, k => at(flying.data, n - 1 - k)))).toBe(false)
    })

    describe('flights off a jump at top speed', () => {
        const NITRO_TOP = ENGINE_TOP_SPEED * NITRO_TOP_SPEED_MULT
        const courses: Record<string, SectionId[]> = {
            'a big jump onto flat road': ['straight-20', 'start', 'straight-100', 'big-jump', 'straight-200', 'finish', 'straight-200'],
            'a big jump onto a downhill': ['straight-20', 'start', 'ramp-up', 'straight-100', 'big-jump', 'steep-down', 'straight-200', 'finish', 'straight-200'],
            'a jump onto a downhill': ['straight-20', 'start', 'ramp-up', 'straight-100', 'jump', 'steep-down', 'straight-200', 'finish', 'straight-200']
        }
        for (const [name, sections] of Object.entries(courses)) {
            it(`passes ${name}, on the centreline and near a wall`, () => {
                const track = trackOf(false, sections)
                for (const speed of [ENGINE_TOP_SPEED, NITRO_TOP]) {
                    expect(ghostDrivesTrack(track, driveFlatOut(track, speed))).toBe(true)
                    expect(ghostDrivesTrack(track, driveFlatOut(track, speed, 8))).toBe(true)
                }
            })
        }

        it('still fails a ghost that drops under the road', () => {
            const track = trackOf(false, courses['a big jump onto flat road']!)
            const run = driveFlatOut(track, NITRO_TOP)
            const n = run.data.length / GHOST_POSE
            const sunk = edit(run, Math.floor(n * 0.8), (k) => {
                const [x, y, z] = at(run.data, k)
                return [x, y - 12, z]
            })
            expect(ghostDrivesTrack(track, sunk)).toBe(false)
        })
    })
})
