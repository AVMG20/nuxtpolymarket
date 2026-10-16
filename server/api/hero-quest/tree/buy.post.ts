import { db } from '#server/database'
import { requireUserId } from '#server/utils/auth'
import { requireFeature } from '#server/utils/hero-quest-tutorials'
import { settleHq } from '#server/utils/hero-quest'
import { buyPassiveLevel } from '#server/utils/hero-quest-passive-tree'
import { TREE_BUY_BODY, readHqBody, type HqTreeBuyResponse } from '#server/utils/hero-quest-api'

/** Buy one level of a Passive Skill Tree node, from the points the Hero's level has earned. */
export default defineEventHandler(async (event): Promise<HqTreeBuyResponse> => {
    const userId = await requireUserId(event)
    await requireFeature(userId, 'tree')
    const { nodeId } = await readHqBody(event, TREE_BUY_BODY)
    // settle first: the levels it banks are points, and the window before pays at the old rate
    await settleHq(userId)
    return db.transaction(tx => buyPassiveLevel(tx, userId, nodeId))
})
