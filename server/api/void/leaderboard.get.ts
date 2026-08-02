import { desc, eq, gt } from 'drizzle-orm'
import { db } from '#server/database'
import { getSessionUserId } from '#server/utils/auth'
import { user, voidState } from '#server/database/schema'
import { voidSector, voidShip } from '#shared/utils/gamelogic/void'

export default defineEventHandler(async (event) => {
    const sessionUserId = await getSessionUserId(event)

    const rows = await db
        .select({
            userId: user.id,
            name: user.name,
            sector: voidState.highestSectorExtracted,
            bestCredits: voidState.bestRunCredits,
            bestUnits: voidState.bestRunUnits,
            bestSector: voidState.bestRunSector,
            extractions: voidState.extractions,
            shipId: voidState.equippedShipId
        })
        .from(voidState)
        .innerJoin(user, eq(user.id, voidState.userId))
        .where(gt(voidState.extractions, 0))
        .orderBy(desc(voidState.highestSectorExtracted), desc(voidState.bestRunCredits))
        .limit(50)

    return rows.map((row, index) => ({
        rank: index + 1,
        isCurrentUser: row.userId === sessionUserId,
        name: row.name,
        sector: row.sector,
        sectorName: voidSector(Math.max(1, row.sector)).name,
        bestCredits: row.bestCredits,
        bestUnits: row.bestUnits,
        bestSectorName: voidSector(Math.max(1, row.bestSector)).name,
        extractions: row.extractions,
        shipName: voidShip(row.shipId).name
    }))
})
