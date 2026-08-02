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

export default defineNitroPlugin(() => {
    void sweep().catch(() => { /* a failed sweep retries on the next interval */ })
    const timer = setInterval(() => {
        void sweep().catch(() => { /* same */ })
    }, SWEEP_INTERVAL_MS)
    timer.unref?.()
})
