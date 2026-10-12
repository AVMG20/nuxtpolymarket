import { requireUserId } from '#server/utils/auth'
import { discardRedesignDraft } from '#server/utils/town'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    return discardRedesignDraft(userId)
})
