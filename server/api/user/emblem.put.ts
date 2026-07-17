import { desc, eq, inArray } from 'drizzle-orm'
import { db } from '#server/database'
import { emblemHistory, user } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { EMBLEM_HISTORY_LIMIT, serializeEmblem } from '#shared/utils/emblem'

export default defineEventHandler(async (event) => {
    const session = await auth.api.getSession({ headers: event.headers })
    if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    const body = await readBody<{ emblem?: unknown }>(event)
    const emblem = serializeEmblem(body?.emblem)
    if (!emblem) throw createError({ statusCode: 400, statusMessage: 'Invalid emblem' })

    const userId = session.user.id
    const historyId = await db.transaction(async (tx) => {
        await tx.update(user).set({ emblem }).where(eq(user.id, userId))

        const [inserted] = await tx
            .insert(emblemHistory)
            .values({ userId, emblem })
            .returning({ id: emblemHistory.id })

        const stale = await tx
            .select({ id: emblemHistory.id })
            .from(emblemHistory)
            .where(eq(emblemHistory.userId, userId))
            .orderBy(desc(emblemHistory.createdAt))
            .offset(EMBLEM_HISTORY_LIMIT)
        if (stale.length) {
            await tx.delete(emblemHistory).where(inArray(emblemHistory.id, stale.map(row => row.id)))
        }

        return inserted!.id
    })

    return { emblem, historyId }
})
