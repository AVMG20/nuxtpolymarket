import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { bankState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { bailoutStateOf } from '#server/utils/bank'
import { growBankBalance, isBailoutActive } from '#shared/utils/gamelogic/bank'

/**
 * One boolean for the sidebar: is the bank taking a cut of this player's
 * earnings? A running bail-out counts — the lifted debt is still a debt until it
 * is levied back or bought out. Every actual number stays on the bank page.
 *
 * Read-only: no lock and no settle write, so a page render never serialises
 * against the bank endpoints.
 */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const state = await db.query.bankState.findFirst({ where: eq(bankState.userId, userId) })
    if (!state) return { inDebt: false }

    const bailout = bailoutStateOf(state)
    const balance = growBankBalance(parseFloat(state.balance), state.lastSettledAt, new Date(), bailout)
    return { inDebt: balance < 0 || isBailoutActive(bailout) }
})
