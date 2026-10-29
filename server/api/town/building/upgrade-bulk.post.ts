import { requireUserId } from '#server/utils/auth'
import { getBalance } from '#server/utils/balance'
import { upgradeBuildings } from '#server/utils/town'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const ids = Array.isArray(body?.buildingIds) ? body.buildingIds.map((id: unknown) => String(id)) : []
    return { ...(await upgradeBuildings(userId, ids)), balance: await getBalance(userId) }
})
