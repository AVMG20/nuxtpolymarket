import { requireUserId } from '#server/utils/auth'
import { markTutorialSeen } from '#server/utils/hero-quest-tutorials'
import { isTutorialRecord } from '#shared/utils/hero-quest/tutorials'

/** The guide's tutorial `id` was read, or a silent mark like a boss lost was reached (`tutorials.ts`). */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ id?: unknown }>(event)
    if (!isTutorialRecord(body?.id)) throw createError({ statusCode: 400, statusMessage: 'Unknown tutorial' })
    await markTutorialSeen(userId, body.id)
    return { id: body.id }
})
