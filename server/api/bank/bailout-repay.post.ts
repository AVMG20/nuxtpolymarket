import { requireUserId } from '#server/utils/auth'
import { repayBailout } from '#server/utils/bank'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    return repayBailout(userId)
})
