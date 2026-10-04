import { requireUserId } from '#server/utils/auth'
import { getWorldView } from '#server/utils/town'
import { db } from '#server/database'
import { townPlots } from '#server/database/schema'
import { eq } from 'drizzle-orm'

// The other mayors around you: their plots, what stands on them, and what they
// have listed. Kept out of /api/town/state because it is most of the bytes and
// none of it is needed to play your own town, so the client loads it after the
// town is on screen and refreshes it far less often than the state.
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const plots = await db.select({ x: townPlots.x, y: townPlots.y }).from(townPlots).where(eq(townPlots.userId, userId))
    return getWorldView(userId, plots)
})
