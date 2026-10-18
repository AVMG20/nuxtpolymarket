import { auth } from '#server/utils/auth'
import { getDfProfile } from '#server/utils/dead-front-profile'

export default defineEventHandler(async (event) => {
    const session = await auth.api.getSession({ headers: event.headers })
    if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    return getDfProfile(session.user.id)
})
