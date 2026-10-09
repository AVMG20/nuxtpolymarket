import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { hqState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { requireFeature } from '#server/utils/hero-quest-tutorials'
import { classPickWrites } from '#server/utils/hero-quest'
import { getClass } from '#shared/utils/hero-quest/content/classes'
import type { ClassId } from '#shared/utils/hero-quest/types'

/**
 * Choose the Hero's class node.
 *
 * Legal picks are any node **already seen** in a past run, or a specialization exactly one
 * tier deeper than the current node (`classes-and-combat.md` §5). "Already seen" is permanent
 * — reaching a node once keeps it pickable forever, and re-picking a deep node restores its
 * whole inherited kit because kits are cumulative.
 *
 * **Level is not touched.** Switching class carries the Hero's full level across; only the
 * spread those levels multiply into changes. That is what makes the picker a build choice
 * rather than a tax, and it is the single easiest invariant here to break by accident.
 */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    await requireFeature(userId, 'classes')
    const body = await readBody<{ classId?: string }>(event)
    const requested = body?.classId

    if (typeof requested !== 'string') {
        throw createError({ statusCode: 400, statusMessage: 'classId is required' })
    }

    return db.transaction(async (tx) => {
        const [state] = await tx.select().from(hqState).where(eq(hqState.userId, userId)).for('update')
        if (!state) throw createError({ statusCode: 400, statusMessage: 'No Hero Quest run' })

        // Validated inside the lock: `seenNodeIds` and the class token are read here and written
        // below, so a stale read would let two concurrent picks each spend the same token.
        const writes = classPickWrites(state, requested)
        if (!writes) {
            throw createError({ statusCode: 400, statusMessage: 'That class is not available yet' })
        }

        const node = getClass(requested as ClassId)
        const [updated] = await tx.update(hqState)
            .set(writes)
            .where(eq(hqState.userId, userId))
            .returning()

        return {
            classId: node.id,
            className: node.name,
            heroLevel: updated?.heroLevel ?? state.heroLevel,
            seenNodeIds: updated?.seenNodeIds ?? writes.seenNodeIds
        }
    })
})
