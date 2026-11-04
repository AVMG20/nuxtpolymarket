import { auth } from '#server/utils/auth'
import { rtWorldAvatars } from '#server/utils/rail-tycoon/registry'

/** The drawings of the worlds the player owns or has joined, by world id. Too large for the socket's world list. */
export default defineEventHandler(async (event) => {
    const session = await auth.api.getSession({ headers: event.headers })
    if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    return { avatars: await rtWorldAvatars(session.user.id) }
})
