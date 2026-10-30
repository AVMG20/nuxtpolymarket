import { requireUserId } from '#server/utils/auth'
import { saveNrGhost, validGhost } from '#server/utils/nitro-rush'

/** A ghost to race on a course; answers whether it replaced the one kept. */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ trackId?: unknown, ghost?: unknown, standing?: unknown }>(event)
    const ghost = validGhost(body?.trackId, body?.ghost, body?.standing)
    if (!ghost) throw createError({ statusCode: 400, statusMessage: 'Invalid ghost' })
    return { kept: await saveNrGhost(userId, ghost.trackId, ghost) }
})
