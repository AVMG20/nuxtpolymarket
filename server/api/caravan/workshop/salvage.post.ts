import { getSessionUserId } from '#server/utils/auth'
import { caravanResponse, withCaravan } from '#server/utils/caravan'
import { salvageValue } from '#shared/utils/caravan/config'

export default defineEventHandler(async (event) => {
    const userId = await getSessionUserId(event)
    if (!userId) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    const body = await readBody<{ itemIds?: string[] }>(event)
    const itemIds = Array.isArray(body?.itemIds) ? body.itemIds.map(String) : []

    const { ctx, result } = await withCaravan(userId, ({ state }) => {
        let gained = 0
        for (const id of itemIds) {
            const index = state.items.findIndex(i => i.id === id)
            if (index === -1) continue
            const item = state.items[index]!
            // Equipped gear is not salvageable by accident.
            if (state.workers.some(w => Object.values(w.equipment).includes(id))) continue
            gained += salvageValue(item.tier, item.rarity)
            state.items.splice(index, 1)
        }
        state.shards += gained
        return gained
    })

    return { ...caravanResponse(ctx), shards: result }
})
