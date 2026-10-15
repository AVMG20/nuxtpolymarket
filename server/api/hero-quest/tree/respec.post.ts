import { db } from '#server/database'
import { requireUserId } from '#server/utils/auth'
import { requireFeature } from '#server/utils/hero-quest-tutorials'
import { settleHq } from '#server/utils/hero-quest'
import { respecPassiveTree } from '#server/utils/hero-quest-passive-tree'
import type { HqTreeRespecResponse } from '#server/utils/hero-quest-api'

/** Refund every Passive Skill Tree point: free once per prestige, Gems otherwise. */
export default defineEventHandler(async (event): Promise<HqTreeRespecResponse> => {
    const userId = await requireUserId(event)
    await requireFeature(userId, 'tree')
    await settleHq(userId)
    return db.transaction(tx => respecPassiveTree(tx, userId))
})
