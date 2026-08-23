import { getSessionUserId } from '#server/utils/auth'
import { caravanResponse, withCaravan } from '#server/utils/caravan'
import { applyLoadout, planLoadout } from '#shared/utils/caravan/loadout'

/**
 * Hand the whole vault out in one pass: best item of each slot to the highest
 * level worker, and down from there. Purely a convenience -- it never creates or
 * destroys anything, so there is nothing to gate behind research.
 */
export default defineEventHandler(async (event) => {
    const userId = await getSessionUserId(event)
    if (!userId) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    const { ctx, result } = await withCaravan(userId, ({ state }) => {
        const changes = planLoadout(state)
        applyLoadout(state, changes)
        return changes.length
    })

    return { ...caravanResponse(ctx), changed: result }
})
