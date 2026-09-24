import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#server/database'
import { holdfastRuns, user } from '#server/database/schema'
import {
    HOLDFAST_STALE_RUN_MS,
    finishHoldfastRun,
    holdfastPlayerState,
    holdfastRankings,
    startHoldfastRun
} from '#server/utils/holdfast'
import { HOLDFAST_WIN_MS, type HoldfastDifficulty, type HoldfastRunStats } from '#shared/utils/holdfast/meta'
import { burst, seedUser, SKIP } from '../setup/db-helpers'

const users = ['test-holdfast-a', 'test-holdfast-b', 'test-holdfast-c', 'test-holdfast-d']
const [a, b, c, d] = users as [string, string, string, string]
const stats: HoldfastRunStats = { kills: 10, packsDeployed: 2, buildingsBuilt: 5, wave: 4 }

async function cleanup() {
    await db.delete(user).where(inArray(user.id, users))
}

/** Pretend the run started `ms` ago, so the wall clock allows a real survival. */
async function backdate(runId: string, ms: number) {
    await db.update(holdfastRuns).set({ startedAt: new Date(Date.now() - ms) }).where(eq(holdfastRuns.id, runId))
}

/** A run that has been going long enough to survive anything, finished at `survivedMs`. */
async function playRun(userId: string, survivedMs: number, difficulty: HoldfastDifficulty = 'hard', won = false) {
    const run = await startHoldfastRun(userId, difficulty)
    await backdate(run.runId, HOLDFAST_WIN_MS)
    return finishHoldfastRun(userId, { runId: run.runId, survivedMs, won, stats })
}

async function getRun(runId: string) {
    const [row] = await db.select().from(holdfastRuns).where(eq(holdfastRuns.id, runId))
    return row!
}

describe.skipIf(SKIP)('holdfast runs', () => {
    beforeAll(async () => {
        await cleanup()
        for (const id of users) await seedUser(id)
    })

    afterAll(cleanup)

    it('starts a run with a seed on the chosen difficulty', async () => {
        const run = await startHoldfastRun(a, 'easy')
        expect(run.difficulty).toBe('easy')
        expect(Number.isInteger(run.seed)).toBe(true)
        expect(run.seed).toBeGreaterThanOrEqual(1)
        expect(run.seed).toBeLessThanOrEqual(2 ** 31 - 1)
        const row = await getRun(run.runId)
        expect(row.userId).toBe(a)
        expect(row.seed).toBe(run.seed)
        expect(row.finishedAt).toBeNull()
    })

    it('lets exactly one of a burst of parallel finishes through', async () => {
        const run = await startHoldfastRun(b, 'normal')
        await backdate(run.runId, 10 * 60 * 1000)
        const result = await burst(10, () => finishHoldfastRun(b, { runId: run.runId, survivedMs: 300_000, won: false, stats }))
        expect(result).toEqual({ ok: 1, rejected: 9 })
        const row = await getRun(run.runId)
        expect(row.survivedMs).toBe(300_000)
        expect(row.stats).toEqual(stats)
    })

    it('refuses to finish another player\'s run', async () => {
        const run = await startHoldfastRun(a, 'normal')
        await expect(finishHoldfastRun(b, { runId: run.runId, survivedMs: 1000, won: false, stats }))
            .rejects.toMatchObject({ statusCode: 404 })
        expect((await getRun(run.runId)).finishedAt).toBeNull()
    })

    it('clamps a survival the wall clock cannot allow', async () => {
        const run = await startHoldfastRun(c, 'easy')
        await backdate(run.runId, 60_000)
        const result = await finishHoldfastRun(c, { runId: run.runId, survivedMs: HOLDFAST_WIN_MS, won: true, stats })
        expect(result.clamped).toBe(true)
        expect(result.won).toBe(false)
        // 60s at 2x plus 5s of slack, give or take the time the test itself took.
        expect(result.survivedMs).toBeGreaterThanOrEqual(125_000)
        expect(result.survivedMs).toBeLessThan(135_000)
        const row = await getRun(run.runId)
        expect(row.clamped).toBe(true)
        expect(row.survivedMs).toBe(result.survivedMs)
    })

    it('only counts a win that survived the full clock', async () => {
        const short = await playRun(c, HOLDFAST_WIN_MS - 1, 'easy', true)
        expect(short.won).toBe(false)
        const full = await playRun(c, HOLDFAST_WIN_MS + 250, 'easy', true)
        expect(full).toMatchObject({ survivedMs: HOLDFAST_WIN_MS, won: true, clamped: false })
        const unclaimed = await playRun(c, HOLDFAST_WIN_MS, 'easy', false)
        expect(unclaimed.won).toBe(false)
    })

    it('closes stale open runs as abandoned when a new one starts', async () => {
        const stale = await startHoldfastRun(d, 'hard')
        await backdate(stale.runId, HOLDFAST_STALE_RUN_MS + 60_000)
        const recent = await startHoldfastRun(d, 'hard')
        await backdate(recent.runId, HOLDFAST_WIN_MS)
        await startHoldfastRun(d, 'hard')

        const abandoned = await getRun(stale.runId)
        expect(abandoned).toMatchObject({ abandoned: true, survivedMs: 0, won: false })
        expect(abandoned.finishedAt).not.toBeNull()
        expect((await getRun(recent.runId)).finishedAt).toBeNull()
        await expect(finishHoldfastRun(d, { runId: stale.runId, survivedMs: 1_000_000, won: false, stats }))
            .rejects.toMatchObject({ statusCode: 400 })
    })

    it('ranks each player once by their best run, earliest first on ties', async () => {
        await playRun(a, 100_000)
        const aBest = await playRun(a, 400_000)
        expect(aBest.clamped).toBe(false)
        await playRun(b, 400_000)
        await playRun(c, 900_000)
        await playRun(d, 50_000)

        // Make a's 400k the earlier of the two tied bests.
        await db.update(holdfastRuns)
            .set({ finishedAt: new Date(Date.now() - 3_600_000) })
            .where(and(eq(holdfastRuns.userId, a), eq(holdfastRuns.difficulty, 'hard'), eq(holdfastRuns.survivedMs, 400_000)))

        const { entries, me } = await holdfastRankings(db, 'hard', a, 100_000)
        const ours = entries.filter(e => e.name === 'concurrency test user')
        expect(ours.map(e => e.survivedMs)).toEqual([900_000, 400_000, 400_000, 50_000])
        for (let i = 1; i < ours.length; i++) expect(ours[i]!.rank).toBeGreaterThan(ours[i - 1]!.rank)
        expect(ours.filter(e => e.isCurrentUser)).toHaveLength(1)
        expect(ours[1]!.isCurrentUser).toBe(true)
        expect(me).toEqual({ best: 400_000, rank: ours[1]!.rank })

        // A player outside the top slice still gets their standing.
        const sliced = await holdfastRankings(db, 'hard', d, 0)
        expect(sliced.entries).toEqual([])
        expect(sliced.me).toEqual({ best: 50_000, rank: ours[3]!.rank })

        // Signed out: no standing.
        expect((await holdfastRankings(db, 'hard', null, 0)).me).toBeNull()

        // Difficulties are separate boards; a's normal run was never finished.
        expect((await holdfastRankings(db, 'normal', a, 100_000)).me).toBeNull()
    })

    it('reports the best and rank from finish-run', async () => {
        const result = await playRun(d, 10_000)
        const board = await holdfastRankings(db, 'hard', d, 100_000)
        expect(result.best).toBe(50_000)
        expect(result.rank).toBe(board.me!.rank)
    })

    it('summarises a player\'s bests and runs', async () => {
        const state = await holdfastPlayerState(c)
        expect(state.bests.easy).toEqual({ survivedMs: HOLDFAST_WIN_MS, won: true })
        expect(state.bests.hard).toEqual({ survivedMs: 900_000, won: false })
        expect(state.bests.normal).toBeNull()
        // The clamped run and three more on easy, one on hard.
        expect(state.runs).toBe(5)

        // Abandoned and open runs are not runs played.
        expect((await holdfastPlayerState(d)).runs).toBe(2)

        const fresh = await holdfastPlayerState('test-holdfast-nobody')
        expect(fresh).toEqual({ bests: { easy: null, normal: null, hard: null }, runs: 0 })
    })
})
