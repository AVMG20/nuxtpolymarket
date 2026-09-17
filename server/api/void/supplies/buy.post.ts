import { requireUserId } from '#server/utils/auth'
import { voidBuySupplies } from '#server/utils/void'
import { VOID_SUPPLY_IDS, type VoidSupplyId } from '#shared/utils/gamelogic/void-station'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const id = String(body?.supplyId) as VoidSupplyId
    if (!VOID_SUPPLY_IDS.includes(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid supply' })
    const count = Math.floor(Number(body?.count) || 1)
    if (count < 1 || count > 10) throw createError({ statusCode: 400, statusMessage: 'Invalid amount' })
    return voidBuySupplies(userId, id, count)
})
