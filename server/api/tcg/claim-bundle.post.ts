import { requireUserId } from '#server/utils/auth'
import { serializePack } from '#server/utils/tcg/engine'
import { claimBundle } from '#server/utils/tcg/player'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ setId?: unknown }>(event)
    if (typeof body?.setId !== 'string' || !body.setId) {
        throw createError({ statusCode: 400, statusMessage: 'setId is required' })
    }

    const { bundle, packs } = await claimBundle(body.setId, userId)
    return {
        bundle: {
            id: bundle.id,
            setId: bundle.setId,
            weekKey: bundle.weekKey,
            createdAt: bundle.createdAt.toISOString()
        },
        packs: packs.map(pack => serializePack(pack))
    }
})
