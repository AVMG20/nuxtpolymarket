import { requireUserId } from '#server/utils/auth'
import { dismissAwayReport } from '#server/utils/hero-quest'

/** The welcome-back card `id` was put away. Pays nothing, so a repeat or a stale id is harmless. */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ id?: unknown }>(event)
    if (typeof body?.id !== 'string') throw createError({ statusCode: 400, statusMessage: 'Missing report id' })
    await dismissAwayReport(userId, body.id)
    return { id: body.id }
})
