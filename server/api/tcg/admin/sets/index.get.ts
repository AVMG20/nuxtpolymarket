import { desc } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgSet } from '#server/database/schema'
import { requirePokemonAdmin } from '#server/utils/auth'
import { serializeSet } from '#server/utils/tcg/engine'

export default defineEventHandler(async (event) => {
    await requirePokemonAdmin(event)

    const sets = await db.select().from(tcgSet).orderBy(desc(tcgSet.createdAt))
    // The list stays lean: drop the full scraped rate template blob — the
    // detail endpoint serves it for the one set being viewed.
    return sets.map((set) => {
        const { publishedRates: _publishedRates, ...rest } = serializeSet(set)
        return rest
    })
})
