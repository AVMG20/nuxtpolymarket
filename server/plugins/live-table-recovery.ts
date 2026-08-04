import { and, eq, lt } from 'drizzle-orm'
import { db } from '#server/database'
import { tableWagers } from '#server/database/schema'
import { credit } from '#server/utils/balance'

/**
 * A round holds real money between the stake and the payout. If the process
 * dies in that window the escrow row survives unsettled, and this sweep hands
 * the stake back.
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
    const claimed = await db.update(tableWagers)
        .set({ settled: true })
        .where(and(eq(tableWagers.settled, false), lt(tableWagers.createdAt, cutoff)))
        .returning({
            userId: tableWagers.userId,
            amount: tableWagers.amount,
            game: tableWagers.game
        })

    // Refunded under the game's own category so analytics stays one row per game.
    for (const wager of claimed) {
        await credit(wager.userId, wager.amount, wager.game)
    }
    if (claimed.length) {
        console.log(`[live-table] refunded ${claimed.length} orphaned wager(s)`)
    }
}

// A sweep that throws is usually the escrow table missing entirely, which also
// breaks every bet at every table — so it is logged rather than swallowed.
function runSweep() {
    void sweep().catch((error) => {
        console.error('[live-table] wager recovery sweep failed', error)
    })
}

export default defineNitroPlugin(() => {
    runSweep()
    const timer = setInterval(runSweep, SWEEP_INTERVAL_MS)
    timer.unref?.()
})
