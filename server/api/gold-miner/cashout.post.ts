import { requireUserId } from '#server/utils/auth'
import { goldMinerCashOut } from '#server/utils/gold-miner'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    return goldMinerCashOut(userId)
})
