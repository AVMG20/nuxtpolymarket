import { auth } from '#server/utils/auth'
import { viewPlot } from '#server/utils/gridworks'

export default defineEventHandler(async (event) => {
    const session = await auth.api.getSession({ headers: event.headers })
    if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    const state = await viewPlot(session.user.id)
    return { state, userId: session.user.id, now: Date.now() }
})
