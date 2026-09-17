import { requireUserId } from '#server/utils/auth'
import { battlerPublicProfile } from '#server/utils/battler/profile'

/**
 * A player's public battler record and trophy boards. `userId` may name
 * another player — profiles are public to logged-in users (§10.5).
 */
export default defineEventHandler(async (event) => {
    const callerId = await requireUserId(event)
    const q = getQuery(event)
    const userId = typeof q.userId === 'string' && q.userId ? q.userId : callerId
    return await battlerPublicProfile(userId)
})
