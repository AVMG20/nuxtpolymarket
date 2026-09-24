import { requireUserId } from '#server/utils/auth'
import { goldMinerStart, parseGoldMinerStake } from '#server/utils/gold-miner'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    return goldMinerStart(userId, parseGoldMinerStake(body?.stake))
})
