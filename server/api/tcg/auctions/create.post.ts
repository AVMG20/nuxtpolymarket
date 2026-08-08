import { requireUserId } from '#server/utils/auth'
import { createAuction } from '#server/utils/tcg/auction'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const copyId = typeof body?.copyId === 'string' ? body.copyId : null
    const packId = typeof body?.packId === 'string' ? body.packId : null
    if (!copyId === !packId) {
        throw createError({ statusCode: 400, statusMessage: 'Exactly one of copyId or packId is required' })
    }
    return await createAuction(
        userId,
        copyId ? { kind: 'copy', copyId } : { kind: 'pack', packId: packId! },
        Number(body?.startPrice),
        Number(body?.durationMs)
    )
})
