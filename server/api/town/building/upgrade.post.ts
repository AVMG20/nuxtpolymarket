import { requireUserId } from '#server/utils/auth'
import { getBalance } from '#server/utils/balance'
import { upgradeBuilding } from '#server/utils/town'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    return { ...(await upgradeBuilding(userId, String(body?.buildingId ?? ''))), balance: await getBalance(userId) }
})
