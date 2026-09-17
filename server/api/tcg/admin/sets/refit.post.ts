import { requirePokemonAdmin } from '#server/utils/auth'
import { refitSet } from '#server/utils/tcg/engine'

/**
 * Reset a template-created draft to the automatic fit, discarding hand-authored
 * sheets and pack templates. Refits from the imported checklist — re-import
 * first if the sidecar's card list has changed.
 */
export default defineEventHandler(async (event) => {
    await requirePokemonAdmin(event)

    const body = await readBody(event)
    const setId = body?.setId
    if (typeof setId !== 'string' || !setId) throw createError({ statusCode: 400, statusMessage: 'Invalid setId' })

    return await refitSet(setId)
})
