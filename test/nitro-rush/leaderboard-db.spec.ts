import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SKIP, cleanupUser, seedUser } from '../setup/db-helpers'
import { nrLeaderboard, submitNrLap, validLap } from '#server/utils/nitro-rush'

const tag = Date.now().toString(36)
const A = `nr-a-${tag}`
const B = `nr-b-${tag}`
// A course id of its own, so other runs' rows never shift the ranks.
const TRACK = `nr-test-${tag}`

describe('lap validation', () => {
    it('accepts a real lap and refuses unknown courses, odd values and impossible times', () => {
        expect(validLap('polytown-oval', 22_400)).toEqual({ trackId: 'polytown-oval', lapMs: 22_400 })
        expect(validLap('nowhere', 22_400)).toBeNull()
        expect(validLap('polytown-oval', 22.4)).toBeNull()
        expect(validLap('polytown-oval', '22400')).toBeNull()
        expect(validLap('polytown-oval', 5_000)).toBeNull()
        expect(validLap('polytown-oval', 31 * 60 * 1000)).toBeNull()
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
})
