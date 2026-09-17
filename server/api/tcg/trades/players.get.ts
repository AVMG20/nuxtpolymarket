import { ne } from 'drizzle-orm'
import { db } from '#server/database'
import { user } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'

/** Everyone you could trade with — a seven-player game has no privacy tier. */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    return await db.select({ id: user.id, name: user.name }).from(user)
        .where(ne(user.id, userId))
        .orderBy(user.name)
        .limit(50)
})
