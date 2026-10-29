import { requireUserId } from '#server/utils/auth'
import { ensureRiftbornState, riftbornStateView } from '#server/utils/riftborn'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    return riftbornStateView(await ensureRiftbornState(userId))
})
