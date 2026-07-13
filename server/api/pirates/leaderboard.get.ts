import { desc, eq, gt } from 'drizzle-orm'
import { db } from '#server/database'
import { pirateState, user } from '#server/database/schema'
import { pirateShipSkin } from '#shared/utils/gamelogic/pirates'

export default defineEventHandler(async () => {
    const rows = await db
        .select({
            userId: user.id,
            name: user.name,
            durationMs: pirateState.bestSurvivalMs,
            power: pirateState.bestRunPower,
            loot: pirateState.bestRunLoot,
            skinId: pirateState.equippedSkinId
        })
        .from(pirateState)
        .innerJoin(user, eq(user.id, pirateState.userId))
        .where(gt(pirateState.bestSurvivalMs, 0))
        .orderBy(desc(pirateState.bestSurvivalMs), desc(pirateState.bestRunLoot))
        .limit(50)

    return rows.map((row, index) => {
        const skin = pirateShipSkin(row.skinId)
        return {
            rank: index + 1,
            userId: row.userId,
            name: row.name,
            durationMs: row.durationMs,
            power: row.power,
            loot: row.loot,
            skin: { id: skin.id, name: skin.name, sprite: skin.sprite }
        }
    })
})
