import { requirePokemonAdmin } from '#server/utils/auth'
import { buyPack, serializePack } from '#server/utils/tcg/engine'

export default defineEventHandler(async (event) => {
    const userId = await requirePokemonAdmin(event)
    const body = await readBody(event).catch(() => null)
    const setId = body?.setId
    if (typeof setId !== 'string' || setId.length === 0) {
        throw createError({ statusCode: 400, statusMessage: 'setId is required' })
    }
    const pack = await buyPack(setId, userId)
    return serializePack(pack, true)
})
