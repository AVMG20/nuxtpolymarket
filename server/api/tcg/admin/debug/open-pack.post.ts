import { requirePokemonAdmin } from '#server/utils/auth'
import { openPack } from '#server/utils/tcg/engine'

export default defineEventHandler(async (event) => {
    const userId = await requirePokemonAdmin(event)
    const body = await readBody(event).catch(() => null)
    const packId = body?.packId
    if (typeof packId !== 'string' || packId.length === 0) {
        throw createError({ statusCode: 400, statusMessage: 'packId is required' })
    }
    return await openPack(packId, userId)
})
