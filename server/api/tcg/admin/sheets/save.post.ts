import { and, eq, inArray } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgSheet, tcgPrinting } from '#server/database/schema'
import { requirePokemonAdmin } from '#server/utils/auth'
import { lockSetForUpdate } from '#server/utils/tcg/engine'
import { validateWindow } from '#shared/utils/tcg/sheet-math'

export default defineEventHandler(async (event) => {
    await requirePokemonAdmin(event)

    const body = await readBody(event)
    const setId = body?.setId
    const sheetId = body?.sheetId
    const name = body?.name
    const role = body?.role
    const packSlots = body?.packSlots
    const layout = body?.layout
    const sortOrder = body?.sortOrder

    if (typeof setId !== 'string' || !setId) throw createError({ statusCode: 400, statusMessage: 'Invalid setId' })
    if (sheetId !== undefined && (typeof sheetId !== 'string' || !sheetId)) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid sheetId' })
    }
    if (typeof name !== 'string' || !name.trim()) throw createError({ statusCode: 400, statusMessage: 'Invalid name' })
    if (role !== 'base' && role !== 'god') throw createError({ statusCode: 400, statusMessage: 'Invalid role' })
    if (!Number.isInteger(packSlots) || packSlots < 1) {
        throw createError({ statusCode: 400, statusMessage: 'packSlots must be a positive integer' })
    }
    if (!Array.isArray(layout) || layout.some(id => typeof id !== 'string' || !id)) {
        throw createError({ statusCode: 400, statusMessage: 'layout must be an array of printing ids' })
    }
    if (sortOrder !== undefined && !Number.isInteger(sortOrder)) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid sortOrder' })
    }
    if (layout.length > 0 && packSlots > layout.length) {
        throw createError({
            statusCode: 400,
            statusMessage: `packSlots ${packSlots} cannot exceed the layout size ${layout.length}`
        })
    }

    // Server-authoritative window check — the client preview is advisory only.
    const violations = validateWindow(layout, packSlots)
    if (violations.length > 0) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Layout violates the window constraint',
            data: { violations }
        })
    }

    return await db.transaction(async (tx) => {
        // The set row lock serializes this against commitSet and every other
        // draft mutation — the status check below cannot go stale.
        const set = await lockSetForUpdate(tx, setId)
        if (set.status !== 'draft') throw createError({ statusCode: 400, statusMessage: 'Set is committed and frozen' })

        // Every printing on the sheet must belong to this set.
        const layoutIds = [...new Set(layout as string[])]
        if (layoutIds.length > 0) {
            const known = await tx.select({ id: tcgPrinting.id }).from(tcgPrinting)
                .where(and(eq(tcgPrinting.setId, setId), inArray(tcgPrinting.id, layoutIds)))
            const knownIds = new Set(known.map(row => row.id))
            const foreign = layoutIds.filter(id => !knownIds.has(id))
            if (foreign.length > 0) {
                throw createError({
                    statusCode: 400,
                    statusMessage: 'Layout references printings outside this set',
                    data: { unknownPrintingIds: foreign }
                })
            }
        }

        if (sheetId) {
            const [updated] = await tx.update(tcgSheet)
                .set({
                    name: name.trim(),
                    role,
                    packSlots,
                    layout,
                    ...(sortOrder !== undefined ? { sortOrder } : {})
                })
                .where(and(eq(tcgSheet.id, sheetId), eq(tcgSheet.setId, setId)))
                .returning()
            if (!updated) throw createError({ statusCode: 404, statusMessage: 'Sheet not found' })
            return updated
        }

        const [created] = await tx.insert(tcgSheet)
            .values({
                setId,
                name: name.trim(),
                role,
                packSlots,
                layout,
                sortOrder: sortOrder ?? 0
            })
            .returning()
        return created!
    })
})
