import { requireUserId } from '#server/utils/auth'
import { saveDeck } from '#server/utils/battler/deck'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    return await saveDeck(userId, {
        id: typeof body?.id === 'string' ? body.id : null,
        name: body?.name,
        cards: body?.cards
    })
})
