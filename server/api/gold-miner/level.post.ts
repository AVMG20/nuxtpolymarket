import { requireUserId } from '#server/utils/auth'
import { goldMinerSubmitLevel } from '#server/utils/gold-miner'
import type { GmGrab } from '#shared/utils/gamelogic/gold-miner'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    if (!Array.isArray(body?.grabs)) throw createError({ statusCode: 400, statusMessage: 'Invalid level report' })
    // Only the three known fields survive; gmScoreLevel validates their values.
    const grabs: GmGrab[] = body.grabs.map((g: Partial<GmGrab> | null) => ({
        id: Number(g?.id),
        at: Number(g?.at),
        blown: g?.blown === true
    }))
    return goldMinerSubmitLevel(userId, grabs)
})
