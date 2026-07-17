import { desc, eq, gte } from 'drizzle-orm'
import { db } from '#server/database'
import { auth } from '#server/utils/auth'
import { pirateState, user } from '#server/database/schema'
import { PIRATE_RUN_DURATION_MS, pirateShipSkin } from '#shared/utils/gamelogic/pirates'

export default defineEventHandler(async (event) => {
    const session = await auth.api.getSession({ headers: event.headers })
    const rows = await db
        .select({
            userId: user.id,
            name: user.name,
            difficulty: pirateState.highestCompletedDifficulty,
            power: pirateState.bestCompletedPower,
            loot: pirateState.bestCompletedLoot,
            skinId: pirateState.bestCompletedSkinId
        })
        .from(pirateState)
        .innerJoin(user, eq(user.id, pirateState.userId))
        .where(gte(pirateState.highestCompletedDifficulty, 0))
        .orderBy(desc(pirateState.highestCompletedDifficulty), desc(pirateState.bestCompletedLoot))
        .limit(50)

    return rows.map((row, index) => {
        const skin = pirateShipSkin(row.skinId)
        return {
            rank: index + 1,
            isCurrentUser: row.userId === session?.user?.id,
            name: row.name,
            durationMs: PIRATE_RUN_DURATION_MS,
            difficulty: row.difficulty,
            power: row.power,
            loot: row.loot,
            skin: { id: skin.id, name: skin.name, sprite: skin.sprite }
        }
    })
})
