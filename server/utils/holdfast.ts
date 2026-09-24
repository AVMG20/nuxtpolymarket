import { and, asc, count, desc, eq, gt, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm'
import { db, type DbExecutor } from '#server/database'
import { holdfastRuns, user } from '#server/database/schema'
import { randomInt } from '#shared/utils/random'
import {
    HOLDFAST_DIFFICULTIES,
    HOLDFAST_WIN_MS,
    holdfastIsDifficulty,
    holdfastMaxPlausibleSurvival,
    type HoldfastDifficulty,
    type HoldfastRunStats
} from '#shared/utils/holdfast/meta'

/**
 * An open run older than this is a tab the player walked away from. Starting
 * a new run closes it as abandoned so open runs don't pile up. Generous on
 * purpose: a backgrounded tab can stall the sim well past the 25 minute
 * clock, and closing a run the player is still in would lose its finish.
 */
export const HOLDFAST_STALE_RUN_MS = 2 * 60 * 60 * 1000

export const HOLDFAST_LEADERBOARD_SIZE = 25

const SEED_MAX = 2 ** 31 - 1

export interface HoldfastStartResult {
    runId: string
    seed: number
    difficulty: HoldfastDifficulty
}

export interface HoldfastFinishReport {
    runId: string
    survivedMs: number
    won: boolean
    stats: HoldfastRunStats
}

export interface HoldfastFinishResult {
    survivedMs: number
    won: boolean
    /** The reported survival beat the wall clock and was cut down to what it allowed. */
    clamped: boolean
    best: number | null
    rank: number | null
}

export interface HoldfastLeaderboardEntry {
    rank: number
    name: string
    emblem: string | null
    prestige: number
    survivedMs: number
    won: boolean
    isCurrentUser: boolean
}

export interface HoldfastStanding {
    best: number
    rank: number
}

export interface HoldfastBest {
    survivedMs: number
    won: boolean
}

export interface HoldfastPlayerState {
    bests: Record<HoldfastDifficulty, HoldfastBest | null>
    runs: number
}

/** Runs that count: finished through finish-run (not abandoned) and survived at all. */
function countedRuns() {
    return and(
        isNotNull(holdfastRuns.finishedAt),
        eq(holdfastRuns.abandoned, false),
        gt(holdfastRuns.survivedMs, 0)
    )
}

export async function startHoldfastRun(userId: string, difficulty: HoldfastDifficulty): Promise<HoldfastStartResult> {
    const now = new Date()
    // Close this player's own dead runs. Racing a finish on the same row is
    // safe: the finish holds the row lock, and this UPDATE re-checks
    // `finished_at IS NULL` once it gets the row, so it never clobbers one.
    await db.update(holdfastRuns)
        .set({ finishedAt: now, survivedMs: 0, abandoned: true })
        .where(and(
            eq(holdfastRuns.userId, userId),
            isNull(holdfastRuns.finishedAt),
            lt(holdfastRuns.startedAt, new Date(now.getTime() - HOLDFAST_STALE_RUN_MS))
        ))

    const seed = randomInt(1, SEED_MAX)
    const [run] = await db.insert(holdfastRuns)
        .values({ userId, difficulty, seed, startedAt: now })
        .returning({ id: holdfastRuns.id })
    return { runId: run!.id, seed, difficulty }
}

/**
 * Records a finished run. The row lock serialises parallel finishes and the
 * conditional `finished_at IS NULL` update is the claim: the second request
 * finds the run already finished and throws.
 *
 * The client runs the sim, so the reported survival is capped by what the
 * wall clock since start-run allows at the maximum sim speed.
 */
export async function finishHoldfastRun(userId: string, report: HoldfastFinishReport): Promise<HoldfastFinishResult> {
    return db.transaction(async (tx) => {
        const [run] = await tx.select().from(holdfastRuns)
            .where(and(eq(holdfastRuns.id, report.runId), eq(holdfastRuns.userId, userId)))
            .for('update')
        if (!run) throw createError({ statusCode: 404, statusMessage: 'Holdfast run not found' })
        if (run.finishedAt) throw createError({ statusCode: 400, statusMessage: 'Holdfast run already finished' })
        const difficulty = run.difficulty
        if (!holdfastIsDifficulty(difficulty)) throw createError({ statusCode: 400, statusMessage: 'Invalid Holdfast run' })

        const finishedAt = new Date()
        const realElapsedMs = finishedAt.getTime() - run.startedAt.getTime()
        // Overshooting the win clock by a frame is normal, not suspicious.
        const reported = Math.min(HOLDFAST_WIN_MS, Math.max(0, Math.floor(report.survivedMs)))
        const survivedMs = Math.min(reported, holdfastMaxPlausibleSurvival(realElapsedMs))
        const clamped = survivedMs < reported
        const won = report.won && survivedMs >= HOLDFAST_WIN_MS

        const [claimed] = await tx.update(holdfastRuns)
            .set({ finishedAt, survivedMs, won, clamped, stats: report.stats })
            .where(and(
                eq(holdfastRuns.id, run.id),
                eq(holdfastRuns.userId, userId),
                isNull(holdfastRuns.finishedAt)
            ))
            .returning({ id: holdfastRuns.id })
        if (!claimed) throw createError({ statusCode: 400, statusMessage: 'Holdfast run already finished' })

        const { me } = await holdfastRankings(tx, difficulty, userId, 0)
        return { survivedMs, won, clamped, best: me?.best ?? null, rank: me?.rank ?? null }
    })
}

/**
 * Leaderboard for one difficulty: every player's best counted run (ties go
 * to whoever set it first), ranked. Returns the top `limit` rows plus the
 * given player's own standing, in one query.
 */
export async function holdfastRankings(
    executor: DbExecutor,
    difficulty: HoldfastDifficulty,
    userId: string | null,
    limit = HOLDFAST_LEADERBOARD_SIZE
): Promise<{ entries: HoldfastLeaderboardEntry[], me: HoldfastStanding | null }> {
    const bests = db.selectDistinctOn([holdfastRuns.userId], {
        userId: holdfastRuns.userId,
        survivedMs: holdfastRuns.survivedMs,
        won: holdfastRuns.won,
        finishedAt: holdfastRuns.finishedAt
    })
        .from(holdfastRuns)
        .where(and(eq(holdfastRuns.difficulty, difficulty), countedRuns()))
        .orderBy(holdfastRuns.userId, desc(holdfastRuns.survivedMs), asc(holdfastRuns.finishedAt), asc(holdfastRuns.id))
        .as('holdfast_bests')

    const ranked = db.select({
        userId: bests.userId,
        survivedMs: bests.survivedMs,
        won: bests.won,
        rank: sql<number>`(row_number() over (order by ${bests.survivedMs} desc, ${bests.finishedAt} asc, ${bests.userId} asc))::int`.as('rank')
    })
        .from(bests)
        .as('holdfast_ranked')

    const rows = await executor.select({
        userId: ranked.userId,
        survivedMs: ranked.survivedMs,
        won: ranked.won,
        rank: ranked.rank,
        name: user.name,
        emblem: user.emblem,
        prestige: user.prestige
    })
        .from(ranked)
        .innerJoin(user, eq(user.id, ranked.userId))
        .where(userId ? or(lte(ranked.rank, limit), eq(ranked.userId, userId)) : lte(ranked.rank, limit))
        .orderBy(asc(ranked.rank))

    let me: HoldfastStanding | null = null
    const entries: HoldfastLeaderboardEntry[] = []
    for (const row of rows) {
        const rank = Number(row.rank)
        const survivedMs = row.survivedMs ?? 0
        const isCurrentUser = row.userId === userId
        if (isCurrentUser) me = { best: survivedMs, rank }
        if (rank > limit) continue
        entries.push({
            rank,
            name: row.name,
            emblem: row.emblem,
            prestige: row.prestige ?? 0,
            survivedMs,
            won: row.won,
            isCurrentUser
        })
    }
    return { entries, me }
}

export async function holdfastPlayerState(userId: string): Promise<HoldfastPlayerState> {
    const bestRows = await db.selectDistinctOn([holdfastRuns.difficulty], {
        difficulty: holdfastRuns.difficulty,
        survivedMs: holdfastRuns.survivedMs,
        won: holdfastRuns.won
    })
        .from(holdfastRuns)
        .where(and(eq(holdfastRuns.userId, userId), countedRuns()))
        .orderBy(holdfastRuns.difficulty, desc(holdfastRuns.survivedMs), asc(holdfastRuns.finishedAt))

    const [played] = await db.select({ runs: count() })
        .from(holdfastRuns)
        .where(and(
            eq(holdfastRuns.userId, userId),
            isNotNull(holdfastRuns.finishedAt),
            eq(holdfastRuns.abandoned, false)
        ))

    const bests = Object.fromEntries(HOLDFAST_DIFFICULTIES.map(d => [d, null])) as Record<HoldfastDifficulty, HoldfastBest | null>
    for (const row of bestRows) {
        if (!holdfastIsDifficulty(row.difficulty)) continue
        bests[row.difficulty] = { survivedMs: row.survivedMs ?? 0, won: row.won }
    }
    return { bests, runs: played?.runs ?? 0 }
}
