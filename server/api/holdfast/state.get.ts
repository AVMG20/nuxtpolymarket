import { requireUserId } from '#server/utils/auth'
import { holdfastPlayerState } from '#server/utils/holdfast'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    return holdfastPlayerState(userId)
})
