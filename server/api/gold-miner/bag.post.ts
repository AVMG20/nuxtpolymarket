import { requireUserId } from '#server/utils/auth'
import { goldMinerBag } from '#server/utils/gold-miner'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const itemId = Number(body?.itemId)
    if (!Number.isInteger(itemId)) throw createError({ statusCode: 400, statusMessage: 'Invalid item' })
    return goldMinerBag(userId, itemId)
})
