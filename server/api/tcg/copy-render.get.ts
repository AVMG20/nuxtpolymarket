import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgCopy } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { deriveWearSpec } from '#server/utils/tcg/condition-render'
import type { TcgWearSpec } from '#shared/types/tcg'

/**
 * Wear spec for one owned copy.
 *
 * This endpoint is the ONLY place a copy's condition column is read on
 * behalf of a client, and it must only ever emit the derived lossy
 * TcgWearSpec (§6.3) — never the raw condition, a sub-score, or anything
 * else computed from it. `wear` is null for pre-slice-3 copies that predate
 * the condition column.
 */
export default defineEventHandler(async (event): Promise<{ wear: TcgWearSpec | null }> => {
    const userId = await requireUserId(event)
    const copyId = getQuery(event).copyId
    if (typeof copyId !== 'string' || !copyId) {
        throw createError({ statusCode: 400, statusMessage: 'copyId is required' })
    }

    const [copy] = await db.select({
        id: tcgCopy.id,
        ownerId: tcgCopy.ownerId,
        condition: tcgCopy.condition
    })
        .from(tcgCopy)
        .where(eq(tcgCopy.id, copyId))
    if (!copy) throw createError({ statusCode: 404, statusMessage: 'Copy not found' })
    if (copy.ownerId !== userId) throw createError({ statusCode: 403, statusMessage: 'Forbidden' })

    return { wear: copy.condition ? deriveWearSpec(copy.id, copy.condition) : null }
})
