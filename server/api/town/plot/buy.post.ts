import { requireUserId } from '#server/utils/auth'
import { getBalance } from '#server/utils/balance'
import { buyPlot } from '#server/utils/town'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    return { ...(await buyPlot(userId, Number(body?.x), Number(body?.y))), balance: await getBalance(userId) }
})
