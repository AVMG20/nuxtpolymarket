import { and, eq, lt } from 'drizzle-orm'
import { db } from '#server/database'
import { liveBlackjackWagers } from '#server/database/schema'
import { credit } from '#server/utils/balance'

/**
 * A live blackjack round holds real money between the stake and the payout. If
 * the process dies in that window the escrow row survives unsettled, and this
 * sweep hands the stake back.
 *
 * The age cutoff is what makes it safe to run in more than one process: a round
 * cannot outlive it, so anything older is guaranteed to be orphaned rather than
 * in flight on a sibling instance.
 */
const ORPHAN_AFTER_MS = 15 * 60_000
const SWEEP_INTERVAL_MS = 5 * 60_000

async function sweep() {
    const cutoff = new Date(Date.now() - ORPHAN_AFTER_MS)

    // Claim first, refund second. The conditional UPDATE is the guard, so two
    // instances sweeping at once can never both pay out the same row.
    const claimed = await db.update(liveBlackjackWagers)
        .set({ settled: true })
        .where(and(eq(liveBlackjackWagers.settled, false), lt(liveBlackjackWagers.createdAt, cutoff)))
        .returning({
            id: liveBlackjackWagers.id,
            userId: liveBlackjackWagers.userId,
            amount: liveBlackjackWagers.amount
        })

    for (const wager of claimed) {
        await credit(wager.userId, wager.amount, 'live-blackjack:recovery')
    }
    if (claimed.length) {
        console.log(`[live-blackjack] refunded ${claimed.length} orphaned wager(s)`)
    }
}

// A sweep that throws is usually the escrow table missing entirely, which also
// breaks every bet at the table — so it is logged rather than swallowed.
function runSweep() {
    void sweep().catch((error) => {
        console.error('[live-blackjack] wager recovery sweep failed', error)
    })
}

export default defineNitroPlugin(() => {
    runSweep()
    const timer = setInterval(runSweep, SWEEP_INTERVAL_MS)
    timer.unref?.()
})
