import { requireUserId } from '#server/utils/auth'
import { startRun, runView } from '#server/utils/battler/run'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event).catch(() => null)
    const deckId = typeof body?.deckId === 'string' && body.deckId ? body.deckId : null
    await startRun(userId, deckId)
    return await runView(userId)
})
