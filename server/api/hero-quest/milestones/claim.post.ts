import { db } from '#server/database'
import { requireUserId } from '#server/utils/auth'
import { requireFeature } from '#server/utils/hero-quest-tutorials'
import { claimMilestones } from '#server/utils/hero-quest-milestones'
import { MILESTONES_CLAIM_BODY, readHqBody, type HqMilestonesClaimResponse } from '#server/utils/hero-quest-api'

/**
 * Claim every milestone step reached and not yet claimed on the track named by `track`
 * (`milestones.ts`). No settle: no feat a track counts accrues while idle.
 */
export default defineEventHandler(async (event): Promise<HqMilestonesClaimResponse> => {
    const userId = await requireUserId(event)
    await requireFeature(userId, 'milestones')
    const { track } = await readHqBody(event, MILESTONES_CLAIM_BODY)
    return db.transaction(tx => claimMilestones(tx, userId, track))
})
