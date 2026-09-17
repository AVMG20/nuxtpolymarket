import { requirePokemonAdmin } from '#server/utils/auth'
import { fetchPlaatjesChecklist } from '#server/utils/tcg/import'

/**
 * A sidecar set's checklist, mapped through the exact same card/printing
 * mapping the importer uses — and then thrown away. Read-only: nothing here
 * touches the database, so a harness can render any set's cards without
 * importing it.
 *
 * Because it is the importer's own mapping, what a harness renders is what
 * the set would actually look like once imported.
 */

// The rows are insert-shaped and therefore carry a setId. Nothing is written,
// so a fixed placeholder keeps the response stable across calls.
const PREVIEW_SET_ID = '00000000-0000-0000-0000-000000000000'

export default defineEventHandler(async (event) => {
    await requirePokemonAdmin(event)

    const setCode = getQuery(event).setCode
    if (typeof setCode !== 'string' || !setCode) {
        throw createError({ statusCode: 400, statusMessage: 'setCode is required' })
    }

    const config = useRuntimeConfig(event)
    // Throws 502 when the sidecar is down, 400 for an unknown/empty set.
    const { cardRows, printingRows } = await fetchPlaatjesChecklist(setCode, config.pokemonApiBase, PREVIEW_SET_ID)

    return { cards: cardRows, printings: printingRows }
})
