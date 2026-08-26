import { getSessionUserId } from '#server/utils/auth'
import { caravanResponse, withCaravan } from '#server/utils/caravan'
import { ITEM_SLOTS } from '#shared/utils/caravan/config'
import type { ItemSlot } from '#shared/utils/caravan/types'

export default defineEventHandler(async (event) => {
    const userId = await getSessionUserId(event)
    if (!userId) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    const body = await readBody<{ workerId?: string, slot?: string, itemId?: string | null }>(event)
    const workerId = String(body?.workerId ?? '')
    const slot = String(body?.slot ?? '') as ItemSlot
    const itemId = body?.itemId ?? null

    if (!ITEM_SLOTS.includes(slot)) throw createError({ statusCode: 400, statusMessage: 'Bad slot' })

    const { ctx } = await withCaravan(userId, ({ state }) => {
        const worker = state.workers.find(w => w.id === workerId)
        if (!worker) throw createError({ statusCode: 404, statusMessage: 'No such worker' })

        if (itemId === null) {
            delete worker.equipment[slot]
            return
        }

        const item = state.items.find(i => i.id === itemId)
        if (!item) throw createError({ statusCode: 404, statusMessage: 'No such item' })
        if (item.slot !== slot) throw createError({ statusCode: 400, statusMessage: 'Wrong slot' })

        // An item lives on exactly one worker. Equipping it elsewhere takes it
        // off whoever had it, rather than silently duplicating the stats.
        for (const other of state.workers) {
            if (other.equipment[slot] === itemId) delete other.equipment[slot]
        }
        worker.equipment[slot] = itemId
    })

    return caravanResponse(ctx)
})
