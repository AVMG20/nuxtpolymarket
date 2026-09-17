import { requireUserId } from '#server/utils/auth'
import { openPack } from '#server/utils/tcg/engine'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ packId?: unknown }>(event)
    if (typeof body?.packId !== 'string' || !body.packId) {
        throw createError({ statusCode: 400, statusMessage: 'packId is required' })
    }

    // OpenedPackResult carries no condition data by construction (§6.1).
    return await openPack(body.packId, userId)
})
