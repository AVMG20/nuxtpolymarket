import { asc, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgSet, tcgCard, tcgPrinting, tcgSheet, tcgPackTemplate } from '#server/database/schema'
import { requirePokemonAdmin } from '#server/utils/auth'
import { serializeSet } from '#server/utils/tcg/engine'

export default defineEventHandler(async (event) => {
    await requirePokemonAdmin(event)

    const id = getQuery(event).id
    if (typeof id !== 'string' || !id) throw createError({ statusCode: 400, statusMessage: 'id is required' })

    const [set] = await db.select().from(tcgSet).where(eq(tcgSet.id, id))
    if (!set) throw createError({ statusCode: 404, statusMessage: 'Set not found' })

    const [cards, printings, sheets, templates] = await Promise.all([
        db.select().from(tcgCard).where(eq(tcgCard.setId, id)).orderBy(asc(tcgCard.sortOrder)),
        db.select().from(tcgPrinting).where(eq(tcgPrinting.setId, id)),
        db.select().from(tcgSheet).where(eq(tcgSheet.setId, id)).orderBy(asc(tcgSheet.sortOrder)),
        db.select().from(tcgPackTemplate).where(eq(tcgPackTemplate.setId, id))
    ])

    return {
        set: serializeSet(set),
        cards,
        printings,
        sheets,
        templates
    }
})
