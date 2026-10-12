import { requireUserId } from '#server/utils/auth'
import { requireFeature } from '#server/utils/hero-quest-tutorials'
import { settleHq } from '#server/utils/hero-quest'
import { getCandidates } from '#server/utils/hero-quest-arena'

/**
 * The opponent list (`arena.md` §2): three in-band defenders, a Training Dummy in every slot the
 * band can't fill (§2a). The first list is drawn free on the first read; after that it changes only
 * with a paid refresh or an attack. Settles first, so the band is taken on the party as it stands.
 */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    await requireFeature(userId, 'arena')
    await settleHq(userId)
    return getCandidates(userId, Date.now())
})
