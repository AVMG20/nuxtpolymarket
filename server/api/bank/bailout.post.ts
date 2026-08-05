import { requireUserId } from '#server/utils/auth'
import { performBailout } from '#server/utils/bank'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    return performBailout(userId)
})
