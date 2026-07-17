import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { emblemHistory, user } from '#server/database/schema'

export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id') ?? ''

    const [row] = await db
        .select({ emblem: emblemHistory.emblem, name: user.name })
        .from(emblemHistory)
        .innerJoin(user, eq(user.id, emblemHistory.userId))
        .where(eq(emblemHistory.id, id))
        .limit(1)

    if (!row) throw createError({ statusCode: 404, statusMessage: 'Shared emblem not found' })

    return row
})
