import { requireUserId } from '#server/utils/auth'
import { goldMinerSnapshot } from '#server/utils/gold-miner'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    return goldMinerSnapshot(userId)
})
