import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { firewallState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { debitGems } from '#server/utils/balance'
import { getLockedFirewallState } from '#server/utils/firewall'
import { firewallCooldownRushCost, firewallRunCooldownRemainingMs } from '#shared/utils/gamelogic/firewall'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)

    return db.transaction(async (tx) => {
        const state = await getLockedFirewallState(tx, userId)
        if (state.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'Cannot rush cooldown during an active run' })

        const remainingMs = firewallRunCooldownRemainingMs(state.lastRunFinishedAt, Date.now())
        if (remainingMs <= 0) throw createError({ statusCode: 400, statusMessage: 'The uplink is already ready' })

        const cost = firewallCooldownRushCost(remainingMs)
        const gems = await debitGems(userId, cost, tx)
        await tx.update(firewallState)
            .set({ lastRunFinishedAt: null })
            .where(eq(firewallState.userId, userId))

        return { cost, gems }
    })
})
