import { desc, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { pirateRunHistory } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { pirateShipSkin } from '#shared/utils/gamelogic/pirates'

export default defineEventHandler(async (event) => {
    const session = await auth.api.getSession({ headers: event.headers })
    if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    const rows = await db
        .select()
        .from(pirateRunHistory)
        .where(eq(pirateRunHistory.userId, session.user.id))
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
