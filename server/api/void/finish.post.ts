import { requireUserId } from '#server/utils/auth'
import { voidFinishRun } from '#server/utils/void'

const REASONS = ['extracted', 'destroyed', 'abandoned'] as const

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const reason = REASONS.find(r => r === body?.reason) ?? 'destroyed'
    return voidFinishRun(userId, {
        reason,
        haul: body?.haul,
        elapsedMs: body?.elapsedMs,
        kills: body?.kills,
        wardenKilled: body?.wardenKilled,
        skillUses: body?.skillUses,
        suppliesUsed: body?.suppliesUsed,
        relics: body?.relics
    })
})
