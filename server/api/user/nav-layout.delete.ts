import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { userNavLayout } from '#server/database/schema'
import { auth } from '#server/utils/auth'

export default defineEventHandler(async (event) => {
    const session = await auth.api.getSession({ headers: event.headers })
    if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    await db.delete(userNavLayout).where(eq(userNavLayout.userId, session.user.id))
    return { layout: null }
})
