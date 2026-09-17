import { requireUserId } from '#server/utils/auth'
import { voidBuyUpgrade } from '#server/utils/void'
import { VOID_UPGRADE_IDS, type VoidUpgradeId } from '#shared/utils/gamelogic/void'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const id = String(body?.upgrade) as VoidUpgradeId
    if (!VOID_UPGRADE_IDS.includes(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid upgrade' })
    return voidBuyUpgrade(userId, id)
})
