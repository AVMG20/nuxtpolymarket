import { requireUserId } from '#server/utils/auth'
import { getBalance } from '#server/utils/balance'
import { sellPlotToSystem } from '#server/utils/town'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    return { ...(await sellPlotToSystem(userId, String(body?.plotId ?? ''))), balance: await getBalance(userId) }
})
