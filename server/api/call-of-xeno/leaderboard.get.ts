import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { getSessionUserId } from '#server/utils/auth'
import { callOfXenoState, user } from '#server/database/schema'
import { callOfXenoDifficultyRank } from '#shared/utils/gamelogic/call-of-xeno-meta'

/**
 * Best run per player, ranked hardest difficulty first, then deepest round,
 * then shortest time at the same depth.
 */
export default defineEventHandler(async (event) => {
    const sessionUserId = await getSessionUserId(event)
    const rows = await db
        .select({
            userId: user.id,
            name: user.name,
            rounds: callOfXenoState.bestRunRounds,
            durationSeconds: callOfXenoState.bestRunDurationSeconds,
            difficulty: callOfXenoState.bestRunDifficulty
        })
        .from(callOfXenoState)
        .innerJoin(user, eq(user.id, callOfXenoState.userId))
        .limit(200)

    return rows
        .filter(row => row.rounds > 0 && callOfXenoDifficultyRank(row.difficulty ?? '') >= 0)
        .sort((a, b) => {
            const rank = callOfXenoDifficultyRank(b.difficulty!) - callOfXenoDifficultyRank(a.difficulty!)
            if (rank !== 0) return rank
            if (a.rounds !== b.rounds) return b.rounds - a.rounds
            return a.durationSeconds - b.durationSeconds
        })
        .slice(0, 50)
        .map((row, index) => ({
            rank: index + 1,
            isCurrentUser: row.userId === sessionUserId,
            name: row.name,
            rounds: row.rounds,
            durationSeconds: row.durationSeconds,
            difficulty: row.difficulty!
        }))
})
