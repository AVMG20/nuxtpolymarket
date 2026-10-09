import { db } from '#server/database'
import { requireUserId } from '#server/utils/auth'
import { requireFeature } from '#server/utils/hero-quest-tutorials'
import { claimMilestones } from '#server/utils/hero-quest-milestones'

/**
 * Claim every milestone step reached and not yet claimed: on the track named by `track`, or on
 * every track without one (`milestones.ts`). No settle: no feat a track counts accrues while idle.
 */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    await requireFeature(userId, 'milestones')
    const body = await readBody<{ track?: unknown }>(event)
    const track = typeof body?.track === 'string' ? body.track : null
    return db.transaction(tx => claimMilestones(tx, userId, track))
})
