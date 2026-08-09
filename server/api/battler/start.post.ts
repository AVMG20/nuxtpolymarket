import { requireUserId } from '#server/utils/auth'
import { startRun, runView } from '#server/utils/battler/run'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    await startRun(userId)
    return await runView(userId)
})
