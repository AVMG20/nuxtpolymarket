import { requireUserId } from '#server/utils/auth'
import { deleteDeck } from '#server/utils/battler/deck'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const deckId = getRouterParam(event, 'id')
    if (!deckId) throw createError({ statusCode: 400, statusMessage: 'Missing deck id' })
    return await deleteDeck(userId, deckId)
})
