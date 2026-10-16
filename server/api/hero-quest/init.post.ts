import { requireUserId } from '#server/utils/auth'
import { ensureHqState, getHqState } from '#server/utils/hero-quest'
import type { HqInitResponse } from '#server/utils/hero-quest-api'

/**
 * Found a run. Explicit rather than auto-created on first read, so the client can show a
 * start screen (the platform's `colony/init` shape).
 *
 * The `onConflictDoNothing` inside `ensureHqState` **is** the double-init guard: a second
 * concurrent call inserts nothing and returns the same already-founded state, rather than
 * two rows racing or an existing run being reset to World 1.
 */
export default defineEventHandler(async (event): Promise<HqInitResponse> => {
    const userId = await requireUserId(event)
    await ensureHqState(userId)
    const state = await getHqState(userId)
    if (!state) throw createError({ statusCode: 500, statusMessage: 'Could not initialize Hero Quest state' })
    return { initialized: true, heroNodeId: state.heroNodeId }
})
