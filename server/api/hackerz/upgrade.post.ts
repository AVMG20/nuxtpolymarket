import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { hackerzState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { debit } from '#server/utils/balance'
import { HACKERZ_LEVEL_COLUMN, hackerzLevels, getLockedHackerzState } from '#server/utils/hackerz'
import {
    HACKERZ_MAINFRAME_IDS,
    hackerzMainframe,
    hackerzMainframeCost,
    type HackerzMainframeId
} from '#shared/utils/gamelogic/hackerz'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const upgradeId = body?.upgradeId as HackerzMainframeId
    if (!HACKERZ_MAINFRAME_IDS.includes(upgradeId)) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid Mainframe upgrade' })
    }

    return db.transaction(async (tx) => {
        // The lock is what makes the read-then-write below safe: without it, N
        // concurrent buys all read the same level and all pay one level's price.
        const state = await getLockedHackerzState(tx, userId)
        if (state.runStartedAt) {
            throw createError({ statusCode: 400, statusMessage: 'The Mainframe is offline during a run' })
        }

        const column = HACKERZ_LEVEL_COLUMN[upgradeId]
        const level = state[column]
        const cost = hackerzMainframeCost(hackerzMainframe(upgradeId), level)
        if (cost === null) throw createError({ statusCode: 400, statusMessage: 'Upgrade is already maxed' })

        await debit(userId, cost.toFixed(4), 'hackerz:mainframe', tx)
        const [updated] = await tx.update(hackerzState)
            .set({ [column]: level + 1 })
            .where(eq(hackerzState.userId, userId))
            .returning()

        return { upgradeId, level: level + 1, cost, levels: hackerzLevels(updated!) }
    })
})
