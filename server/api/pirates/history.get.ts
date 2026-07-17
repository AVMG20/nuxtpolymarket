import { desc, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { pirateRunHistory } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { pirateShipSkin } from '#shared/utils/gamelogic/pirates'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)

    const rows = await db
        .select()
        .from(pirateRunHistory)
        .where(eq(pirateRunHistory.userId, userId))
        .orderBy(desc(pirateRunHistory.createdAt))
        .limit(50)

    return rows.map((row, index) => {
        const skin = pirateShipSkin(row.skinId)
        return {
            ...row,
            recentNumber: index + 1,
            skin: { id: skin.id, name: skin.name, sprite: skin.sprite }
        }
    })
})
