import { desc, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { voidRunHistory } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { voidSector, voidShip } from '#shared/utils/gamelogic/void'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)

    const rows = await db
        .select()
        .from(voidRunHistory)
        .where(eq(voidRunHistory.userId, userId))
        .orderBy(desc(voidRunHistory.createdAt))
        .limit(50)

    return rows.map((row, index) => ({
        ...row,
        recentNumber: index + 1,
        sectorName: voidSector(row.sector).name,
        shipName: voidShip(row.shipId).name
    }))
})
