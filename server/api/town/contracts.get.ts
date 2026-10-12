import { requireUserId } from '#server/utils/auth'
import { getTownContracts } from '#server/utils/town-contracts'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    return getTownContracts(userId)
})
