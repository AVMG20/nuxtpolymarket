import { desc, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { voidRunHistory } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    return db.select().from(voidRunHistory)
        .where(eq(voidRunHistory.userId, userId))
        .orderBy(desc(voidRunHistory.createdAt))
        .limit(20)
})
