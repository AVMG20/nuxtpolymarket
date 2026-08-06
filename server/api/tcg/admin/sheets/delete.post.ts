import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgSheet, tcgPackTemplate } from '#server/database/schema'
import { requirePokemonAdmin } from '#server/utils/auth'
import { lockSetForUpdate } from '#server/utils/tcg/engine'

export default defineEventHandler(async (event) => {
    await requirePokemonAdmin(event)

    const body = await readBody(event)
    const sheetId = body?.sheetId
    if (typeof sheetId !== 'string' || !sheetId) throw createError({ statusCode: 400, statusMessage: 'Invalid sheetId' })

    return await db.transaction(async (tx) => {
        const [sheet] = await tx.select().from(tcgSheet).where(eq(tcgSheet.id, sheetId))
        if (!sheet) throw createError({ statusCode: 404, statusMessage: 'Sheet not found' })

        // The set row lock serializes this against commitSet and every other
        // draft mutation — the status and template checks cannot go stale.
        const set = await lockSetForUpdate(tx, sheet.setId)
        if (set.status !== 'draft') {
            throw createError({ statusCode: 400, statusMessage: 'Set is committed and frozen' })
        }

        const templates = await tx.select().from(tcgPackTemplate).where(eq(tcgPackTemplate.setId, sheet.setId))
        const referenced = templates.some(template => template.slots.some(slot => slot.sheetId === sheetId))
        if (referenced) {
            throw createError({ statusCode: 400, statusMessage: 'Sheet is referenced by a pack template' })
        }

        await tx.delete(tcgSheet).where(eq(tcgSheet.id, sheetId))
        return { ok: true }
    })
})
