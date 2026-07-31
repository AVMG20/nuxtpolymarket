import { and, desc, eq, gt } from 'drizzle-orm'
import { db } from '#server/database'
import { pathwardenState, user } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const rows = await db.select({
        userId: pathwardenState.userId,
        name: user.name,
        emblem: user.emblem,
        completedRealm: pathwardenState.highestCompletedRealm,
        bestRealm: pathwardenState.bestRealm,
        bestWave: pathwardenState.bestWave,
        bestScore: pathwardenState.bestScore,
        bestFlawless: pathwardenState.bestFlawless,
        runsPlayed: pathwardenState.runsPlayed,
        totalCoinsEarned: pathwardenState.totalCoinsEarned
    })
        .from(pathwardenState)
        .innerJoin(user, eq(pathwardenState.userId, user.id))
        .where(and(gt(pathwardenState.runsPlayed, 0), gt(pathwardenState.bestWave, 0)))
        .orderBy(
            desc(pathwardenState.highestCompletedRealm),
            desc(pathwardenState.bestRealm),
            desc(pathwardenState.bestWave),
            desc(pathwardenState.bestScore)
        )
        .limit(100)

    return {
        entries: rows.map((row, index) => ({
            rank: index + 1,
            ...row,
            totalCoinsEarned: Number(row.totalCoinsEarned),
            isCurrentUser: row.userId === userId
        }))
    }
})
