import { and, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { neighcassoHorses } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const [row] = await db.delete(neighcassoHorses)
        .where(and(eq(neighcassoHorses.id, getRouterParam(event, 'id') ?? ''), eq(neighcassoHorses.userId, userId)))
        .returning({ id: neighcassoHorses.id })
    if (!row) throw createError({ statusCode: 404, statusMessage: 'Horse not found' })
    return { ok: true }
})
