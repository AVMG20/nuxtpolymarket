import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { user } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'

/** Public player basics for the profile page — name and emblem, nothing financial. */
export default defineEventHandler(async (event) => {
    await requireUserId(event)
    const playerId = getRouterParam(event, 'id')
    if (!playerId) throw createError({ statusCode: 400, statusMessage: 'id is required' })
    const [row] = await db.select({ id: user.id, name: user.name, emblem: user.emblem })
        .from(user).where(eq(user.id, playerId))
    if (!row) throw createError({ statusCode: 404, statusMessage: 'Player not found' })
    return row
})
