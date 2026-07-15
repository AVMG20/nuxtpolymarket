import type { H3Event } from 'h3'
import { auth } from '#server/utils/auth'

export async function requireAiUser(event: H3Event) {
    const session = await auth.api.getSession({ headers: event.headers })
    if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    return session.user
}
