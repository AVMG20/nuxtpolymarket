import { requireUserId } from '#server/utils/auth'
import { serializePack } from '#server/utils/tcg/engine'
import { playerBuyPacks } from '#server/utils/tcg/player'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ setId?: unknown, pairs?: unknown }>(event)
    if (typeof body?.setId !== 'string' || !body.setId) {
        throw createError({ statusCode: 400, statusMessage: 'setId is required' })
    }
    if (typeof body.pairs !== 'number') {
        throw createError({ statusCode: 400, statusMessage: 'pairs is required' })
    }

    const packs = await playerBuyPacks(body.setId, userId, body.pairs)
    // serializePack default: sealed packs never leak isGod.
    return { packs: packs.map(pack => serializePack(pack)) }
})
