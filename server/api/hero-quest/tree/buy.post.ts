import { db } from '#server/database'
import { requireUserId } from '#server/utils/auth'
import { requireFeature } from '#server/utils/hero-quest-tutorials'
import { settleHq } from '#server/utils/hero-quest'
import { buyPassiveLevel } from '#server/utils/hero-quest-passive-tree'

/** Buy one level of a Passive Skill Tree node, from the points the Hero's level has earned. */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    await requireFeature(userId, 'tree')
    const body = await readBody<{ nodeId?: unknown }>(event)
    if (typeof body?.nodeId !== 'string') throw createError({ statusCode: 400, statusMessage: 'Pick a node' })
    const nodeId = body.nodeId
    // settle first: the levels it banks are points, and the window before pays at the old rate
    await settleHq(userId)
    return db.transaction(tx => buyPassiveLevel(tx, userId, nodeId))
})
