import { desc, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { emblemHistory } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { EMBLEM_HISTORY_LIMIT } from '#shared/utils/emblem'

export default defineEventHandler(async (event) => {
    const session = await auth.api.getSession({ headers: event.headers })
    if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    return db
        .select({ id: emblemHistory.id, emblem: emblemHistory.emblem, createdAt: emblemHistory.createdAt })
        .from(emblemHistory)
        .where(eq(emblemHistory.userId, session.user.id))
        .orderBy(desc(emblemHistory.createdAt))
        .limit(EMBLEM_HISTORY_LIMIT)
})
