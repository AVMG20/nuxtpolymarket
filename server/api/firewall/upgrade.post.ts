import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { firewallState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { debit } from '#server/utils/balance'
import { FIREWALL_LEVEL_COLUMN, firewallLevels, getLockedFirewallState } from '#server/utils/firewall'
import {
    FIREWALL_MAINFRAME_IDS,
    firewallMainframe,
    firewallMainframeCost,
    type FirewallMainframeId
} from '#shared/utils/gamelogic/firewall'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const upgradeId = body?.upgradeId as FirewallMainframeId
    if (!FIREWALL_MAINFRAME_IDS.includes(upgradeId)) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid Mainframe upgrade' })
    }

    return db.transaction(async (tx) => {
        // The lock is what makes the read-then-write below safe: without it, N
        // concurrent buys all read the same level and all pay one level's price.
        const state = await getLockedFirewallState(tx, userId)
        if (state.runStartedAt) {
            throw createError({ statusCode: 400, statusMessage: 'The Mainframe is offline during a run' })
        }

        const column = FIREWALL_LEVEL_COLUMN[upgradeId]
        const level = state[column]
        const cost = firewallMainframeCost(firewallMainframe(upgradeId), level)
        if (cost === null) throw createError({ statusCode: 400, statusMessage: 'Upgrade is already maxed' })

        await debit(userId, cost.toFixed(4), 'firewall:mainframe', tx)
        const [updated] = await tx.update(firewallState)
            .set({ [column]: level + 1 })
            .where(eq(firewallState.userId, userId))
            .returning()

        return { upgradeId, level: level + 1, cost, levels: firewallLevels(updated!) }
    })
})
