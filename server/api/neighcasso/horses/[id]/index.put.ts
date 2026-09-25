import { and, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { neighcassoHorses } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { parseHorseBody, toHorse } from '#server/utils/neighcasso'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const { name, drawing } = parseHorseBody(await readBody(event))
    const [row] = await db.update(neighcassoHorses)
        .set({ name, drawing, updatedAt: new Date() })
        .where(and(eq(neighcassoHorses.id, getRouterParam(event, 'id') ?? ''), eq(neighcassoHorses.userId, userId)))
        .returning()
    if (!row) throw createError({ statusCode: 404, statusMessage: 'Horse not found' })
    return toHorse(row)
})
