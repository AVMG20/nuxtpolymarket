import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { user } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { serializeEmblem } from '#shared/utils/emblem'

export default defineEventHandler(async (event) => {
    const session = await auth.api.getSession({ headers: event.headers })
    if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    const body = await readBody<{ emblem?: unknown }>(event)
    const emblem = serializeEmblem(body?.emblem)
    if (!emblem) throw createError({ statusCode: 400, statusMessage: 'Invalid emblem' })

    await db
        .update(user)
        .set({ emblem })
        .where(eq(user.id, session.user.id))

    return { emblem }
})
