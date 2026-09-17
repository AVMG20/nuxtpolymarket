import { desc, eq, gt } from 'drizzle-orm'
import { db } from '#server/database'
import { user, voidState } from '#server/database/schema'
import { getSessionUserId } from '#server/utils/auth'
import { voidShip } from '#shared/utils/gamelogic/void'

export default defineEventHandler(async (event) => {
    const sessionUserId = await getSessionUserId(event)
    const rows = await db
        .select({
            userId: user.id,
            name: user.name,
            cleared: voidState.highestSectorCleared,
            bestHaulValue: voidState.bestHaulValue,
            kills: voidState.kills,
            shipId: voidState.equippedShipId
        })
        .from(voidState)
        .innerJoin(user, eq(user.id, voidState.userId))
        .where(gt(voidState.runsPlayed, 0))
        .orderBy(desc(voidState.highestSectorCleared), desc(voidState.bestHaulValue))
        .limit(25)
    return rows.map((row, i) => ({
        rank: i + 1,
        name: row.name,
        cleared: row.cleared,
        bestHaulValue: row.bestHaulValue,
        kills: row.kills,
        shipName: voidShip(row.shipId).name,
        isCurrentUser: row.userId === sessionUserId
    }))
})
