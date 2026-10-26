import { auth } from '#server/utils/auth'
import { resetNavLayout } from '#server/utils/nav-layout'

export default defineEventHandler(async (event) => {
    const session = await auth.api.getSession({ headers: event.headers })
    if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    return { layout: null, revision: await resetNavLayout(session.user.id) }
})
