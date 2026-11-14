import { auth } from '#server/utils/auth'
import { worldPlots } from '#server/utils/gridworks'

export default defineEventHandler(async (event) => {
    const session = await auth.api.getSession({ headers: event.headers })
    if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    return { plots: await worldPlots() }
})
