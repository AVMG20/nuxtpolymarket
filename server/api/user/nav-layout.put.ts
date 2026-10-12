import { db } from '#server/database'
import { userNavLayout } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { parseNavLayout } from '#shared/utils/nav-layout'

export default defineEventHandler(async (event) => {
    const session = await auth.api.getSession({ headers: event.headers })
    if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    const body = await readBody<{ layout?: unknown }>(event)
    const layout = parseNavLayout(body?.layout)
    if (!layout) throw createError({ statusCode: 400, statusMessage: 'Invalid layout' })

    await db
        .insert(userNavLayout)
        .values({ userId: session.user.id, layout })
        .onConflictDoUpdate({ target: userNavLayout.userId, set: { layout, updatedAt: new Date() } })

    return { layout }
})
