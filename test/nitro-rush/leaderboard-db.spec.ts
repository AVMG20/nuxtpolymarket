import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SKIP, cleanupUser, seedUser } from '../setup/db-helpers'
import { nrGhost, nrLeaderboard, nrRecordGhost, nrTrackSummaries, saveNrGhost, submitNrLap, validGhost, validLap } from '#server/utils/nitro-rush'
import { encodeGhost, GHOST_HZ, GHOST_POSE, ghostSampleCount, type StoredGhost } from '#shared/utils/nitro-rush/ghost'
import { findTrack } from '#shared/utils/nitro-rush/tracks'

const tag = Date.now().toString(36)
const A = `nr-a-${tag}`
const B = `nr-b-${tag}`
// A course id of its own, so other runs' rows never shift the ranks.
const TRACK = `nr-test-${tag}`

describe('lap validation', () => {
    it('accepts a real lap and refuses unknown courses, odd values and impossible times', () => {
        expect(validLap(findTrack('polytown-oval'), 22_400)).toEqual({ trackId: 'polytown-oval', lapMs: 22_400 })
        expect(validLap(findTrack('nowhere'), 22_400)).toBeNull()
        expect(validLap(findTrack('polytown-oval'), 22.4)).toBeNull()
        expect(validLap(findTrack('polytown-oval'), '22400')).toBeNull()
        expect(validLap(findTrack('polytown-oval'), 5_000)).toBeNull()
        expect(validLap(findTrack('polytown-oval'), 31 * 60 * 1000)).toBeNull()
    })
})

/** A ghost of a `seconds` lap, driving along x. */
function ghostOf(seconds: number): StoredGhost {
    const n = ghostSampleCount(seconds, GHOST_HZ)
    const data = new Float32Array(n * GHOST_POSE)
    for (let k = 0; k < n; k++) {
        data[k * GHOST_POSE] = k
        data[k * GHOST_POSE + 6] = 1
    }
    return encodeGhost({ hz: GHOST_HZ, end: seconds, data })!
}

describe('ghost validation', () => {
    it('accepts a real ghost and refuses unknown courses, damaged ghosts and impossible laps', () => {
        const ghost = ghostOf(25)
        expect(validGhost(findTrack('polytown-oval'), ghost, false)).toEqual({ trackId: 'polytown-oval', ghost, standing: false })
        expect(validGhost(findTrack('polytown-oval'), ghost, true)?.standing).toBe(true)
        expect(validGhost(findTrack('nowhere'), ghost, false)).toBeNull()
        expect(validGhost(findTrack('polytown-oval'), ghost, 'yes')).toBeNull()
        expect(validGhost(findTrack('polytown-oval'), { ...ghost, d: 'not a ghost' }, false)).toBeNull()
        expect(validGhost(findTrack('polytown-oval'), ghostOf(3), false)).toBeNull()
    })

    it('keeps only a ghost\'s own fields, and no standing lap on a sprint', () => {
        expect(validGhost(findTrack('polytown-oval'), { ...ghostOf(25), extra: 'x'.repeat(100) }, false)?.ghost).not.toHaveProperty('extra')
        expect(validGhost(findTrack('s-bend-sprint'), ghostOf(40), true)).toBeNull()
    })
})

describe.skipIf(SKIP)('nitro rush leaderboard (db)', () => {
    beforeAll(async () => {
        await seedUser(A)
        await seedUser(B)
    })
    afterAll(async () => {
        await cleanupUser(A)
        await cleanupUser(B)
    })

    it('keeps the quickest of a burst of parallel laps as the one entry', async () => {
        const times = [30_500, 28_250, 29_900, 27_125, 31_000, 27_800, 28_000, 30_000, 29_000, 27_500]
        await Promise.all(times.map(t => submitNrLap(A, TRACK, t)))
        const board = await nrLeaderboard(TRACK, A)
        expect(board.entries).toBe(1)
        expect(board.me).toEqual({ rank: 1, name: 'concurrency test user', lapMs: 27_125, you: true })
    })

    it('only replaces an entry with a quicker lap', async () => {
        expect((await submitNrLap(A, TRACK, 27_125)).improved).toBe(false)
        expect((await submitNrLap(A, TRACK, 40_000)).improved).toBe(false)
        expect((await submitNrLap(A, TRACK, 26_900)).improved).toBe(true)
        expect((await nrLeaderboard(TRACK, A)).me?.lapMs).toBe(26_900)
    })

    it('ranks players by lap time, and an equal time behind whoever set it first', async () => {
        await submitNrLap(B, TRACK, 26_900)
        const board = await nrLeaderboard(TRACK, B)
        expect(board.entries).toBe(2)
        expect(board.top.map(r => [r.rank, r.you])).toEqual([[1, false], [2, true]])
        expect(board.me?.rank).toBe(2)
        await submitNrLap(B, TRACK, 25_000)
        expect((await nrLeaderboard(TRACK, B)).me?.rank).toBe(1)
    })

    it('sums up each course with its record and the viewer\'s own best', async () => {
        const EMPTY = `${TRACK}-empty`
        const [track, empty] = await nrTrackSummaries(A, [TRACK, EMPTY])
        expect(track).toEqual({ trackId: TRACK, entries: 2, record: { name: 'concurrency test user', lapMs: 25_000 }, myLapMs: 26_900 })
        expect(empty).toEqual({ trackId: EMPTY, entries: 0, record: null, myLapMs: null })
        expect((await nrTrackSummaries(B, [TRACK]))[0]!.myLapMs).toBe(25_000)
    })

    it('settles a burst of parallel ghosts on the fastest', async () => {
        const GHOSTS = `${TRACK}-ghosts`
        const times = [30.5, 28.25, 29.9, 27.125, 31, 27.8]
        await Promise.all(times.map(t => saveNrGhost(A, GHOSTS, { ghost: ghostOf(t), standing: false })))
        expect((await nrGhost(A, GHOSTS))?.ghost.end).toBe(27_125)
        expect(await nrGhost(B, GHOSTS)).toBeNull()
    })

    it('keeps a standing lap only until a flying one, then only a faster flying one', async () => {
        const LOOP = `${TRACK}-standing`
        expect(await saveNrGhost(A, LOOP, { ghost: ghostOf(32), standing: true })).toBe(true)
        expect(await saveNrGhost(A, LOOP, { ghost: ghostOf(31), standing: true })).toBe(true)
        expect(await saveNrGhost(A, LOOP, { ghost: ghostOf(33), standing: false })).toBe(true)
        expect(await saveNrGhost(A, LOOP, { ghost: ghostOf(20), standing: true })).toBe(false)
        expect(await saveNrGhost(A, LOOP, { ghost: ghostOf(34), standing: false })).toBe(false)
        expect(await saveNrGhost(A, LOOP, { ghost: ghostOf(30), standing: false })).toBe(true)
        expect(await nrGhost(A, LOOP)).toEqual({ ghost: ghostOf(30), standing: false })
    })

    it('hands the record holder\'s ghost to everyone but the holder, and skips a record with no ghost', async () => {
        const REC = `${TRACK}-record`
        await submitNrLap(A, REC, 25_000)
        await submitNrLap(B, REC, 26_000)
        expect(await nrRecordGhost(REC, B)).toBeNull()
        await saveNrGhost(B, REC, { ghost: ghostOf(26), standing: false })
        expect((await nrRecordGhost(REC, A))?.lapMs).toBe(26_000)
        await saveNrGhost(A, REC, { ghost: ghostOf(25), standing: false })
        expect(await nrRecordGhost(REC, B)).toMatchObject({ lapMs: 25_000, ghost: ghostOf(25), standing: false })
        expect(await nrRecordGhost(REC, A)).toBeNull()
    })
})
