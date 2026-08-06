import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgSheet, tcgPackTemplate } from '#server/database/schema'
import { requirePokemonAdmin } from '#server/utils/auth'
import { lockSetForUpdate } from '#server/utils/tcg/engine'
import type { TcgPackTemplateSlot } from '#shared/types/tcg-db'

export default defineEventHandler(async (event) => {
    await requirePokemonAdmin(event)

    const body = await readBody(event)
    const setId = body?.setId
    const kind = body?.kind
    const slots = body?.slots

    if (typeof setId !== 'string' || !setId) throw createError({ statusCode: 400, statusMessage: 'Invalid setId' })
    if (kind !== 'base' && kind !== 'god') throw createError({ statusCode: 400, statusMessage: 'Invalid kind' })
    if (!Array.isArray(slots) || slots.some(slot =>
        typeof slot?.sheetId !== 'string' || !slot.sheetId
        || !Number.isInteger(slot?.count) || slot.count < 1
    )) {
        throw createError({ statusCode: 400, statusMessage: 'slots must be an array of { sheetId, count }' })
    }

    return await db.transaction(async (tx) => {
        // The set row lock serializes this against commitSet and every other
        // draft mutation — the status check below cannot go stale.
        const set = await lockSetForUpdate(tx, setId)
        if (set.status !== 'draft') throw createError({ statusCode: 400, statusMessage: 'Set is committed and frozen' })

        const sheets = await tx.select().from(tcgSheet).where(eq(tcgSheet.setId, setId))
        const sheetById = new Map(sheets.map(sheet => [sheet.id, sheet]))

        const cleanSlots: TcgPackTemplateSlot[] = []
        const seenSheetIds = new Set<string>()
        for (const slot of slots as { sheetId: string, count: number }[]) {
            const sheet = sheetById.get(slot.sheetId)
            if (!sheet) {
                throw createError({ statusCode: 400, statusMessage: 'Slot references a sheet that does not belong to this set' })
            }
            if (seenSheetIds.has(slot.sheetId)) {
                throw createError({ statusCode: 400, statusMessage: `Sheet '${sheet.name}' appears in more than one slot` })
            }
            seenSheetIds.add(slot.sheetId)
            if (sheet.role !== kind) {
                throw createError({ statusCode: 400, statusMessage: `Sheet '${sheet.name}' has role '${sheet.role}', not '${kind}'` })
            }
            if (slot.count !== sheet.packSlots) {
                throw createError({ statusCode: 400, statusMessage: `Slot count ${slot.count} does not match packSlots ${sheet.packSlots} of sheet '${sheet.name}'` })
            }
            cleanSlots.push({ sheetId: slot.sheetId, count: slot.count })
        }

        const [template] = await tx.insert(tcgPackTemplate)
            .values({ setId, kind, slots: cleanSlots })
            .onConflictDoUpdate({
                target: [tcgPackTemplate.setId, tcgPackTemplate.kind],
                set: { slots: cleanSlots }
            })
            .returning()
        return template!
    })
})
