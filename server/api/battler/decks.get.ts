import { requireUserId } from '#server/utils/auth'
import { listDecks } from '#server/utils/battler/deck'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    return await listDecks(userId)
})
