import { requirePokemonAdmin } from '#server/utils/auth'
import { deleteSet } from '#server/utils/tcg/engine'

/**
 * Delete a print run and everything under it. Refused once a pack has sold —
 * every draft qualifies, a committed run only until its first sale.
 */
export default defineEventHandler(async (event) => {
    await requirePokemonAdmin(event)

    const body = await readBody(event)
    const setId = body?.setId
    if (typeof setId !== 'string' || !setId) throw createError({ statusCode: 400, statusMessage: 'Invalid setId' })

    return await deleteSet(setId)
})
