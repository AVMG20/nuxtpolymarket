import { requirePokemonAdmin } from '#server/utils/auth'
import { commitSet } from '#server/utils/tcg/engine'

export default defineEventHandler(async (event) => {
    await requirePokemonAdmin(event)

    const body = await readBody(event)
    const setId = body?.setId
    if (typeof setId !== 'string' || !setId) throw createError({ statusCode: 400, statusMessage: 'Invalid setId' })

    return await commitSet(setId)
})
