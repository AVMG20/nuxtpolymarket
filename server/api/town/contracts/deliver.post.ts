import { requireUserId } from '#server/utils/auth'
import { deliverTownContract } from '#server/utils/town-contracts'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const contractId = body?.contractId
    if (typeof contractId !== 'string') throw createError({ statusCode: 400, statusMessage: 'Unknown contract' })
    return deliverTownContract(userId, contractId)
})
