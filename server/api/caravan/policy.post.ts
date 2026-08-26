import { getSessionUserId } from '#server/utils/auth'
import { caravanResponse, withCaravan } from '#server/utils/caravan'
import { RARITIES } from '#shared/utils/caravan/config'
import { bonusesFor } from '#shared/utils/caravan/progression'
import type { Rarity } from '#shared/utils/caravan/types'

/**
 * Toggle a standing order. The kitchen order is gated on its research;
 * auto-salvage is a pure preference and always available.
 */
export default defineEventHandler(async (event) => {
    const userId = await getSessionUserId(event)
    if (!userId) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    const body = await readBody<{
        autoRefine?: boolean
        autoSalvageBelow?: Rarity | null
    }>(event)

    const { ctx } = await withCaravan(userId, ({ state }) => {
        const bonuses = bonusesFor(state)

        if (body?.autoRefine !== undefined) {
            if (body.autoRefine && !bonuses.canAutoRefine) {
                throw createError({ statusCode: 400, statusMessage: 'Research standing orders first' })
            }
            state.policies.autoRefine = body.autoRefine === true
        }

        if (body?.autoSalvageBelow !== undefined) {
            const value = body.autoSalvageBelow
            if (value !== null && !RARITIES.some(r => r.id === value)) {
                throw createError({ statusCode: 400, statusMessage: 'Unknown rarity' })
            }
            state.policies.autoSalvageBelow = value
        }
    })

    return caravanResponse(ctx)
})
