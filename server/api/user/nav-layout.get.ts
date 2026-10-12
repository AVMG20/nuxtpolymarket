import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { userNavLayout } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { parseNavLayout } from '#shared/utils/nav-layout'

export default defineEventHandler(async (event) => {
    const session = await auth.api.getSession({ headers: event.headers })
    if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    const [row] = await db
        .select({ layout: userNavLayout.layout })
        .from(userNavLayout)
        .where(eq(userNavLayout.userId, session.user.id))

    return { layout: row ? parseNavLayout(row.layout) : null }
})
