import { db } from '#server/database'
import { requireUserId } from '#server/utils/auth'
import { getBalance } from '#server/utils/balance'
import { resolveBossEngage, settleHq } from '#server/utils/hero-quest'

/**
 * Resolve a boss or super-boss fight, server-side and authoritatively.
 *
 * Bosses are the one thing in this game that requires the player to be present — offline
 * never engages one, win or lose, which is also why Void Shards can never be earned purely
 * from idle time (`idle-mechanics.md` §5).
 *
 * The client calls this **automatically** while `document.visibilityState` reads `visible`
 * (`useHqAutoBoss`), so most requests arrive without anyone pressing anything. Presence is still
 * what gates a boss; visibility is just a direct reading of it. ⚠ The consequence worth knowing
 * is that the "not at a boss gate" 400 is a **routine** response rather than a misuse — the client
 * projects kills fractionally and settles floored, so it can reach a gate a beat before this route
 * agrees, and it retries rather than reporting. Do not "fix" that rejection into something
 * softer; it is the check that stops a client's optimism from moving the run.
 *
 * The fight and both of its guards — at a gate, and not already cleared — run under the
 * `hqState` row lock in `resolveBossEngage`. See there for why the cleared check is needed.
 */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)

    // Settle first, outside the fight transaction, so the fight uses current state — the
    // player may have accrued levels since their last read.
    await settleHq(userId)

    // Read outside the transaction, before any lock is taken — `credit` locks this user's balance
    // row from inside, and a read on a second pool connection while that lock is held is exactly
    // the deadlock shape the platform guidance warns about. Only the Gambler's Strike family
    // reads it, and its factor is clamped, so a slightly stale value cannot move the fight much.
    const bankedGold = parseFloat(await getBalance(userId)) || 0

    return db.transaction(tx => resolveBossEngage(tx, userId, bankedGold))
})
