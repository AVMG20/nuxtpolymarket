import { requireUserId } from '#server/utils/auth'
import { prestigeUser } from '#server/utils/prestige'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const result = await prestigeUser(userId)

    return {
        level: result.level,
        tokens: result.tokens,
        coinsBurned: result.coinsBurned,
        systemsCleared: result.tablesCleared.length
    }
})
