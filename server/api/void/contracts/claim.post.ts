import { requireUserId } from '#server/utils/auth'
import { voidClaimContract } from '#server/utils/void'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    return voidClaimContract(userId, Number(body?.index))
})
