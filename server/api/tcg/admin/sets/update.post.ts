import { and, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgSet } from '#server/database/schema'
import { requirePokemonAdmin } from '#server/utils/auth'
import { serializeSet } from '#server/utils/tcg/engine'

/** Positive integer, or null to clear — anything else is a 400. */
function positiveIntOrNull(value: unknown, field: string): number | null {
    if (value === null) return null
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
        throw createError({ statusCode: 400, statusMessage: `${field} must be a positive integer or null` })
    }
    return value
}

export default defineEventHandler(async (event) => {
    await requirePokemonAdmin(event)

    const body = await readBody(event)
    const setId = typeof body?.setId === 'string' ? body.setId : ''
    if (!setId) throw createError({ statusCode: 400, statusMessage: 'setId is required' })

    const patch: Partial<typeof tcgSet.$inferInsert> = {}
    if ('name' in body) {
        const name = typeof body.name === 'string' ? body.name.trim() : ''
        if (!name) throw createError({ statusCode: 400, statusMessage: 'Name cannot be empty' })
        patch.name = name
    }
    if ('code' in body) {
        const code = typeof body.code === 'string' ? body.code.trim() : ''
        if (!code) throw createError({ statusCode: 400, statusMessage: 'Code cannot be empty' })
        patch.code = code
    }
    if ('releaseDate' in body) {
        if (body.releaseDate !== null && typeof body.releaseDate !== 'string') {
            throw createError({ statusCode: 400, statusMessage: 'releaseDate must be a string or null' })
        }
        patch.releaseDate = typeof body.releaseDate === 'string' && body.releaseDate.trim()
            ? body.releaseDate.trim()
            : null
    }
    if ('targetPackCount' in body) {
        patch.targetPackCount = positiveIntOrNull(body.targetPackCount, 'targetPackCount')
    }
    if ('godPackOneIn' in body) {
        patch.godPackOneIn = positiveIntOrNull(body.godPackOneIn, 'godPackOneIn')
    }
    if (Object.keys(patch).length === 0) {
        throw createError({ statusCode: 400, statusMessage: 'No fields to update' })
    }

    // Draft-only edit: the status check lives in the WHERE, so a concurrent
    // commit can never race an edit onto a frozen set.
    const [updated] = await db.update(tcgSet)
        .set(patch)
        .where(and(eq(tcgSet.id, setId), eq(tcgSet.status, 'draft')))
        .returning()
    if (!updated) throw createError({ statusCode: 400, statusMessage: 'Set is committed' })

    return serializeSet(updated)
})
