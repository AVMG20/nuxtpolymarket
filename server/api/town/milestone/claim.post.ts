import { requireUserId } from '#server/utils/auth'
import { getBalance } from '#server/utils/balance'
import { claimMilestone } from '#server/utils/town'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    return { ...(await claimMilestone(userId, String(body?.id ?? ''))), balance: await getBalance(userId) }
})
