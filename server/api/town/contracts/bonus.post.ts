import { requireUserId } from '#server/utils/auth'
import { claimTownContractBonus } from '#server/utils/town-contracts'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    return claimTownContractBonus(userId)
})
